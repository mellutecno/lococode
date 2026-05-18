// Motore "chat modifiche" Lovable-style: prende una richiesta in linguaggio
// naturale dell'utente, chiede all'AI di tradurla in una sequenza di azioni
// strutturate (add_field, change_theme, ecc.), valida, applica al DB e
// scatena un build async per rigenerare il frontend.
//
// Output: { revision, build, summary, actions, applied, skipped }
// Throw: err.code in NO_TEXT, AI_NOT_CONFIGURED, AI_UNAVAILABLE,
//        AI_INVALID_RESPONSE, NO_VALID_ACTIONS, DB_FAILED

import { and, eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { config } from "../config.js";
import { callOpenRouterChat } from "../utils/openRouterClient.js";
import { isValidThemeId, themesPromptList } from "./themes.js";
import { validateEntityDef } from "../utils/orchestrator.js";
import { logOrchestratorSuccess, logOrchestratorFailure } from "../utils/aiUsageLogger.js";
import { enqueueBuild } from "./buildRunner.js";

function err(code, userMessage, extra = {}) {
  const e = new Error(userMessage);
  e.code = code;
  e.userMessage = userMessage;
  Object.assign(e, extra);
  return e;
}

// JSON-only system prompt: l'AI deve rispondere con un oggetto strutturato.
function buildRevisionSystemPrompt({ tenant, entities }) {
  const entitySummaries = entities.map((e) => ({
    name: e.name,
    label: e.label,
    fields: Object.entries(e.jsonSchema?.properties || {}).map(([fname, fdef]) => ({
      name: fname,
      type: fdef?.type,
      required: (e.jsonSchema?.required || []).includes(fname),
      ...(fdef?.format ? { format: fdef.format } : {}),
      ...(fdef?.enum ? { enum: fdef.enum } : {}),
    })),
  }));

  return `Sei MelluCode Revision Planner. Un utente sta gestendo questa app
e ti scrive in italiano cosa vuole modificare. Devi trasformare la richiesta
in azioni strutturate JSON.

APP ATTUALE:
- nome: ${tenant.name}
- tema corrente: ${tenant.metadata?.theme || "non impostato"}
- entita' (${entities.length}):
${JSON.stringify(entitySummaries, null, 2)}

TEMI VISIVI DISPONIBILI (per change_theme, devi scegliere uno di questi id):
${themesPromptList()}

AZIONI POSSIBILI (usa solo questi types):
1. add_field   {type:"add_field", entity:"<name>", field:{name, type, format?, enum?, required?, maxLength?, minimum?, maximum?}}
2. change_field {type:"change_field", entity:"<name>", field:{name, ...partial}}
3. remove_field {type:"remove_field", entity:"<name>", field:"<name>"}
4. add_entity   {type:"add_entity", entity:{name:"snake_case", label:"Italiano", schema:{type:"object", properties:{...}, required:[...]}, permissions?, metadata?}}
5. remove_entity {type:"remove_entity", entity:"<name>"}
6. change_theme {type:"change_theme", theme:"<id valido>"}
7. update_prompt {type:"update_prompt", append:"<testo da aggiungere a initialPrompt>"}

REGOLE OUTPUT (assolute):
- Rispondi SOLO con JSON puro. Niente markdown, niente spiegazioni.
- Forma esatta: { "summary": "frase italiana umana max 140 char", "actions": [...] }
- summary deve essere comprensibile da chi NON e' tecnico (es: "Aggiungo email ai clienti").
- Se la richiesta non e' chiara o non puoi fare nulla: actions:[] e summary spiega perche'.
- Niente azioni che richiedono cancellazione massiva di dati senza chiederlo.
- snake_case per i nomi (entity/field). Label in italiano naturale.
- maxLength per stringa = 255 default, max 5000.`;
}

function isObj(v) { return v && typeof v === "object" && !Array.isArray(v); }

function parseJsonRobust(reply) {
  if (typeof reply !== "string") return null;
  const txt = reply.trim();
  // Diretto
  try { return JSON.parse(txt); } catch {}
  // Code fence ```json ... ```
  const fence = txt.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fence) {
    try { return JSON.parse(fence[1]); } catch {}
  }
  // Primo blocco { ... } o [ ... ]
  const obj = txt.match(/(\{[\s\S]*\})/);
  if (obj) { try { return JSON.parse(obj[1]); } catch {} }
  return null;
}

// ============================================================
// Validazione azioni contro stato corrente
// ============================================================

const FIELD_NAME_RE = /^[a-z][a-z0-9_]{0,79}$/;
const ALLOWED_FIELD_TYPES = new Set(["string", "number", "integer", "boolean", "array", "object"]);

function validateFieldDef(def) {
  if (!isObj(def)) return "Definizione campo mancante.";
  if (!FIELD_NAME_RE.test(String(def.name || ""))) return `Nome campo non valido: "${def.name}".`;
  if (def.type && !ALLOWED_FIELD_TYPES.has(def.type)) return `Tipo campo non valido: ${def.type}.`;
  return null;
}

function findEntity(entities, name) {
  return entities.find((e) => e.name === name) || null;
}

// Costruisce il nuovo jsonSchema di un'entita' applicando un'azione.
// Ritorna { ok, jsonSchema } oppure { ok:false, error }.
function applyEntityPatch(entity, action) {
  const next = JSON.parse(JSON.stringify(entity.jsonSchema || { type: "object", properties: {}, required: [] }));
  next.type = next.type || "object";
  next.properties = next.properties || {};
  next.required = Array.isArray(next.required) ? next.required : [];

  if (action.type === "add_field") {
    const f = action.field;
    const verr = validateFieldDef(f);
    if (verr) return { ok: false, error: verr };
    next.properties[f.name] = stripUnsupportedKeys(f);
    if (f.required && !next.required.includes(f.name)) next.required.push(f.name);
    return { ok: true, jsonSchema: next };
  }
  if (action.type === "change_field") {
    const f = action.field;
    if (!f?.name || !next.properties[f.name]) {
      return { ok: false, error: `Campo "${f?.name}" non esiste in ${entity.name}.` };
    }
    const merged = { ...next.properties[f.name], ...stripUnsupportedKeys(f) };
    next.properties[f.name] = merged;
    if (typeof f.required === "boolean") {
      if (f.required && !next.required.includes(f.name)) next.required.push(f.name);
      if (!f.required) next.required = next.required.filter((r) => r !== f.name);
    }
    return { ok: true, jsonSchema: next };
  }
  if (action.type === "remove_field") {
    const fname = action.field;
    if (!next.properties[fname]) {
      return { ok: false, error: `Campo "${fname}" non esiste in ${entity.name}.` };
    }
    delete next.properties[fname];
    next.required = next.required.filter((r) => r !== fname);
    return { ok: true, jsonSchema: next };
  }
  return { ok: false, error: `Action non gestita: ${action.type}` };
}

function stripUnsupportedKeys(fieldDef) {
  const allow = ["type", "format", "enum", "maxLength", "minLength", "minimum", "maximum", "pattern", "items", "description"];
  const out = {};
  for (const k of allow) if (fieldDef[k] !== undefined) out[k] = fieldDef[k];
  return out;
}

// ============================================================
// Apply orchestration
// ============================================================

async function applyActionsInTransaction({ tenant, entities, actions, ownerUserId }) {
  const applied = [];
  const skipped = [];
  let themeChanged = false;
  let nextTheme = tenant.metadata?.theme || "dark-electric";
  let promptAppend = "";

  await db.transaction(async (tx) => {
    // Step 1: cambi sulle entita' esistenti (add/change/remove field)
    const entityActions = actions.filter((a) =>
      ["add_field", "change_field", "remove_field"].includes(a.type)
    );
    const grouped = new Map(); // entityName -> [actions...]
    for (const a of entityActions) {
      if (!grouped.has(a.entity)) grouped.set(a.entity, []);
      grouped.get(a.entity).push(a);
    }

    for (const [entityName, acts] of grouped) {
      const entity = findEntity(entities, entityName);
      if (!entity) {
        for (const a of acts) skipped.push({ action: a, reason: `Entita' "${entityName}" non esiste.` });
        continue;
      }
      let currentEntity = { ...entity };
      for (const a of acts) {
        const r = applyEntityPatch(currentEntity, a);
        if (!r.ok) { skipped.push({ action: a, reason: r.error }); continue; }
        currentEntity = { ...currentEntity, jsonSchema: r.jsonSchema };
        applied.push(a);
      }
      // Persist
      await tx
        .update(schema.mcAppEntities)
        .set({ jsonSchema: currentEntity.jsonSchema, updatedAt: new Date() })
        .where(eq(schema.mcAppEntities.id, entity.id));
    }

    // Step 2: add_entity
    for (const a of actions.filter((x) => x.type === "add_entity")) {
      const v = validateEntityDef(a.entity);
      if (!v.ok) { skipped.push({ action: a, reason: v.error }); continue; }
      // Check non duplicato
      const existing = await tx
        .select({ id: schema.mcAppEntities.id })
        .from(schema.mcAppEntities)
        .where(and(eq(schema.mcAppEntities.tenantId, tenant.id), eq(schema.mcAppEntities.name, v.values.name)))
        .limit(1);
      if (existing[0]) {
        skipped.push({ action: a, reason: `Entita' "${v.values.name}" gia' esiste.` });
        continue;
      }
      await tx.insert(schema.mcAppEntities).values({
        tenantId: tenant.id,
        name: v.values.name,
        label: v.values.label,
        jsonSchema: v.values.schema,
        permissions: v.values.permissions,
        metadata: v.values.metadata,
      });
      applied.push(a);
    }

    // Step 3: remove_entity
    for (const a of actions.filter((x) => x.type === "remove_entity")) {
      const name = a.entity;
      const found = findEntity(entities, name);
      if (!found) {
        skipped.push({ action: a, reason: `Entita' "${name}" non esiste.` });
        continue;
      }
      await tx
        .delete(schema.mcAppEntities)
        .where(eq(schema.mcAppEntities.id, found.id));
      applied.push(a);
    }

    // Step 4: change_theme
    for (const a of actions.filter((x) => x.type === "change_theme")) {
      if (!isValidThemeId(a.theme)) {
        skipped.push({ action: a, reason: `Tema "${a.theme}" non valido.` });
        continue;
      }
      nextTheme = a.theme;
      themeChanged = true;
      applied.push(a);
    }

    // Step 5: update_prompt
    for (const a of actions.filter((x) => x.type === "update_prompt")) {
      const txt = String(a.append || "").trim();
      if (!txt) {
        skipped.push({ action: a, reason: "Testo da aggiungere mancante." });
        continue;
      }
      promptAppend += (promptAppend ? "\n" : "") + txt;
      applied.push(a);
    }

    // Step 6: aggiorna tenant.metadata se necessario
    if (themeChanged || promptAppend) {
      const meta = { ...(tenant.metadata || {}) };
      if (themeChanged) meta.theme = nextTheme;
      if (promptAppend) {
        const prev = String(meta.initialPrompt || "").trim();
        meta.initialPrompt = prev ? `${prev}\n${promptAppend}` : promptAppend;
      }
      meta.lastRevisionAt = new Date().toISOString();
      await tx
        .update(schema.mcTenants)
        .set({ metadata: meta, updatedAt: new Date() })
        .where(eq(schema.mcTenants.id, tenant.id));
    }
  });

  return { applied, skipped, themeChanged, promptAppendAdded: Boolean(promptAppend) };
}

// ============================================================
// Public entry point
// ============================================================

export async function runRevision({ tenant, requestText, ownerUserId, logger = console, autoBuild = true }) {
  const text = String(requestText || "").trim();
  if (!text) throw err("NO_TEXT", "Scrivi cosa vuoi modificare.");

  // 1) Crea revision row pending
  const initRows = await db.insert(schema.mcAppRevisions).values({
    tenantId: tenant.id,
    createdByUserId: ownerUserId,
    requestText: text.slice(0, 5000),
    status: "interpreting",
    interpretation: {},
    patchApplied: {},
  }).returning();
  const revisionId = initRows[0].id;

  // 2) Carica entita' attuali
  const entities = await db
    .select()
    .from(schema.mcAppEntities)
    .where(eq(schema.mcAppEntities.tenantId, tenant.id));

  // 3) AI call
  const systemPrompt = buildRevisionSystemPrompt({ tenant, entities });
  const aiMessages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: text.slice(0, 5000) },
  ];
  const aiModel = config.orchestrator.model;
  let ai;
  try {
    ai = await callOpenRouterChat({
      messages: aiMessages,
      model: aiModel,
      maxTokens: config.orchestrator.maxTokens,
      temperature: 0.2,
      metadata: { feature: "revision-interpret", tenantId: tenant.id },
      user: ownerUserId,
    });
  } catch (e) {
    await logOrchestratorFailure({
      tenantId: tenant.id,
      feature: "revision-interpret",
      model: aiModel,
      err: e,
      requestMetadata: { revisionId, ownerUserId },
    });
    await markRevisionFailed(revisionId, e?.code === "OPENROUTER_NOT_CONFIGURED" ? "AI non configurata." : "Servizio AI non disponibile.");
    throw err(e?.code === "OPENROUTER_NOT_CONFIGURED" ? "AI_NOT_CONFIGURED" : "AI_UNAVAILABLE",
      e?.code === "OPENROUTER_NOT_CONFIGURED" ? "AI non configurata." : "Servizio AI temporaneamente non disponibile.");
  }

  // Log usage success (best-effort, non blocca)
  logOrchestratorSuccess({
    tenantId: tenant.id,
    feature: "revision-interpret",
    model: aiModel,
    messages: aiMessages,
    ai,
    requestMetadata: { revisionId, ownerUserId },
  });

  // 4) Parse + validate JSON
  const parsed = parseJsonRobust(ai.reply);
  if (!isObj(parsed) || !Array.isArray(parsed.actions)) {
    await markRevisionFailed(revisionId, "Non ho capito la richiesta.");
    throw err("AI_INVALID_RESPONSE", "Non ho capito la richiesta. Prova a riformularla in modo piu' diretto.");
  }

  const summary = String(parsed.summary || "").slice(0, 280);
  const actions = parsed.actions.filter(isObj);

  if (actions.length === 0) {
    // L'AI ha capito ma non ha potuto fare nulla. Salviamo comunque.
    await db.update(schema.mcAppRevisions).set({
      interpretation: { summary, actions: [] },
      patchApplied: { applied: [], skipped: [] },
      status: "applied", // nessuna action ma non e' un errore tecnico
    }).where(eq(schema.mcAppRevisions.id, revisionId));
    throw err("NO_VALID_ACTIONS", summary || "Nessuna modifica applicabile a partire dalla tua richiesta.");
  }

  // 5) Apply in transazione
  let result;
  try {
    result = await applyActionsInTransaction({ tenant, entities, actions, ownerUserId });
  } catch (e) {
    logger?.error?.({ err: e, tenantId: tenant.id }, "revision apply failed");
    await markRevisionFailed(revisionId, "Errore applicazione modifiche.");
    throw err("DB_FAILED", "Errore applicazione modifiche.", { cause: e });
  }

  // 6) Se nulla e' stato applicato, segnala
  if (result.applied.length === 0) {
    await db.update(schema.mcAppRevisions).set({
      interpretation: { summary, actions },
      patchApplied: { applied: [], skipped: result.skipped },
      status: "applied",
    }).where(eq(schema.mcAppRevisions.id, revisionId));
    throw err("NO_VALID_ACTIONS",
      result.skipped[0]?.reason || "Nessuna modifica applicata.",
      { skipped: result.skipped });
  }

  // 7) Enqueue build (skipSchema=true: lo schema l'abbiamo gia' patchato a mano)
  let buildId = null;
  if (autoBuild) {
    try {
      const refreshed = await db.select().from(schema.mcTenants)
        .where(eq(schema.mcTenants.id, tenant.id)).limit(1);
      const tenantFresh = refreshed[0] || tenant;
      const { build } = await enqueueBuild({
        tenant: tenantFresh,
        ownerUserId,
        options: { skipSchema: true },
        logger,
      });
      buildId = build.id;
    } catch (e) {
      logger?.warn?.({ err: e, tenantId: tenant.id }, "enqueueBuild after revision failed (revision was applied)");
    }
  }

  // 8) Finalizza revision row
  const updated = await db.update(schema.mcAppRevisions).set({
    interpretation: { summary, actions },
    patchApplied: {
      applied: result.applied,
      skipped: result.skipped,
      themeChanged: result.themeChanged,
      promptAppendAdded: result.promptAppendAdded,
    },
    buildId,
    status: "applied",
  }).where(eq(schema.mcAppRevisions.id, revisionId)).returning();

  return {
    revision: publicRevision(updated[0]),
    buildId,
    summary,
    applied: result.applied,
    skipped: result.skipped,
  };
}

async function markRevisionFailed(revisionId, message) {
  try {
    await db.update(schema.mcAppRevisions).set({
      status: "failed",
      errorMessage: String(message || "").slice(0, 1000),
    }).where(eq(schema.mcAppRevisions.id, revisionId));
  } catch {}
}

export function publicRevision(r) {
  if (!r) return null;
  return {
    id: r.id,
    tenantId: r.tenantId,
    createdByUserId: r.createdByUserId,
    requestText: r.requestText,
    interpretation: r.interpretation || {},
    patchApplied: r.patchApplied || {},
    buildId: r.buildId || null,
    status: r.status,
    errorMessage: r.errorMessage || null,
    createdAt: r.createdAt,
  };
}

export async function listRevisions(tenantId, { limit = 50 } = {}) {
  const n = Math.min(100, Math.max(1, Math.trunc(Number(limit) || 50)));
  const rows = await db
    .select()
    .from(schema.mcAppRevisions)
    .where(eq(schema.mcAppRevisions.tenantId, tenantId))
    .orderBy(schema.mcAppRevisions.createdAt) // ascending per chat (vecchio -> nuovo)
    .limit(n);
  return rows.map(publicRevision);
}

export async function getRevision(tenantId, revisionId) {
  const rows = await db
    .select()
    .from(schema.mcAppRevisions)
    .where(and(eq(schema.mcAppRevisions.tenantId, tenantId), eq(schema.mcAppRevisions.id, revisionId)))
    .limit(1);
  return rows[0] ? publicRevision(rows[0]) : null;
}
