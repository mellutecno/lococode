// Email API gestita per le app generate.
// Per evitare abusi non e' un relay pubblico: richiede JWT app-auth e, per
// questa prima versione, ruolo admin dell'app.
import { and, eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { normalizeEmail } from "../utils/normalize.js";
import { config } from "../config.js";
import { sendTransactionalEmail } from "../utils/emailSender.js";

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

function normalizeRecipients(value) {
  const raw = Array.isArray(value) ? value : [value];
  const seen = new Set();
  const recipients = [];

  for (const item of raw) {
    const email = normalizeEmail(item);
    if (!email) return null;
    if (!seen.has(email)) {
      recipients.push(email);
      seen.add(email);
    }
  }

  return recipients;
}

function cleanMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value;
}

export default async function emailRoutes(fastify) {
  // --- POST /v1/email/send ---
  fastify.post(
    "/send",
    {
      onRequest: [fastify.authenticate],
      schema: {
        body: {
          type: "object",
          required: ["to", "subject"],
          properties: {
            to: {
              anyOf: [
                { type: "string", maxLength: 320 },
                {
                  type: "array",
                  minItems: 1,
                  maxItems: 10,
                  items: { type: "string", maxLength: 320 },
                },
              ],
            },
            subject: { type: "string", minLength: 1, maxLength: 200 },
            text: { type: "string", maxLength: 20000 },
            html: { type: "string", maxLength: 50000 },
            replyTo: { type: "string", maxLength: 320 },
            metadata: { type: "object", additionalProperties: true },
          },
          additionalProperties: false,
        },
      },
    },
    async (req, reply) => {
      const ctx = await currentAppUser(req, reply);
      if (!ctx) return reply;

      if (ctx.user.role !== "admin") {
        return reply.code(403).send({ error: "Solo admin app puo' inviare email." });
      }

      const recipients = normalizeRecipients(req.body.to);
      if (!recipients?.length) {
        return reply.code(400).send({ error: "Destinatario email non valido." });
      }

      const subject = String(req.body.subject || "").trim();
      const text = String(req.body.text || "").trim();
      const html = String(req.body.html || "").trim();
      if (!text && !html) {
        return reply.code(400).send({ error: "Inserisci testo o HTML dell'email." });
      }

      let replyTo = undefined;
      if (req.body.replyTo) {
        replyTo = normalizeEmail(req.body.replyTo);
        if (!replyTo) return reply.code(400).send({ error: "Reply-To non valido." });
      }

      const metadata = cleanMetadata(req.body.metadata);

      try {
        const info = await sendTransactionalEmail({
          to: recipients,
          subject,
          text,
          html,
          replyTo,
        });

        await db.insert(schema.mcEmailLog).values({
          tenantId: ctx.tenant.id,
          appUserId: ctx.user.id,
          to: recipients,
          subject,
          status: "sent",
          providerMessageId: info.messageId ?? null,
          metadata,
        });

        return reply.send({
          ok: true,
          messageId: info.messageId ?? null,
          accepted: info.accepted ?? recipients,
          rejected: info.rejected ?? [],
        });
      } catch (err) {
        const status = err?.code === "EMAIL_NOT_CONFIGURED" ? 503 : 502;
        await db.insert(schema.mcEmailLog).values({
          tenantId: ctx.tenant.id,
          appUserId: ctx.user.id,
          to: recipients,
          subject,
          status: "failed",
          error: err?.message ? String(err.message).slice(0, 1000) : "Errore invio email.",
          metadata,
        }).catch((logErr) => req.log.warn({ err: logErr }, "email failure log write failed"));

        req.log.warn({ err, tenantId: ctx.tenant.id }, "email send failed");
        return reply.code(status).send({
          error: err?.code === "EMAIL_NOT_CONFIGURED"
            ? "Email non configurata."
            : "Invio email fallito.",
        });
      }
    }
  );
}
