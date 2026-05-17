// Auth per gli utenti finali delle app generate.
// Ogni richiesta e' scoped a un tenant: body/query/header X-Tenant-Slug.
import { and, eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { config } from "../config.js";
import { hashPassword, verifyPassword, generateToken, hashToken } from "../utils/hash.js";
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
  };
}

function publicAppUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    tenantId: u.tenantId,
    email: u.email,
    name: u.name ?? null,
    role: u.role,
    mustChangePassword: u.mustChangePassword,
    emailVerifiedAt: u.emailVerifiedAt ?? null,
    createdAt: u.createdAt,
  };
}

function tenantSlugFromRequest(req) {
  return slugify(
    req.headers["x-tenant-slug"] ||
    req.body?.tenantSlug ||
    req.query?.tenantSlug ||
    ""
  );
}

async function findTenant(req, reply) {
  const slug = tenantSlugFromRequest(req);
  if (!slug) {
    reply.code(400).send({ error: "Tenant mancante." });
    return null;
  }

  const rows = await db
    .select()
    .from(schema.mcTenants)
    .where(eq(schema.mcTenants.slug, slug))
    .limit(1);
  const tenant = rows[0];

  if (!tenant || tenant.status !== "active") {
    reply.code(404).send({ error: "App non disponibile." });
    return null;
  }

  return tenant;
}

async function findAppUser(tenantId, email) {
  const rows = await db
    .select()
    .from(schema.mcAppUsers)
    .where(and(
      eq(schema.mcAppUsers.tenantId, tenantId),
      eq(schema.mcAppUsers.email, email)
    ))
    .limit(1);
  return rows[0] ?? null;
}

async function issueRefreshToken(tenantId, appUserId, req) {
  const token = generateToken(32);
  const refreshTokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  await db.insert(schema.mcAppUserSessions).values({
    tenantId,
    appUserId,
    refreshTokenHash,
    userAgent: req.headers["user-agent"] ?? null,
    ip: req.ip ?? null,
    expiresAt,
  });

  return { token, expiresAt };
}

function issueAccessToken(fastify, tenant, user) {
  return fastify.jwt.sign(
    {
      sub: String(user.id),
      kind: "app_user",
      tenantId: String(tenant.id),
      tenantSlug: tenant.slug,
      email: user.email,
      role: user.role,
    },
    { expiresIn: config.jwt.accessTtl }
  );
}

function duplicateError(err) {
  return err?.code === "23505";
}

function requireAppUserClaim(req, reply) {
  if (req.user?.kind !== "app_user" || !req.user?.tenantId || !req.user?.sub) {
    reply.code(401).send({ error: "Token app non valido." });
    return false;
  }
  return true;
}

export default async function appAuthRoutes(fastify) {
  fastify.post(
    "/register",
    {
      schema: {
        body: {
          type: "object",
          required: ["tenantSlug", "email", "password"],
          properties: {
            tenantSlug: { type: "string", minLength: 2, maxLength: 80 },
            email: { type: "string", maxLength: 320 },
            password: { type: "string", minLength: 8, maxLength: 200 },
            name: { type: "string", maxLength: 120 },
          },
          additionalProperties: false,
        },
      },
    },
    async (req, reply) => {
      const tenant = await findTenant(req, reply);
      if (!tenant) return reply;
      if (!tenant.publicRegistrationEnabled) {
        return reply.code(403).send({ error: "Registrazione non abilitata per questa app." });
      }

      const email = normalizeEmail(req.body.email);
      if (!email) return reply.code(400).send({ error: "Email non valida." });

      const passwordHash = await hashPassword(req.body.password);
      let user;
      try {
        const rows = await db
          .insert(schema.mcAppUsers)
          .values({
            tenantId: tenant.id,
            email,
            passwordHash,
            name: req.body.name?.trim() || null,
            role: "user",
          })
          .returning();
        user = rows[0];
      } catch (err) {
        if (duplicateError(err)) {
          return reply.code(409).send({ error: "Email gia' registrata per questa app." });
        }
        throw err;
      }

      const access = issueAccessToken(fastify, tenant, user);
      const refresh = await issueRefreshToken(tenant.id, user.id, req);

      return reply.code(201).send({
        tenant: publicTenant(tenant),
        user: publicAppUser(user),
        accessToken: access,
        refreshToken: refresh.token,
        refreshTokenExpiresAt: refresh.expiresAt,
      });
    }
  );

  fastify.post(
    "/login",
    {
      schema: {
        body: {
          type: "object",
          required: ["tenantSlug", "email", "password"],
          properties: {
            tenantSlug: { type: "string", minLength: 2, maxLength: 80 },
            email: { type: "string", maxLength: 320 },
            password: { type: "string", minLength: 1, maxLength: 200 },
          },
          additionalProperties: false,
        },
      },
    },
    async (req, reply) => {
      const tenant = await findTenant(req, reply);
      if (!tenant) return reply;

      const email = normalizeEmail(req.body.email);
      if (!email) return reply.code(400).send({ error: "Email non valida." });

      const user = await findAppUser(tenant.id, email);
      let ok = false;
      if (user) {
        ok = await verifyPassword(user.passwordHash, req.body.password);
      } else {
        await hashPassword(req.body.password);
      }

      if (!user || !ok) {
        return reply.code(401).send({ error: "Credenziali non valide." });
      }

      const access = issueAccessToken(fastify, tenant, user);
      const refresh = await issueRefreshToken(tenant.id, user.id, req);

      return reply.send({
        tenant: publicTenant(tenant),
        user: publicAppUser(user),
        accessToken: access,
        refreshToken: refresh.token,
        refreshTokenExpiresAt: refresh.expiresAt,
      });
    }
  );

  fastify.post(
    "/refresh",
    {
      schema: {
        body: {
          type: "object",
          required: ["tenantSlug", "refreshToken"],
          properties: {
            tenantSlug: { type: "string", minLength: 2, maxLength: 80 },
            refreshToken: { type: "string", minLength: 20 },
          },
          additionalProperties: false,
        },
      },
    },
    async (req, reply) => {
      const tenant = await findTenant(req, reply);
      if (!tenant) return reply;

      const tokenHash = hashToken(req.body.refreshToken);
      const rows = await db
        .select()
        .from(schema.mcAppUserSessions)
        .where(and(
          eq(schema.mcAppUserSessions.tenantId, tenant.id),
          eq(schema.mcAppUserSessions.refreshTokenHash, tokenHash)
        ))
        .limit(1);
      const session = rows[0];

      if (!session || session.revokedAt || new Date(session.expiresAt) < new Date()) {
        return reply.code(401).send({ error: "Refresh token non valido o scaduto." });
      }

      await db
        .update(schema.mcAppUserSessions)
        .set({ revokedAt: new Date() })
        .where(eq(schema.mcAppUserSessions.id, session.id));

      const userRows = await db
        .select()
        .from(schema.mcAppUsers)
        .where(and(
          eq(schema.mcAppUsers.tenantId, tenant.id),
          eq(schema.mcAppUsers.id, session.appUserId)
        ))
        .limit(1);
      const user = userRows[0];
      if (!user) return reply.code(401).send({ error: "Utente app non trovato." });

      const access = issueAccessToken(fastify, tenant, user);
      const refresh = await issueRefreshToken(tenant.id, user.id, req);

      return reply.send({
        accessToken: access,
        refreshToken: refresh.token,
        refreshTokenExpiresAt: refresh.expiresAt,
      });
    }
  );

  fastify.post(
    "/logout",
    {
      schema: {
        body: {
          type: "object",
          properties: {
            refreshToken: { type: "string", minLength: 20 },
          },
          additionalProperties: false,
        },
      },
    },
    async (req, reply) => {
      if (req.body?.refreshToken) {
        await db
          .update(schema.mcAppUserSessions)
          .set({ revokedAt: new Date() })
          .where(eq(schema.mcAppUserSessions.refreshTokenHash, hashToken(req.body.refreshToken)));
      }
      return reply.code(204).send();
    }
  );

  fastify.get(
    "/me",
    { onRequest: [fastify.authenticate] },
    async (req, reply) => {
      if (!requireAppUserClaim(req, reply)) return reply;

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
      if (!row) return reply.code(404).send({ error: "Utente app non trovato." });

      return reply.send({
        tenant: publicTenant(row.tenant),
        user: publicAppUser(row.user),
      });
    }
  );

  fastify.post(
    "/change-password",
    {
      onRequest: [fastify.authenticate],
      schema: {
        body: {
          type: "object",
          required: ["currentPassword", "newPassword"],
          properties: {
            currentPassword: { type: "string", minLength: 1, maxLength: 200 },
            newPassword: { type: "string", minLength: 8, maxLength: 200 },
          },
          additionalProperties: false,
        },
      },
    },
    async (req, reply) => {
      if (!requireAppUserClaim(req, reply)) return reply;

      const rows = await db
        .select()
        .from(schema.mcAppUsers)
        .where(and(
          eq(schema.mcAppUsers.id, req.user.sub),
          eq(schema.mcAppUsers.tenantId, req.user.tenantId)
        ))
        .limit(1);
      const user = rows[0];
      if (!user) return reply.code(404).send({ error: "Utente app non trovato." });

      const ok = await verifyPassword(user.passwordHash, req.body.currentPassword);
      if (!ok) return reply.code(401).send({ error: "Password corrente non valida." });

      const passwordHash = await hashPassword(req.body.newPassword);
      const updatedRows = await db
        .update(schema.mcAppUsers)
        .set({ passwordHash, mustChangePassword: false, updatedAt: new Date() })
        .where(eq(schema.mcAppUsers.id, user.id))
        .returning();

      return reply.send({ user: publicAppUser(updatedRows[0]) });
    }
  );
}
