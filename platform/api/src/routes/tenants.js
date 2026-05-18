// Tenant/app registry. Ogni app generata da MelluCode e' un tenant.
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { hashPassword } from "../utils/hash.js";
import { microsToCredits } from "../utils/aiCost.js";
import { deleteFile } from "../utils/fileStorage.js";
import { normalizeEmail, slugify } from "../utils/normalize.js";

function publicTenant(t) {
  if (!t) return null;
  return {
    id: t.id,
    slug: t.slug,
    name: t.name,
    status: t.status,
    plan: t.plan,
    publicRegistrationEnabled: t.publicRegistrationEnabled,
    metadata: t.metadata,
    createdAt: t.createdAt,
  };
}

function duplicateError(err) {
  return err?.code === "23505";
}

function numberFrom(row, key) {
  return Number(row?.[key] ?? 0);
}

async function countByTenant(table, tenantId) {
  const rows = await db
    .select({ value: sql`count(*)::int` })
    .from(table)
    .where(eq(table.tenantId, tenantId));
  return numberFrom(rows[0], "value");
}

async function tenantStats(tenantId) {
  const [
    appUsers,
    entities,
    records,
    files,
    fileBytesRows,
    quotaRows,
    aiRows,
  ] = await Promise.all([
    countByTenant(schema.mcAppUsers, tenantId),
    countByTenant(schema.mcAppEntities, tenantId),
    countByTenant(schema.mcAppRecords, tenantId),
    countByTenant(schema.mcAppFiles, tenantId),
    db
      .select({ value: sql`coalesce(sum(${schema.mcAppFiles.sizeBytes}), 0)::bigint` })
      .from(schema.mcAppFiles)
      .where(eq(schema.mcAppFiles.tenantId, tenantId)),
    db
      .select()
      .from(schema.mcAiQuotas)
      .where(eq(schema.mcAiQuotas.tenantId, tenantId))
      .limit(1),
    db
      .select({
        succeeded: sql`count(*) filter (where ${schema.mcAiUsage.status} = 'succeeded')::int`,
        failed: sql`count(*) filter (where ${schema.mcAiUsage.status} = 'failed')::int`,
        totalTokens: sql`coalesce(sum(${schema.mcAiUsage.totalTokens}), 0)::bigint`,
        costMicros: sql`coalesce(sum(${schema.mcAiUsage.costMicros}), 0)::bigint`,
        lastUsageAt: sql`max(${schema.mcAiUsage.createdAt})`,
      })
      .from(schema.mcAiUsage)
      .where(eq(schema.mcAiUsage.tenantId, tenantId)),
  ]);

  const quota = quotaRows[0];
  const used = quota?.usedThisPeriodMicros ?? 0;
  const limit = quota?.monthlyLimitMicros ?? 0;
  const remaining = Math.max(0, limit - used);
  const ai = aiRows[0] ?? {};

  return {
    appUsers,
    entities,
    records,
    files: {
      count: files,
      sizeBytes: numberFrom(fileBytesRows[0], "value"),
    },
    ai: {
      monthlyLimitCredits: microsToCredits(limit),
      usedThisPeriodCredits: microsToCredits(used),
      remainingCredits: microsToCredits(remaining),
      hardLimit: quota?.hardLimit ?? true,
      periodStartedAt: quota?.periodStartedAt ?? null,
      periodEndsAt: quota?.periodEndsAt ?? null,
      callsSucceeded: numberFrom(ai, "succeeded"),
      callsFailed: numberFrom(ai, "failed"),
      totalTokens: numberFrom(ai, "totalTokens"),
      costCredits: microsToCredits(numberFrom(ai, "costMicros")),
      lastUsageAt: ai?.lastUsageAt ?? null,
    },
  };
}

export default async function tenantRoutes(fastify) {
  fastify.get(
    "/",
    { onRequest: [fastify.authenticate] },
    async (req) => {
      const rows = await db
        .select()
        .from(schema.mcTenants)
        .where(eq(schema.mcTenants.ownerUserId, req.user.sub));
      return { tenants: rows.map(publicTenant) };
    }
  );

  fastify.get(
    "/:id/stats",
    {
      onRequest: [fastify.authenticate],
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
      const rows = await db
        .select()
        .from(schema.mcTenants)
        .where(and(
          eq(schema.mcTenants.id, req.params.id),
          eq(schema.mcTenants.ownerUserId, req.user.sub)
        ))
        .limit(1);

      const tenant = rows[0];
      if (!tenant) return reply.code(404).send({ error: "App non trovata." });

      return {
        tenant: publicTenant(tenant),
        stats: await tenantStats(tenant.id),
      };
    }
  );

  fastify.patch(
    "/:id",
    {
      onRequest: [fastify.authenticate],
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
          additionalProperties: false,
        },
        body: {
          type: "object",
          properties: {
            name: { type: "string", minLength: 2, maxLength: 160 },
            slug: { type: "string", minLength: 2, maxLength: 80 },
            publicRegistrationEnabled: { type: "boolean" },
          },
          additionalProperties: false,
        },
      },
    },
    async (req, reply) => {
      const updates = {};

      if (req.body.name !== undefined) {
        updates.name = String(req.body.name || "").trim();
      }
      if (req.body.slug !== undefined) {
        const nextSlug = slugify(req.body.slug);
        if (!nextSlug) return reply.code(400).send({ error: "Indirizzo app non valido." });
        updates.slug = nextSlug;
      }
      if (req.body.publicRegistrationEnabled !== undefined) {
        updates.publicRegistrationEnabled = req.body.publicRegistrationEnabled;
      }

      if (Object.keys(updates).length === 0) {
        return reply.code(400).send({ error: "Nessuna modifica valida." });
      }

      updates.updatedAt = new Date();

      try {
        const rows = await db
          .update(schema.mcTenants)
          .set(updates)
          .where(and(
            eq(schema.mcTenants.id, req.params.id),
            eq(schema.mcTenants.ownerUserId, req.user.sub)
          ))
          .returning();

        if (!rows[0]) return reply.code(404).send({ error: "App non trovata." });
        return { tenant: publicTenant(rows[0]) };
      } catch (err) {
        if (duplicateError(err)) {
          return reply.code(409).send({ error: "Esiste gia' un'app con questo slug." });
        }
        throw err;
      }
    }
  );

  fastify.delete(
    "/:id",
    {
      onRequest: [fastify.authenticate],
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
      const rows = await db
        .select()
        .from(schema.mcTenants)
        .where(and(
          eq(schema.mcTenants.id, req.params.id),
          eq(schema.mcTenants.ownerUserId, req.user.sub)
        ))
        .limit(1);

      const tenant = rows[0];
      if (!tenant) return reply.code(404).send({ error: "App non trovata." });

      const files = await db
        .select({ storagePath: schema.mcAppFiles.storagePath })
        .from(schema.mcAppFiles)
        .where(eq(schema.mcAppFiles.tenantId, tenant.id));

      await db
        .delete(schema.mcTenants)
        .where(and(
          eq(schema.mcTenants.id, tenant.id),
          eq(schema.mcTenants.ownerUserId, req.user.sub)
        ));

      await Promise.all(files.map((f) => deleteFile(f.storagePath)));
      return reply.code(204).send();
    }
  );

  fastify.post(
    "/",
    {
      onRequest: [fastify.authenticate],
      schema: {
        body: {
          type: "object",
          required: ["name"],
          properties: {
            name: { type: "string", minLength: 2, maxLength: 160 },
            slug: { type: "string", minLength: 2, maxLength: 80 },
            adminEmail: { type: "string", maxLength: 320 },
            adminPassword: { type: "string", minLength: 8, maxLength: 200 },
            adminName: { type: "string", maxLength: 120 },
            initialPrompt: { type: "string", maxLength: 5000 },
            publicRegistrationEnabled: { type: "boolean" },
          },
          additionalProperties: false,
        },
      },
    },
    async (req, reply) => {
      const name = String(req.body.name || "").trim();
      const slug = slugify(req.body.slug || name);
      if (!slug) return reply.code(400).send({ error: "Indirizzo app non valido." });

      const wantsInitialAdmin = Boolean(req.body.adminEmail || req.body.adminPassword);
      if (wantsInitialAdmin) {
        const adminEmail = normalizeEmail(req.body.adminEmail);
        const adminPassword = String(req.body.adminPassword || "");
        if (!adminEmail) return reply.code(400).send({ error: "Email admin non valida." });
        if (adminPassword.length < 8) return reply.code(400).send({ error: "Password admin troppo corta." });
      }

      try {
        const result = await db.transaction(async (tx) => {
          const tenantRows = await tx
            .insert(schema.mcTenants)
            .values({
              ownerUserId: req.user.sub,
              slug,
              name,
              publicRegistrationEnabled: req.body.publicRegistrationEnabled ?? true,
              metadata: {
                initialPrompt: String(req.body.initialPrompt || "").trim(),
              },
            })
            .returning();
          const tenant = tenantRows[0];

          let initialAdmin = null;
          if (wantsInitialAdmin) {
            const passwordHash = await hashPassword(String(req.body.adminPassword));
            const adminRows = await tx
              .insert(schema.mcAppUsers)
              .values({
                tenantId: tenant.id,
                email: normalizeEmail(req.body.adminEmail),
                passwordHash,
                name: req.body.adminName?.trim() || "Admin",
                role: "admin",
                mustChangePassword: true,
              })
              .returning();
            initialAdmin = {
              id: adminRows[0].id,
              email: adminRows[0].email,
              name: adminRows[0].name,
              role: adminRows[0].role,
              mustChangePassword: adminRows[0].mustChangePassword,
            };
          }

          return { tenant, initialAdmin };
        });

        return reply.code(201).send({
          tenant: publicTenant(result.tenant),
          initialAdmin: result.initialAdmin,
        });
      } catch (err) {
        if (duplicateError(err)) {
          return reply.code(409).send({ error: "Esiste gia' un'app con questo indirizzo o con questo admin." });
        }
        throw err;
      }
    }
  );
}
