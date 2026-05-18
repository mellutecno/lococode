// AI proxy gestito per le app generate.
// L'app chiama MelluCode, MelluCode chiama OpenRouter: la chiave resta sul
// server e ogni chiamata viene tracciata su quota tenant.
import { and, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { config } from "../config.js";
import { callOpenRouterChat } from "../utils/openRouterClient.js";
import {
  creditsToMicros,
  costMicrosFromUsage,
  estimateMessageTokens,
  microsToCredits,
  nextMonthBoundary,
  normalizeUsage,
} from "../utils/aiCost.js";

function requireAppUser(req, reply) {
  if (req.user?.kind !== "app_user" || !req.user?.tenantId || !req.user?.sub) {
    reply.code(401).send({ error: "Token app non valido." });
    return false;
  }
  return true;
}

async function currentAppUser(req, reply) {
  if (!requireAppUser(req, reply)) return null;

  const rows = await db
    .select({ user: schema.mcAppUsers, tenant: schema.mcTenants })
    .from(schema.mcAppUsers)
    .innerJoin(schema.mcTenants, eq(schema.mcAppUsers.tenantId, schema.mcTenants.id))
    .where(and(
      eq(schema.mcAppUsers.id, req.user.sub),
      eq(schema.mcAppUsers.tenantId, req.user.tenantId)
    ))
    .limit(1);

  const row = rows[0];
  if (!row || row.tenant.status !== "active") {
    reply.code(401).send({ error: "App non disponibile." });
    return null;
  }
  return row;
}

function allowedModels() {
  return config.openrouter.allowedModels.length
    ? config.openrouter.allowedModels
    : [config.openrouter.defaultModel];
}

function pickModel(model) {
  const candidate = String(model || config.openrouter.defaultModel).trim();
  const allowed = allowedModels();
  if (!allowed.includes(candidate)) return null;
  return candidate;
}

function clampMaxTokens(value) {
  const n = Number(value ?? config.openrouter.maxTokensDefault);
  const clean = Number.isFinite(n) ? Math.trunc(n) : config.openrouter.maxTokensDefault;
  return Math.max(16, Math.min(config.openrouter.maxTokensLimit, clean));
}

function cleanTemperature(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  return Math.max(0, Math.min(2, n));
}

function cleanMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value;
}

function normalizeMessages(messages) {
  if (!Array.isArray(messages)) return null;
  const allowedRoles = new Set(["system", "user", "assistant"]);
  const result = [];

  for (const msg of messages) {
    const role = String(msg?.role || "").trim();
    if (!allowedRoles.has(role)) return null;
    if (typeof msg?.content !== "string") return null;
    const content = msg.content.trim();
    if (!content) return null;
    result.push({ role, content: content.slice(0, 20000) });
  }

  return result.length ? result.slice(0, 50) : null;
}

function publicQuota(q) {
  const limit = q?.monthlyLimitMicros ?? 0;
  const used = q?.usedThisPeriodMicros ?? 0;
  const remaining = Math.max(0, limit - used);
  return {
    monthlyLimitCredits: microsToCredits(limit),
    usedThisPeriodCredits: microsToCredits(used),
    remainingCredits: microsToCredits(remaining),
    periodStartedAt: q?.periodStartedAt ?? null,
    periodEndsAt: q?.periodEndsAt ?? null,
    hardLimit: q?.hardLimit ?? true,
  };
}

async function getOrCreateQuota(tenantId) {
  const rows = await db
    .select()
    .from(schema.mcAiQuotas)
    .where(eq(schema.mcAiQuotas.tenantId, tenantId))
    .limit(1);

  let quota = rows[0];
  if (!quota) {
    const now = new Date();
    const inserted = await db
      .insert(schema.mcAiQuotas)
      .values({
        tenantId,
        monthlyLimitMicros: creditsToMicros(config.openrouter.defaultMonthlyCredits),
        usedThisPeriodMicros: 0,
        periodStartedAt: now,
        periodEndsAt: nextMonthBoundary(now),
      })
      .returning();
    quota = inserted[0];
  }

  if (quota.periodEndsAt && new Date(quota.periodEndsAt) <= new Date()) {
    const now = new Date();
    const updated = await db
      .update(schema.mcAiQuotas)
      .set({
        usedThisPeriodMicros: 0,
        periodStartedAt: now,
        periodEndsAt: nextMonthBoundary(now),
        updatedAt: now,
      })
      .where(eq(schema.mcAiQuotas.tenantId, tenantId))
      .returning();
    quota = updated[0];
  }

  return quota;
}

function quotaAllowsCall(quota) {
  const limit = quota.monthlyLimitMicros ?? 0;
  const used = quota.usedThisPeriodMicros ?? 0;
  const remaining = Math.max(0, limit - used);
  const reserve = creditsToMicros(config.openrouter.reservePerRequestCredits);

  if (!quota.hardLimit) return { ok: true, remaining, reserve };
  if (limit <= 0) return { ok: false, remaining, reserve, reason: "inactive" };
  if (reserve > 0 && remaining < reserve) return { ok: false, remaining, reserve, reason: "low_credit" };
  if (remaining <= 0) return { ok: false, remaining, reserve, reason: "empty" };
  return { ok: true, remaining, reserve };
}

async function logFailure({ tenantId, appUserId, model, metadata, err }) {
  await db.insert(schema.mcAiUsage).values({
    tenantId,
    appUserId,
    model,
    status: "failed",
    error: err?.message ? String(err.message).slice(0, 1000) : "Errore AI.",
    requestMetadata: metadata,
    responseMetadata: {
      code: err?.code ?? null,
      status: err?.status ?? null,
    },
  }).catch(() => {});
}

export default async function aiRoutes(fastify) {
  fastify.get(
    "/quota",
    { onRequest: [fastify.authenticate] },
    async (req, reply) => {
      const ctx = await currentAppUser(req, reply);
      if (!ctx) return reply;
      const quota = await getOrCreateQuota(ctx.tenant.id);
      return { quota: publicQuota(quota) };
    }
  );

  fastify.get(
    "/usage",
    {
      onRequest: [fastify.authenticate],
      schema: {
        querystring: {
          type: "object",
          properties: {
            limit: { type: "string" },
          },
          additionalProperties: false,
        },
      },
    },
    async (req, reply) => {
      const ctx = await currentAppUser(req, reply);
      if (!ctx) return reply;
      const limit = Math.max(1, Math.min(50, Number(req.query.limit ?? 20) || 20));
      const rows = await db
        .select()
        .from(schema.mcAiUsage)
        .where(eq(schema.mcAiUsage.tenantId, ctx.tenant.id))
        .orderBy(desc(schema.mcAiUsage.createdAt))
        .limit(limit);
      return {
        usage: rows.map((row) => ({
          id: row.id,
          model: row.model,
          status: row.status,
          promptTokens: row.promptTokens,
          completionTokens: row.completionTokens,
          totalTokens: row.totalTokens,
          costCredits: microsToCredits(row.costMicros),
          costEstimated: row.costEstimated,
          createdAt: row.createdAt,
        })),
      };
    }
  );

  fastify.post(
    "/chat",
    {
      onRequest: [fastify.authenticate],
      schema: {
        body: {
          type: "object",
          required: ["messages"],
          properties: {
            model: { type: "string", maxLength: 160 },
            messages: {
              type: "array",
              minItems: 1,
              maxItems: 50,
              items: {
                type: "object",
                required: ["role", "content"],
                properties: {
                  role: { type: "string", enum: ["system", "user", "assistant"] },
                  content: { type: "string", minLength: 1, maxLength: 20000 },
                },
                additionalProperties: false,
              },
            },
            maxTokens: { type: "integer", minimum: 16, maximum: 8192 },
            temperature: { type: "number", minimum: 0, maximum: 2 },
            metadata: { type: "object", additionalProperties: true },
          },
          additionalProperties: false,
        },
      },
    },
    async (req, reply) => {
      const ctx = await currentAppUser(req, reply);
      if (!ctx) return reply;

      const messages = normalizeMessages(req.body.messages);
      if (!messages) return reply.code(400).send({ error: "Messaggi AI non validi." });

      const model = pickModel(req.body.model);
      if (!model) {
        return reply.code(400).send({
          error: "Modello AI non abilitato per questa app.",
          allowedModels: allowedModels(),
        });
      }

      const quota = await getOrCreateQuota(ctx.tenant.id);
      const quotaCheck = quotaAllowsCall(quota);
      if (!quotaCheck.ok) {
        return reply.code(402).send({
          error: quotaCheck.reason === "inactive"
            ? "Credito AI non attivo per questa app."
            : "Credito AI insufficiente.",
          quota: publicQuota(quota),
        });
      }

      const maxTokens = clampMaxTokens(req.body.maxTokens);
      const temperature = cleanTemperature(req.body.temperature);
      const metadata = {
        ...cleanMetadata(req.body.metadata),
        tenantSlug: ctx.tenant.slug,
      };

      let ai;
      try {
        ai = await callOpenRouterChat({
          messages,
          model,
          maxTokens,
          temperature,
          metadata,
          user: ctx.user.id,
        });
      } catch (err) {
        await logFailure({
          tenantId: ctx.tenant.id,
          appUserId: ctx.user.id,
          model,
          metadata,
          err,
        });
        const status = err?.code === "OPENROUTER_NOT_CONFIGURED" ? 503 : 502;
        return reply.code(status).send({
          error: err?.code === "OPENROUTER_NOT_CONFIGURED"
            ? "AI non configurata."
            : "Servizio AI temporaneamente non disponibile.",
        });
      }

      const fallbackPromptTokens = estimateMessageTokens(messages);
      const fallbackCompletionTokens = Math.max(1, Math.ceil((ai.reply || "").length / 4));
      const usage = normalizeUsage(ai.usage || {}, { fallbackPromptTokens, fallbackCompletionTokens });
      const cost = costMicrosFromUsage(
        ai.usage || {},
        usage.totalTokens,
        config.openrouter.fallbackCostPer1kTokensCredits
      );

      let updatedQuota;
      await db.transaction(async (tx) => {
        const rows = await tx
          .update(schema.mcAiQuotas)
          .set({
            usedThisPeriodMicros: sql`${schema.mcAiQuotas.usedThisPeriodMicros} + ${cost.costMicros}`,
            updatedAt: new Date(),
          })
          .where(eq(schema.mcAiQuotas.tenantId, ctx.tenant.id))
          .returning();
        updatedQuota = rows[0];

        await tx.insert(schema.mcAiUsage).values({
          tenantId: ctx.tenant.id,
          appUserId: ctx.user.id,
          model,
          generationId: ai.id ?? null,
          status: "succeeded",
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          totalTokens: usage.totalTokens,
          reasoningTokens: usage.reasoningTokens,
          cachedTokens: usage.cachedTokens,
          costMicros: cost.costMicros,
          costEstimated: cost.estimated,
          requestMetadata: metadata,
          responseMetadata: {
            finishReason: ai.choices?.[0]?.finish_reason ?? null,
            providerModel: ai.model ?? null,
          },
        });
      });

      return {
        reply: ai.reply,
        message: ai.choices?.[0]?.message ?? { role: "assistant", content: ai.reply },
        model: ai.model ?? model,
        generationId: ai.id ?? null,
        usage: {
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          totalTokens: usage.totalTokens,
          reasoningTokens: usage.reasoningTokens,
          cachedTokens: usage.cachedTokens,
          costCredits: microsToCredits(cost.costMicros),
          costEstimated: cost.estimated,
          quota: publicQuota(updatedQuota),
        },
      };
    }
  );
}
