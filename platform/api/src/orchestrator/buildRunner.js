// Worker async per la pipeline schema + frontend di un'app.
// Salva stato su mc_app_builds, viene pollato dalla Console per UI live.
//
// Pattern: setImmediate fire-and-forget. La build resta nello stesso process
// PM2 (no queue esterna). Su crash del process, le build "running" restano
// orfane in DB: una sweep periodica le marcera' failed (TODO Step 6).
//
// Lock leggero: prima di enqueueBuild controlliamo se c'e' gia' un build
// queued/running per il tenant. Se si', restituiamo conflitto. Race possibile
// fra select e insert: per ora accettabile (un user normale non clicca due
// volte in mezzo secondo). Se diventa un problema, aggiungere advisory lock
// Postgres.

import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { runSchemaGeneration } from "./schemaGeneration.js";
import { buildGeneratedFrontend } from "./frontendBuilder.js";

const ACTIVE_STATUSES = ["queued", "running"];

export function publicBuild(b) {
  if (!b) return null;
  return {
    id: b.id,
    tenantId: b.tenantId,
    status: b.status,
    stage: b.stage,
    progress: b.progress,
    messages: Array.isArray(b.messages) ? b.messages : [],
    options: b.options || {},
    errorMessage: b.errorMessage || null,
    startedAt: b.startedAt || null,
    finishedAt: b.finishedAt || null,
    createdAt: b.createdAt,
  };
}

// Cerca un build attivo per il tenant. Ritorna la row se esiste, null altrimenti.
export async function findActiveBuild(tenantId) {
  const rows = await db
    .select()
    .from(schema.mcAppBuilds)
    .where(and(
      eq(schema.mcAppBuilds.tenantId, tenantId),
      inArray(schema.mcAppBuilds.status, ACTIVE_STATUSES)
    ))
    .orderBy(desc(schema.mcAppBuilds.createdAt))
    .limit(1);
  return rows[0] || null;
}

export async function listBuilds(tenantId, { limit = 20 } = {}) {
  const rows = await db
    .select()
    .from(schema.mcAppBuilds)
    .where(eq(schema.mcAppBuilds.tenantId, tenantId))
    .orderBy(desc(schema.mcAppBuilds.createdAt))
    .limit(Math.min(100, Math.max(1, Math.trunc(Number(limit) || 20))));
  return rows.map(publicBuild);
}

export async function getBuild(tenantId, buildId) {
  const rows = await db
    .select()
    .from(schema.mcAppBuilds)
    .where(and(
      eq(schema.mcAppBuilds.tenantId, tenantId),
      eq(schema.mcAppBuilds.id, buildId)
    ))
    .limit(1);
  return rows[0] ? publicBuild(rows[0]) : null;
}

// Helper: aggiunge un messaggio human-readable allo storico build (push-only).
// Usa update SQL non transazionale, OK perche' la corsa concorrente al massimo
// perde un messaggio (best-effort UI, non sorgente di verita').
async function pushMessage(buildId, message, patch = {}) {
  const existing = await db
    .select({ messages: schema.mcAppBuilds.messages })
    .from(schema.mcAppBuilds)
    .where(eq(schema.mcAppBuilds.id, buildId))
    .limit(1);
  const prev = Array.isArray(existing[0]?.messages) ? existing[0].messages : [];
  const next = [...prev, { at: new Date().toISOString(), text: String(message).slice(0, 500) }];
  await db
    .update(schema.mcAppBuilds)
    .set({ messages: next, ...patch })
    .where(eq(schema.mcAppBuilds.id, buildId));
}

// Crea il record build (status=queued) e lancia il worker in fire-and-forget.
// Se ownerUserId non possiede tenantId, il caller deve gia' aver verificato:
// qui ci fidiamo. Ritorna { build, conflicted? } -- conflicted true se gia'
// un build attivo e in tal caso non lancia worker, ritorna il build esistente.
export async function enqueueBuild({ tenant, ownerUserId, options = {}, logger = console }) {
  if (!tenant?.id) throw new Error("enqueueBuild: tenant.id mancante");
  if (!ownerUserId) throw new Error("enqueueBuild: ownerUserId mancante");

  const active = await findActiveBuild(tenant.id);
  if (active) {
    return { build: publicBuild(active), conflicted: true };
  }

  const rows = await db
    .insert(schema.mcAppBuilds)
    .values({
      tenantId: tenant.id,
      status: "queued",
      stage: "queued",
      progress: 0,
      messages: [{ at: new Date().toISOString(), text: "Build accodata." }],
      options: options || {},
    })
    .returning();
  const build = rows[0];

  // Lancia il worker su prossimo tick. NON await: il caller risponde subito.
  setImmediate(() => {
    runBuild(build.id, { ownerUserId, logger }).catch((e) => {
      logger?.error?.({ err: e, buildId: build.id }, "runBuild crashed in fire-and-forget");
    });
  });

  return { build: publicBuild(build), conflicted: false };
}

// Worker: esegue la pipeline e aggiorna lo stato del build via DB.
// NON throw: ogni errore viene catturato e segnato come failed.
export async function runBuild(buildId, { ownerUserId, logger = console } = {}) {
  // 1) load build
  const buildRows = await db
    .select()
    .from(schema.mcAppBuilds)
    .where(eq(schema.mcAppBuilds.id, buildId))
    .limit(1);
  const build = buildRows[0];
  if (!build) {
    logger?.warn?.({ buildId }, "runBuild: build not found");
    return;
  }

  // 2) load tenant
  const tenantRows = await db
    .select()
    .from(schema.mcTenants)
    .where(eq(schema.mcTenants.id, build.tenantId))
    .limit(1);
  let tenant = tenantRows[0];
  if (!tenant) {
    await markFailed(buildId, "App non trovata.", "tenant deleted before build started");
    return;
  }

  // 3) start
  await db
    .update(schema.mcAppBuilds)
    .set({
      status: "running",
      stage: "schema",
      progress: 5,
      startedAt: new Date(),
    })
    .where(eq(schema.mcAppBuilds.id, buildId));
  await pushMessage(buildId, "Leggo la tua richiesta e preparo la struttura.");

  try {
    // 4) schema generation (skip se richiesto E ci sono gia' entita')
    const skipSchema = Boolean(build.options?.skipSchema);
    let entityRows = await db
      .select()
      .from(schema.mcAppEntities)
      .where(eq(schema.mcAppEntities.tenantId, tenant.id));

    if (!skipSchema || entityRows.length === 0) {
      try {
        const result = await runSchemaGeneration({
          tenant,
          ownerUserId,
          logger,
        });
        // ricarica tenant per metadata aggiornati (sector/theme)
        const t = await db.select().from(schema.mcTenants)
          .where(eq(schema.mcTenants.id, tenant.id)).limit(1);
        tenant = t[0] || tenant;
        await pushMessage(buildId, `Struttura pronta: ${result.created} tabelle dati.`);
      } catch (e) {
        await markFailed(buildId, e.userMessage || "Errore generazione struttura.", e.stack || String(e));
        return;
      }
      // ricarica entita'
      entityRows = await db
        .select()
        .from(schema.mcAppEntities)
        .where(eq(schema.mcAppEntities.tenantId, tenant.id));
    } else {
      await pushMessage(buildId, "Riuso struttura dati esistente.");
    }

    if (entityRows.length === 0) {
      await markFailed(buildId, "Nessuna tabella dati disponibile.", "entities array empty after schema phase");
      return;
    }

    // 5) frontend build
    await db
      .update(schema.mcAppBuilds)
      .set({ stage: "frontend", progress: 40 })
      .where(eq(schema.mcAppBuilds.id, buildId));
    await pushMessage(buildId, "Costruisco l'interfaccia (puo' richiedere qualche secondo).");

    let buildResult;
    try {
      buildResult = await buildGeneratedFrontend({ tenant, entities: entityRows });
    } catch (e) {
      logger?.warn?.({ err: e, tenantId: tenant.id }, "frontend build failed");
      await markFailed(buildId, "Frontend non generato.", e?.stack || String(e));
      return;
    }

    // 6) update tenant.metadata.frontend
    const nextMetadata = {
      ...(tenant.metadata || {}),
      frontend: {
        url: buildResult.url,
        generatedAt: new Date().toISOString(),
        buildMs: buildResult.buildMs,
        theme: buildResult.theme,
        layout: buildResult.layout,
        primaryEntity: buildResult.primaryEntity,
      },
    };
    await db
      .update(schema.mcTenants)
      .set({ metadata: nextMetadata, updatedAt: new Date() })
      .where(eq(schema.mcTenants.id, tenant.id));

    await pushMessage(buildId, "App pronta!", {
      status: "succeeded",
      stage: "done",
      progress: 100,
      finishedAt: new Date(),
    });
  } catch (e) {
    logger?.error?.({ err: e, buildId }, "runBuild unexpected error");
    await markFailed(buildId, "Errore inatteso durante la build.", e?.stack || String(e));
  }
}

async function markFailed(buildId, userMessage, technicalDetails) {
  try {
    await pushMessage(buildId, userMessage, {
      status: "failed",
      stage: "failed",
      errorMessage: userMessage,
      errorDetails: String(technicalDetails || "").slice(0, 4000),
      finishedAt: new Date(),
    });
  } catch {
    // best-effort
  }
}
