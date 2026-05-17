// Files API gestita per le app generate.
// Stessa logica di auth/scoping di /v1/data: JWT app-auth, tenant_id sempre
// validato. I file binari stanno su disco a `${STORAGE_DIR}/{tenant}/{id}`;
// il DB tiene solo i metadata.
import { and, desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db, schema } from "../db/index.js";
import { canAccess } from "../utils/permissions.js";
import {
  buildStoragePath, writeUploadStream, openReadStream,
  deleteFile, statFile,
} from "../utils/fileStorage.js";
import { config } from "../config.js";

// "Pseudo-entita'" per riusare canAccess senza una row mc_app_entities.
// Tutti i file dello stesso tenant hanno gli stessi permessi: read aperto,
// delete owner_or_admin. Per ora niente override per-record.
const FILES_PSEUDO_ENTITY = Object.freeze({
  permissions: {
    read: "authenticated",
    create: "authenticated",
    update: "none",
    delete: "owner_or_admin",
  },
});

function publicFile(f) {
  return {
    id: f.id,
    tenantId: f.tenantId,
    ownerAppUserId: f.ownerAppUserId,
    originalFilename: f.originalFilename,
    mimeType: f.mimeType,
    sizeBytes: f.sizeBytes,
    metadata: f.metadata || {},
    createdAt: f.createdAt,
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

// Content-Disposition con nome originale: RFC 5987 per Unicode.
// inline = il browser mostra (immagini, pdf); attachment forzerebbe download.
function contentDispositionInline(filename) {
  const safeAscii = (filename || "file").replace(/[\\"\r\n]/g, "_");
  const utf8 = encodeURIComponent(filename || "file");
  return `inline; filename="${safeAscii}"; filename*=UTF-8''${utf8}`;
}

async function findFile(tenantId, id) {
  const rows = await db
    .select()
    .from(schema.mcAppFiles)
    .where(and(
      eq(schema.mcAppFiles.tenantId, tenantId),
      eq(schema.mcAppFiles.id, id)
    ))
    .limit(1);
  return rows[0] ?? null;
}

export default async function filesRoutes(fastify) {
  // --- POST /v1/files/upload (multipart) ---
  // Una sola request, un solo file. Il limite di size e' applicato dal plugin
  // multipart globale (config.storage.maxUploadBytes).
  // onRequest gira PRIMA del body parser, quindi e' sicuro per multipart.
  fastify.post("/upload", { onRequest: [fastify.authenticate] }, async (req, reply) => {
    const ctx = await currentAppUser(req, reply);
    if (!ctx) return reply;

    if (!req.isMultipart()) {
      return reply.code(400).send({ error: "Richiesta non multipart." });
    }

    const part = await req.file();
    if (!part) return reply.code(400).send({ error: "File mancante." });

    const fileId = randomUUID();
    const storagePath = buildStoragePath(ctx.tenant.id, fileId);

    let sizeBytes;
    try {
      sizeBytes = await writeUploadStream(storagePath, part.file);
    } catch (err) {
      req.log.warn({ err }, "upload write failed");
      return reply.code(500).send({ error: "Salvataggio file fallito." });
    }

    // @fastify/multipart segnala il superamento limite cosi':
    if (part.file.truncated) {
      // Pulizia best-effort del partial.
      await deleteFile(storagePath).catch(() => {});
      return reply.code(413).send({
        error: `File troppo grande (max ${config.storage.maxUploadBytes} byte).`,
      });
    }

    // Metadata opzionale come campo form `metadata` (JSON string).
    let metadata = {};
    if (part.fields?.metadata?.value) {
      try {
        metadata = JSON.parse(part.fields.metadata.value);
        if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
          metadata = {};
        }
      } catch {
        // ignora metadata malformati piuttosto che rompere l'upload
        metadata = {};
      }
    }

    const rows = await db
      .insert(schema.mcAppFiles)
      .values({
        id: fileId,
        tenantId: ctx.tenant.id,
        ownerAppUserId: ctx.user.id,
        originalFilename: (part.filename || "file").slice(0, 255),
        mimeType: (part.mimetype || "application/octet-stream").slice(0, 160),
        sizeBytes,
        storagePath,
        metadata,
      })
      .returning();

    return reply.code(201).send({ file: publicFile(rows[0]) });
  });

  // --- GET /v1/files --- (lista paginata file del tenant)
  fastify.get(
    "/",
    {
      onRequest: [fastify.authenticate],
      schema: {
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

      const rows = await db
        .select()
        .from(schema.mcAppFiles)
        .where(eq(schema.mcAppFiles.tenantId, ctx.tenant.id))
        .orderBy(desc(schema.mcAppFiles.createdAt))
        .limit(parseLimit(req.query.limit))
        .offset(parseOffset(req.query.offset));

      return { files: rows.map(publicFile) };
    }
  );

  // --- GET /v1/files/:id --- (metadata JSON)
  fastify.get(
    "/:id",
    {
      onRequest: [fastify.authenticate],
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", minLength: 36, maxLength: 36 } },
        },
      },
    },
    async (req, reply) => {
      const ctx = await currentAppUser(req, reply);
      if (!ctx) return reply;

      const f = await findFile(ctx.tenant.id, req.params.id);
      if (!f) return reply.code(404).send({ error: "File non trovato." });
      if (!canAccess(FILES_PSEUDO_ENTITY, "read", ctx.user, { createdByAppUserId: f.ownerAppUserId })) {
        return reply.code(403).send({ error: "Accesso non consentito." });
      }
      return { file: publicFile(f) };
    }
  );

  // --- GET /v1/files/:id/content --- (binary stream)
  fastify.get(
    "/:id/content",
    {
      onRequest: [fastify.authenticate],
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", minLength: 36, maxLength: 36 } },
        },
      },
    },
    async (req, reply) => {
      const ctx = await currentAppUser(req, reply);
      if (!ctx) return reply;

      const f = await findFile(ctx.tenant.id, req.params.id);
      if (!f) return reply.code(404).send({ error: "File non trovato." });
      if (!canAccess(FILES_PSEUDO_ENTITY, "read", ctx.user, { createdByAppUserId: f.ownerAppUserId })) {
        return reply.code(403).send({ error: "Accesso non consentito." });
      }

      const stat = await statFile(f.storagePath);
      if (!stat.exists) {
        req.log.warn({ fileId: f.id, path: f.storagePath }, "file row exists but binary missing");
        return reply.code(410).send({ error: "Contenuto del file non disponibile." });
      }

      reply
        .header("Content-Type", f.mimeType)
        .header("Content-Length", stat.size)
        .header("Content-Disposition", contentDispositionInline(f.originalFilename))
        .header("Cache-Control", "private, max-age=0, must-revalidate");

      return reply.send(openReadStream(f.storagePath));
    }
  );

  // --- DELETE /v1/files/:id ---
  fastify.delete(
    "/:id",
    {
      onRequest: [fastify.authenticate],
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", minLength: 36, maxLength: 36 } },
        },
      },
    },
    async (req, reply) => {
      const ctx = await currentAppUser(req, reply);
      if (!ctx) return reply;

      const f = await findFile(ctx.tenant.id, req.params.id);
      if (!f) return reply.code(404).send({ error: "File non trovato." });
      if (!canAccess(FILES_PSEUDO_ENTITY, "delete", ctx.user, { createdByAppUserId: f.ownerAppUserId })) {
        return reply.code(403).send({ error: "Eliminazione non consentita." });
      }

      // Prima il DB (sorgente di verita'), poi il disco best-effort.
      await db.delete(schema.mcAppFiles).where(eq(schema.mcAppFiles.id, f.id));
      const del = await deleteFile(f.storagePath);
      if (!del.ok) {
        req.log.warn({ err: del.error, fileId: f.id }, "disk unlink failed after DB delete");
      }
      return reply.code(204).send();
    }
  );
}
