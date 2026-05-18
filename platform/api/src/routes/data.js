// Data API gestita per le app generate.
// Il frontend generato usa queste route invece di avere backend custom.
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { normalizeEntityName } from "../utils/normalize.js";
import { publicEntity } from "../utils/entities.js";
import { DEFAULT_PERMISSIONS, canAccess } from "../utils/permissions.js";
import { validateRecordData } from "../utils/recordValidation.js";

function publicRecord(record) {
  return {
    id: record.id,
    tenantId: record.tenantId,
    entity: record.entity,
    data: record.data,
    createdByAppUserId: record.createdByAppUserId,
    updatedByAppUserId: record.updatedByAppUserId,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

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
    .select({
      user: schema.mcAppUsers,
      tenant: schema.mcTenants,
    })
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

async function findEntity(tenantId, rawName) {
  const name = normalizeEntityName(rawName);
  if (!name) return null;

  const rows = await db
    .select()
    .from(schema.mcAppEntities)
    .where(and(
      eq(schema.mcAppEntities.tenantId, tenantId),
      eq(schema.mcAppEntities.name, name)
    ))
    .limit(1);

  return rows[0] ?? null;
}

function parseLimit(value) {
  const n = Number(value ?? 50);
  if (!Number.isFinite(n)) return 50;
  return Math.max(1, Math.min(100, Math.trunc(n)));
}

function parseOffset(value) {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.trunc(n));
}

export default async function dataRoutes(fastify) {
  fastify.get(
    "/entities",
    { onRequest: [fastify.authenticate] },
    async (req, reply) => {
      const ctx = await currentAppUser(req, reply);
      if (!ctx) return reply;

      const rows = await db
        .select()
        .from(schema.mcAppEntities)
        .where(eq(schema.mcAppEntities.tenantId, ctx.tenant.id))
        .orderBy(schema.mcAppEntities.name);

      return { entities: rows.map(publicEntity) };
    }
  );

  fastify.post(
    "/entities",
    {
      onRequest: [fastify.authenticate],
      schema: {
        body: {
          type: "object",
          required: ["name"],
          properties: {
            name: { type: "string", minLength: 1, maxLength: 80 },
            label: { type: "string", maxLength: 160 },
            schema: { type: "object", additionalProperties: true },
            permissions: { type: "object", additionalProperties: true },
            metadata: { type: "object", additionalProperties: true },
          },
          additionalProperties: false,
        },
      },
    },
    async (req, reply) => {
      const ctx = await currentAppUser(req, reply);
      if (!ctx) return reply;
      if (ctx.user.role !== "admin") return reply.code(403).send({ error: "Solo admin app." });

      const name = normalizeEntityName(req.body.name);
      if (!name) return reply.code(400).send({ error: "Nome entita' non valido." });

      const values = {
        tenantId: ctx.tenant.id,
        name,
        label: req.body.label?.trim() || name,
        jsonSchema: req.body.schema || {},
        permissions: { ...DEFAULT_PERMISSIONS, ...(req.body.permissions || {}) },
        metadata: req.body.metadata || {},
        updatedAt: new Date(),
      };

      const existing = await findEntity(ctx.tenant.id, name);
      if (existing) {
        const rows = await db
          .update(schema.mcAppEntities)
          .set(values)
          .where(eq(schema.mcAppEntities.id, existing.id))
          .returning();
        return { entity: publicEntity(rows[0]), created: false };
      }

      const rows = await db
        .insert(schema.mcAppEntities)
        .values(values)
        .returning();

      return reply.code(201).send({ entity: publicEntity(rows[0]), created: true });
    }
  );

  fastify.get(
    "/:entity",
    {
      onRequest: [fastify.authenticate],
      schema: {
        params: {
          type: "object",
          required: ["entity"],
          properties: { entity: { type: "string", minLength: 1, maxLength: 80 } },
        },
        querystring: {
          type: "object",
          properties: {
            limit: { type: "string" },
            offset: { type: "string" },
          },
          additionalProperties: false,
        },
      },
    },
    async (req, reply) => {
      const ctx = await currentAppUser(req, reply);
      if (!ctx) return reply;

      const entity = await findEntity(ctx.tenant.id, req.params.entity);
      if (!entity) return reply.code(404).send({ error: "Entita' non trovata." });
      if (!canAccess(entity, "read", ctx.user)) return reply.code(403).send({ error: "Accesso non consentito." });

      const rows = await db
        .select()
        .from(schema.mcAppRecords)
        .where(and(
          eq(schema.mcAppRecords.tenantId, ctx.tenant.id),
          eq(schema.mcAppRecords.entity, entity.name)
        ))
        .orderBy(desc(schema.mcAppRecords.createdAt))
        .limit(parseLimit(req.query.limit))
        .offset(parseOffset(req.query.offset));

      return {
        entity: publicEntity(entity),
        records: rows.map(publicRecord),
      };
    }
  );

  fastify.post(
    "/:entity",
    {
      onRequest: [fastify.authenticate],
      schema: {
        params: {
          type: "object",
          required: ["entity"],
          properties: { entity: { type: "string", minLength: 1, maxLength: 80 } },
        },
        body: { type: "object", additionalProperties: true },
      },
    },
    async (req, reply) => {
      const ctx = await currentAppUser(req, reply);
      if (!ctx) return reply;

      const entity = await findEntity(ctx.tenant.id, req.params.entity);
      if (!entity) return reply.code(404).send({ error: "Entita' non trovata." });
      if (!canAccess(entity, "create", ctx.user)) return reply.code(403).send({ error: "Creazione non consentita." });

      const validationError = validateRecordData(entity, req.body);
      if (validationError) return reply.code(400).send({ error: validationError });

      const rows = await db
        .insert(schema.mcAppRecords)
        .values({
          tenantId: ctx.tenant.id,
          entityId: entity.id,
          entity: entity.name,
          data: req.body,
          createdByAppUserId: ctx.user.id,
          updatedByAppUserId: ctx.user.id,
        })
        .returning();

      return reply.code(201).send({ record: publicRecord(rows[0]) });
    }
  );

  fastify.get(
    "/:entity/:id",
    {
      onRequest: [fastify.authenticate],
      schema: {
        params: {
          type: "object",
          required: ["entity", "id"],
          properties: {
            entity: { type: "string", minLength: 1, maxLength: 80 },
            id: { type: "string", minLength: 36, maxLength: 36 },
          },
        },
      },
    },
    async (req, reply) => {
      const ctx = await currentAppUser(req, reply);
      if (!ctx) return reply;

      const entity = await findEntity(ctx.tenant.id, req.params.entity);
      if (!entity) return reply.code(404).send({ error: "Entita' non trovata." });
      if (!canAccess(entity, "read", ctx.user)) return reply.code(403).send({ error: "Accesso non consentito." });

      const rows = await db
        .select()
        .from(schema.mcAppRecords)
        .where(and(
          eq(schema.mcAppRecords.tenantId, ctx.tenant.id),
          eq(schema.mcAppRecords.entity, entity.name),
          eq(schema.mcAppRecords.id, req.params.id)
        ))
        .limit(1);

      const record = rows[0];
      if (!record) return reply.code(404).send({ error: "Record non trovato." });
      return { record: publicRecord(record) };
    }
  );

  fastify.patch(
    "/:entity/:id",
    {
      onRequest: [fastify.authenticate],
      schema: {
        params: {
          type: "object",
          required: ["entity", "id"],
          properties: {
            entity: { type: "string", minLength: 1, maxLength: 80 },
            id: { type: "string", minLength: 36, maxLength: 36 },
          },
        },
        body: { type: "object", additionalProperties: true },
      },
    },
    async (req, reply) => {
      const ctx = await currentAppUser(req, reply);
      if (!ctx) return reply;

      const entity = await findEntity(ctx.tenant.id, req.params.entity);
      if (!entity) return reply.code(404).send({ error: "Entita' non trovata." });

      const existingRows = await db
        .select()
        .from(schema.mcAppRecords)
        .where(and(
          eq(schema.mcAppRecords.tenantId, ctx.tenant.id),
          eq(schema.mcAppRecords.entity, entity.name),
          eq(schema.mcAppRecords.id, req.params.id)
        ))
        .limit(1);
      const existing = existingRows[0];
      if (!existing) return reply.code(404).send({ error: "Record non trovato." });
      if (!canAccess(entity, "update", ctx.user, existing)) return reply.code(403).send({ error: "Modifica non consentita." });

      const nextData = { ...(existing.data || {}), ...req.body };
      const validationError = validateRecordData(entity, nextData);
      if (validationError) return reply.code(400).send({ error: validationError });

      const rows = await db
        .update(schema.mcAppRecords)
        .set({
          data: nextData,
          updatedByAppUserId: ctx.user.id,
          updatedAt: new Date(),
        })
        .where(eq(schema.mcAppRecords.id, existing.id))
        .returning();

      return { record: publicRecord(rows[0]) };
    }
  );

  fastify.delete(
    "/:entity/:id",
    {
      onRequest: [fastify.authenticate],
      schema: {
        params: {
          type: "object",
          required: ["entity", "id"],
          properties: {
            entity: { type: "string", minLength: 1, maxLength: 80 },
            id: { type: "string", minLength: 36, maxLength: 36 },
          },
        },
      },
    },
    async (req, reply) => {
      const ctx = await currentAppUser(req, reply);
      if (!ctx) return reply;

      const entity = await findEntity(ctx.tenant.id, req.params.entity);
      if (!entity) return reply.code(404).send({ error: "Entita' non trovata." });

      const rows = await db
        .select()
        .from(schema.mcAppRecords)
        .where(and(
          eq(schema.mcAppRecords.tenantId, ctx.tenant.id),
          eq(schema.mcAppRecords.entity, entity.name),
          eq(schema.mcAppRecords.id, req.params.id)
        ))
        .limit(1);
      const record = rows[0];
      if (!record) return reply.code(404).send({ error: "Record non trovato." });
      if (!canAccess(entity, "delete", ctx.user, record)) return reply.code(403).send({ error: "Eliminazione non consentita." });

      await db
        .delete(schema.mcAppRecords)
        .where(eq(schema.mcAppRecords.id, record.id));

      return reply.code(204).send();
    }
  );
}
