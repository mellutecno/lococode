// Data API gestita per le app generate.
// Il frontend generato usa queste route invece di avere backend custom.
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { normalizeKey } from "../utils/normalize.js";

const DEFAULT_PERMISSIONS = {
  read: "authenticated",
  create: "authenticated",
  update: "owner_or_admin",
  delete: "owner_or_admin",
};

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function publicEntity(entity) {
  return {
    id: entity.id,
    tenantId: entity.tenantId,
    name: entity.name,
    label: entity.label ?? entity.name,
    schema: entity.jsonSchema,
    permissions: { ...DEFAULT_PERMISSIONS, ...(entity.permissions || {}) },
    metadata: entity.metadata || {},
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}

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

function normalizeEntityName(value) {
  const name = normalizeKey(value);
  return name && /^[a-z][a-z0-9_]{0,79}$/.test(name) ? name : "";
}

function requireAppUser(req, reply) {
  if (req.user?.kind !== "app_user" || !req.user?.tenantId || !req.user?.sub) {
    reply.code(401).send({ error: "Token app non valido." });
    return false;
  }
  return true;
}

function permissionFor(entity, action) {
  return {
    ...DEFAULT_PERMISSIONS,
    ...(entity.permissions || {}),
  }[action] || DEFAULT_PERMISSIONS[action];
}

function canAccess(entity, action, user, record = null) {
  const mode = permissionFor(entity, action);
  if (mode === "none") return false;
  if (mode === "authenticated") return true;
  if (mode === "admin") return user.role === "admin";
  if (mode === "owner_or_admin") {
    return user.role === "admin" || record?.createdByAppUserId === user.id;
  }
  return false;
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

function validateRecordData(entity, data) {
  if (!isPlainObject(data)) return "Il record deve essere un oggetto JSON.";

  const jsonSchema = isPlainObject(entity.jsonSchema) ? entity.jsonSchema : {};
  const properties = isPlainObject(jsonSchema.properties) ? jsonSchema.properties : {};
  const required = Array.isArray(jsonSchema.required) ? jsonSchema.required : [];

  for (const field of required) {
    if (data[field] === undefined || data[field] === null || data[field] === "") {
      return `Campo obbligatorio mancante: ${field}.`;
    }
  }

  if (jsonSchema.additionalProperties === false) {
    for (const field of Object.keys(data)) {
      if (!properties[field]) return `Campo non previsto: ${field}.`;
    }
  }

  for (const [field, rules] of Object.entries(properties)) {
    if (data[field] === undefined || data[field] === null) continue;
    if (!isPlainObject(rules)) continue;

    const value = data[field];
    if (rules.type === "string" && typeof value !== "string") return `${field} deve essere testo.`;
    if (rules.type === "number" && typeof value !== "number") return `${field} deve essere numerico.`;
    if (rules.type === "integer" && !Number.isInteger(value)) return `${field} deve essere intero.`;
    if (rules.type === "boolean" && typeof value !== "boolean") return `${field} deve essere vero/falso.`;
    if (rules.type === "object" && !isPlainObject(value)) return `${field} deve essere un oggetto.`;
    if (rules.type === "array" && !Array.isArray(value)) return `${field} deve essere una lista.`;
    if (rules.type === "string" && rules.maxLength && value.length > rules.maxLength) {
      return `${field} supera la lunghezza massima.`;
    }
  }

  return null;
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
