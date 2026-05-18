// Logger condiviso per mc_ai_usage usato dall'orchestrator (schema generation,
// revisioni chat). Pattern simile a routes/ai.js MA NON tocca le quote tenant
// perche' queste sono chiamate "di sistema" (costo MelluCode, non costo
// dell'app generata).
//
// Le chiamate orchestrator vengono attribuite al tenant per cui viene fatto
// il lavoro, cosi' nella reportistica "quanto e' costato creare l'app X"
// e' immediato.

import { db, schema } from "../db/index.js";
import { config } from "../config.js";
import { normalizeUsage, costMicrosFromUsage } from "./aiCost.js";

function estimateMessageTokens(messages) {
  let total = 0;
  for (const m of messages || []) {
    const t = typeof m?.content === "string" ? m.content : JSON.stringify(m?.content || "");
    total += Math.max(1, Math.ceil(t.length / 4)) + 4;
  }
  return Math.max(1, total);
}

// Logga una chiamata OpenRouter andata bene (usata dopo callOpenRouterChat).
// `feature` distingue orchestrator/revision/altro (filtrabile in report).
// Mai throw: silenziato perche' non vogliamo bloccare la pipeline se il log
// fallisce per qualsiasi motivo (DB sotto stress, schema migrato male, ecc).
export async function logOrchestratorSuccess({
  tenantId,
  feature,
  model,
  messages,
  ai,
  requestMetadata = {},
}) {
  try {
    const fallbackPromptTokens = estimateMessageTokens(messages);
    const fallbackCompletionTokens = Math.max(1, Math.ceil((ai?.reply || "").length / 4));
    const usage = normalizeUsage(ai?.usage || {}, { fallbackPromptTokens, fallbackCompletionTokens });
    const cost = costMicrosFromUsage(
      ai?.usage || {},
      usage.totalTokens,
      config.openrouter.fallbackCostPer1kTokensCredits
    );

    await db.insert(schema.mcAiUsage).values({
      tenantId,
      appUserId: null,                // niente app-user: e' sistema
      model,
      generationId: ai?.id ?? null,
      status: "succeeded",
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens: usage.totalTokens,
      reasoningTokens: usage.reasoningTokens,
      cachedTokens: usage.cachedTokens,
      costMicros: cost.costMicros,
      costEstimated: cost.estimated,
      requestMetadata: { feature, ...requestMetadata },
      responseMetadata: {
        finishReason: ai?.choices?.[0]?.finish_reason ?? null,
        providerModel: ai?.model ?? null,
      },
    });
  } catch {
    // Silenzioso: non blocchiamo la pipeline per un log fallito.
  }
}

export async function logOrchestratorFailure({
  tenantId,
  feature,
  model,
  err,
  requestMetadata = {},
}) {
  try {
    await db.insert(schema.mcAiUsage).values({
      tenantId,
      appUserId: null,
      model,
      status: "failed",
      error: err?.message ? String(err.message).slice(0, 1000) : "Errore AI.",
      requestMetadata: { feature, ...requestMetadata },
      responseMetadata: {
        code: err?.code ?? null,
        status: err?.status ?? null,
      },
    });
  } catch {
    // Silenzioso
  }
}
