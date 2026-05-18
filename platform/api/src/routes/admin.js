// Platform admin routes: gestione creator MelluCode e app/tenant.
// Protette da JWT creator + ruolo platform admin.
import { desc, eq, sql } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { deleteFile } from "../utils/fileStorage.js";
import { requirePlatformAdmin } from "../utils/platformAdmin.js";
import { sendTransactionalEmail } from "../utils/emailSender.js";

function publicUser(u, tenantsCount = 0) {
  return {
    id: u.id,
    email: u.email,
    name: u.name ?? null,
    role: u.role,
    emailVerifiedAt: u.emailVerifiedAt ?? null,
    createdAt: u.createdAt,
    tenantsCount: Number(tenantsCount || 0),
  };
}

function publicTenant(t, owner) {
  return {
    id: t.id,
    slug: t.slug,
    name: t.name,
    status: t.status,
    plan: t.plan,
    publicRegistrationEnabled: t.publicRegistrationEnabled,
    metadata: t.metadata,
    createdAt: t.createdAt,
    owner: owner ? {
      id: owner.id,
      email: owner.email,
      name: owner.name ?? null,
    } : null,
  };
}

function trimString(value, max = 20000) {
  return String(value || "").trim().slice(0, max);
}

async function auditAdmin(req, event, details = {}) {
  try {
    await db.insert(schema.mcAuditLog).values({
      userId: req.platformAdminUser?.id ?? req.user?.sub ?? null,
      event,
      ip: req.ip ?? null,
      userAgent: req.headers["user-agent"] ?? null,
      details,
    });
  } catch (err) {
    req.log.warn({ err, event }, "admin audit log write failed");
  }
}

async function deleteTenantCascade(tenantId) {
  const tenantRows = await db
    .select()
    .from(schema.mcTenants)
    .where(eq(schema.mcTenants.id, tenantId))
    .limit(1);
  const tenant = tenantRows[0];
  if (!tenant) return null;

  const files = await db
    .select({ storagePath: schema.mcAppFiles.storagePath })
    .from(schema.mcAppFiles)
    .where(eq(schema.mcAppFiles.tenantId, tenant.id));

  await db.delete(schema.mcTenants).where(eq(schema.mcTenants.id, tenant.id));
  await Promise.all(files.map((f) => deleteFile(f.storagePath)));

  return tenant;
}

export default async function adminRoutes(fastify) {
  fastify.addHook("onRequest", fastify.authenticate);
  fastify.addHook("preHandler", async (req, reply) => {
    const admin = await requirePlatformAdmin(req, reply);
    if (!admin) return reply;
  });

  fastify.get(
    "/users",
    {
      schema: {
        querystring: {
          type: "object",
          properties: {
            limit: { type: "integer", minimum: 1, maximum: 500 },
            offset: { type: "integer", minimum: 0 },
          },
          additionalProperties: false,
        },
      },
    },
    async (req) => {
      const limit = Number(req.query.limit ?? 100);
      const offset = Number(req.query.offset ?? 0);

      const [users, counts] = await Promise.all([
        db
          .select()
          .from(schema.mcUsers)
          .orderBy(desc(schema.mcUsers.createdAt))
          .limit(limit)
          .offset(offset),
        db
          .select({
            ownerUserId: schema.mcTenants.ownerUserId,
            count: sql`count(*)::int`,
          })
          .from(schema.mcTenants)
          .groupBy(schema.mcTenants.ownerUserId),
      ]);

      const countByUser = new Map(counts.map((row) => [row.ownerUserId, Number(row.count || 0)]));
      return {
        users: users.map((u) => publicUser(u, countByUser.get(u.id))),
        paging: { limit, offset },
      };
    }
  );

  fastify.delete(
    "/users/:id",
    {
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
          additionalProperties: false,
        },
      },
    },
    async (req, reply) => {
      if (req.params.id === req.platformAdminUser.id) {
        return reply.code(400).send({ error: "Non puoi eliminare l'account admin con cui sei entrato." });
      }

      const rows = await db
        .select()
        .from(schema.mcUsers)
        .where(eq(schema.mcUsers.id, req.params.id))
        .limit(1);
      const user = rows[0];
      if (!user) return reply.code(404).send({ error: "Utente non trovato." });

      const tenants = await db
        .select({ id: schema.mcTenants.id })
        .from(schema.mcTenants)
        .where(eq(schema.mcTenants.ownerUserId, user.id));

      for (const tenant of tenants) {
        await deleteTenantCascade(tenant.id);
      }
      await db.delete(schema.mcUsers).where(eq(schema.mcUsers.id, user.id));
      await auditAdmin(req, "admin.user.deleted", {
        targetUserId: user.id,
        targetEmail: user.email,
        deletedTenants: tenants.length,
      });

      return reply.code(204).send();
    }
  );

  fastify.post(
    "/users/:id/email",
    {
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
          additionalProperties: false,
        },
        body: {
          type: "object",
          required: ["subject"],
          properties: {
            subject: { type: "string", minLength: 1, maxLength: 200 },
            text: { type: "string", maxLength: 20000 },
            html: { type: "string", maxLength: 50000 },
          },
          additionalProperties: false,
        },
      },
    },
    async (req, reply) => {
      const rows = await db
        .select()
        .from(schema.mcUsers)
        .where(eq(schema.mcUsers.id, req.params.id))
        .limit(1);
      const user = rows[0];
      if (!user) return reply.code(404).send({ error: "Utente non trovato." });

      const subject = trimString(req.body.subject, 200);
      const text = trimString(req.body.text);
      const html = trimString(req.body.html, 50000);
      if (!text && !html) {
        return reply.code(400).send({ error: "Scrivi il testo dell'email prima di inviarla." });
      }

      try {
        const info = await sendTransactionalEmail({ to: user.email, subject, text, html });
        await auditAdmin(req, "admin.email.sent", {
          targetUserId: user.id,
          targetEmail: user.email,
          subject,
          messageId: info.messageId ?? null,
        });
        return {
          ok: true,
          to: user.email,
          messageId: info.messageId ?? null,
          accepted: info.accepted ?? [user.email],
          rejected: info.rejected ?? [],
        };
      } catch (err) {
        const status = err?.code === "EMAIL_NOT_CONFIGURED" ? 503 : 502;
        await auditAdmin(req, "admin.email.failed", {
          targetUserId: user.id,
          targetEmail: user.email,
          subject,
          error: err?.message ? String(err.message).slice(0, 1000) : "Invio fallito.",
        });
        return reply.code(status).send({
          error: err?.code === "EMAIL_NOT_CONFIGURED" ? "Email non configurata." : "Invio email fallito.",
        });
      }
    }
  );

  fastify.get(
    "/tenants",
    {
      schema: {
        querystring: {
          type: "object",
          properties: {
            limit: { type: "integer", minimum: 1, maximum: 500 },
            offset: { type: "integer", minimum: 0 },
          },
          additionalProperties: false,
        },
      },
    },
    async (req) => {
      const limit = Number(req.query.limit ?? 100);
      const offset = Number(req.query.offset ?? 0);
      const rows = await db
        .select({
          tenant: schema.mcTenants,
          owner: schema.mcUsers,
        })
        .from(schema.mcTenants)
        .innerJoin(schema.mcUsers, eq(schema.mcTenants.ownerUserId, schema.mcUsers.id))
        .orderBy(desc(schema.mcTenants.createdAt))
        .limit(limit)
        .offset(offset);

      return {
        tenants: rows.map((row) => publicTenant(row.tenant, row.owner)),
        paging: { limit, offset },
      };
    }
  );

  fastify.delete(
    "/tenants/:id",
    {
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
          additionalProperties: false,
        },
      },
    },
    async (req, reply) => {
      const tenant = await deleteTenantCascade(req.params.id);
      if (!tenant) return reply.code(404).send({ error: "App non trovata." });
      await auditAdmin(req, "admin.tenant.deleted", {
        tenantId: tenant.id,
        tenantSlug: tenant.slug,
        ownerUserId: tenant.ownerUserId,
      });
      return reply.code(204).send();
    }
  );
}
