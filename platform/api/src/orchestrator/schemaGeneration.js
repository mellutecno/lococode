// Logica core di schema-generation, estratta da routes/tenants.js per essere
// riutilizzabile sia dall'endpoint sincrono POST /v1/tenants/:id/generate-schema
// sia dal worker async buildRunner.runBuild.
//
// Input atteso: { tenant, promptOverride?, ownerUserId, logger? }
// Output: { entities, sector, theme, errors } oppure throw con err.code:
//   - "NO_PROMPT"           : nessun prompt disponibile
//   - "AI_NOT_CONFIGURED"   : OpenRouter non configurato
//   - "AI_UNAVAILABLE"      : errore upstream OpenRouter
//   - "AI_INVALID_RESPONSE" : reply non e' un JSON array
//   - "NO_VALID_ENTITIES"   : nessuna entita' validata
//   - "DB_SAVE_FAILED"      : errore inserimento DB
//
// In tutti i casi err.userMessage e' un messaggio leggibile dall'utente.

import { and, eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { config } from "../config.js";
import { callOpenRouterChat } from "../utils/openRouterClient.js";
import { buildSystemPrompt, extractJsonArray, validateEntityDef, pickThemeFromEntities } from "../utils/orchestrator.js";
import { publicEntity } from "../utils/entities.js";
import { inferSector } from "./sectors/_index.js";

function err(code, userMessage, extra = {}) {
  const e = new Error(userMessage);
  e.code = code;
  e.userMessage = userMessage;
  Object.assign(e, extra);
  return e;
}

export async function runSchemaGeneration({ tenant, promptOverride, ownerUserId, logger = console }) {
  if (!tenant?.id) throw err("INVALID_INPUT", "Tenant mancante.");

  const prompt = String(promptOverride || tenant.metadata?.initialPrompt || "").trim();
  if (!prompt) {
    throw err("NO_PROMPT", "Nessun prompt disponibile per questa app.");
  }

  // Inferenza settore (deterministica). Se trovata, l'AI ottiene un
  // riferimento mirato + theme raccomandato. Sotto soglia: null e l'AI
  // genera fresh.
  const inferredSector = inferSector(prompt);
  const systemPrompt = buildSystemPrompt({
    sector: inferredSector,
    designBrief: true,
    themes: true,
    includeCatalog: true,
  });

  let ai;
  try {
    ai = await callOpenRouterChat({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt.slice(0, 5000) },
      ],
      model: config.orchestrator.model,
      maxTokens: config.orchestrator.maxTokens,
      temperature: 0.2,
      metadata: { feature: "schema-generation", tenantId: tenant.id, sectorHint: inferredSector?.id ?? null },
      user: ownerUserId,
    });
  } catch (e) {
    if (e?.code === "OPENROUTER_NOT_CONFIGURED") {
      throw err("AI_NOT_CONFIGURED", "AI non configurata.", { cause: e });
    }
    throw err("AI_UNAVAILABLE", "Servizio AI temporaneamente non disponibile.", { cause: e });
  }

  const array = extractJsonArray(ai.reply);
  if (!Array.isArray(array)) {
    throw err("AI_INVALID_RESPONSE", "Risposta AI non valida.", { reply: ai.reply?.slice(0, 500) });
  }

  const capped = array.slice(0, config.orchestrator.maxEntities);
  const validated = capped.map((raw) => validateEntityDef(raw));
  const valid = validated.filter((v) => v.ok);
  const invalid = validated.filter((v) => !v.ok);

  if (valid.length === 0) {
    throw err("NO_VALID_ENTITIES", "Nessuna entita' valida generata.", {
      details: invalid.map((v) => v.error),
    });
  }

  const finalTheme = pickThemeFromEntities(valid, inferredSector?.theme || "dark-electric");
  const finalSector = inferredSector?.id ?? null;

  let created;
  try {
    created = await db.transaction(async (tx) => {
      const nextTenantMeta = {
        ...(tenant.metadata || {}),
        sector: finalSector,
        theme: finalTheme,
        schemaGeneratedAt: new Date().toISOString(),
      };
      await tx
        .update(schema.mcTenants)
        .set({ metadata: nextTenantMeta, updatedAt: new Date() })
        .where(eq(schema.mcTenants.id, tenant.id));

      const out = [];
      for (const v of valid) {
        const values = {
          tenantId: tenant.id,
          name: v.values.name,
          label: v.values.label,
          jsonSchema: v.values.schema,
          permissions: v.values.permissions,
          metadata: v.values.metadata,
          updatedAt: new Date(),
        };

        const existing = await tx
          .select({ id: schema.mcAppEntities.id })
          .from(schema.mcAppEntities)
          .where(and(
            eq(schema.mcAppEntities.tenantId, tenant.id),
            eq(schema.mcAppEntities.name, v.values.name)
          ))
          .limit(1);

        if (existing[0]) {
          const rows = await tx
            .update(schema.mcAppEntities)
            .set(values)
            .where(eq(schema.mcAppEntities.id, existing[0].id))
            .returning();
          out.push(publicEntity(rows[0]));
        } else {
          const rows = await tx
            .insert(schema.mcAppEntities)
            .values(values)
            .returning();
          out.push(publicEntity(rows[0]));
        }
      }
      return out;
    });
  } catch (e) {
    logger?.warn?.({ err: e, tenantId: tenant.id }, "schemaGeneration: DB save failed");
    throw err("DB_SAVE_FAILED", "Errore durante il salvataggio delle entita'.", { cause: e });
  }

  return {
    entities: created,
    created: created.length,
    sector: finalSector,
    theme: finalTheme,
    errors: invalid.map((e) => e.error),
  };
}
