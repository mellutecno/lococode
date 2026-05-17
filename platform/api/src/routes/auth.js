// Auth routes per i creator MelluCode (chi crea app, paga abbonamento).
// Endpoint sotto /v1/auth/*.
//
// Per ora: register, login, /me, refresh, logout. Password reset arriva dopo
// quando colleghiamo SMTP. Audit log su ogni evento per security.
import { eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { hashPassword, verifyPassword, generateToken, hashToken } from "../utils/hash.js";
import { config } from "../config.js";
import { normalizeEmail } from "../utils/normalize.js";

// Helper: salva audit log senza far crashare la request se fallisce.
async function audit(req, event, userId, details = {}) {
  try {
    await db.insert(schema.mcAuditLog).values({
      userId: userId ?? null,
      event,
      ip: req.ip ?? null,
      userAgent: req.headers["user-agent"] ?? null,
      details,
    });
  } catch (err) {
    req.log.warn({ err, event }, "audit log write failed");
  }
}

// Helper: crea refresh session row e ritorna il token plain.
async function issueRefreshToken(userId, req) {
  const token = generateToken(32);
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30gg
  await db.insert(schema.mcSessions).values({
    userId,
    refreshTokenHash: tokenHash,
    userAgent: req.headers["user-agent"] ?? null,
    ip: req.ip ?? null,
    expiresAt,
  });
  return { token, expiresAt };
}

// Helper: emette access token JWT.
function issueAccessToken(fastify, user) {
  return fastify.jwt.sign(
    {
      sub: String(user.id),       // SEMPRE stringa (lesson v1)
      email: user.email,
      role: user.role,
    },
    { expiresIn: config.jwt.accessTtl }
  );
}

// Sanitize user prima di rispondere al client (mai esporre passwordHash).
function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    email: u.email,
    name: u.name ?? null,
    role: u.role,
    emailVerifiedAt: u.emailVerifiedAt ?? null,
    createdAt: u.createdAt,
  };
}

// ============================ ROUTES ============================
export default async function authRoutes(fastify) {
  // --- POST /v1/auth/register ---
  fastify.post(
    "/register",
    {
      schema: {
        body: {
          type: "object",
          required: ["email", "password"],
          properties: {
            email: { type: "string", maxLength: 320 },
            password: { type: "string", minLength: 8, maxLength: 200 },
            name: { type: "string", maxLength: 120 },
          },
          additionalProperties: false,
        },
      },
    },
    async (req, reply) => {
      const { email: rawEmail, password, name } = req.body;
      const email = normalizeEmail(rawEmail);
      if (!email) return reply.code(400).send({ error: "Email non valida." });

      // duplicate check (race-free: catch unique violation)
      const passwordHash = await hashPassword(password);
      let inserted;
      try {
        const rows = await db
          .insert(schema.mcUsers)
          .values({ email, passwordHash, name: name?.trim() || null })
          .returning();
        inserted = rows[0];
      } catch (err) {
        if (err.code === "23505") {
          await audit(req, "register.duplicate_email", null, { email });
          return reply.code(409).send({ error: "Email gia' registrata." });
        }
        throw err;
      }

      const access = issueAccessToken(fastify, inserted);
      const refresh = await issueRefreshToken(inserted.id, req);
      await audit(req, "register.success", inserted.id);

      return reply.code(201).send({
        user: publicUser(inserted),
        accessToken: access,
        refreshToken: refresh.token,
        refreshTokenExpiresAt: refresh.expiresAt,
      });
    }
  );

  // --- POST /v1/auth/login ---
  fastify.post(
    "/login",
    {
      schema: {
        body: {
          type: "object",
          required: ["email", "password"],
          properties: {
            email: { type: "string", maxLength: 320 },
            password: { type: "string", minLength: 1 },
          },
          additionalProperties: false,
        },
      },
    },
    async (req, reply) => {
      const email = normalizeEmail(req.body.email);
      const { password } = req.body;
      if (!email) return reply.code(400).send({ error: "Email non valida." });

      const rows = await db
        .select()
        .from(schema.mcUsers)
        .where(eq(schema.mcUsers.email, email))
        .limit(1);
      const user = rows[0];

      let ok = false;
      if (user) {
        ok = await verifyPassword(user.passwordHash, password);
      } else {
        // Brucia comunque lavoro CPU per ridurre il timing leak sulla presenza email.
        await hashPassword(password);
      }

      if (!user || !ok) {
        await audit(req, "login.failed", user?.id ?? null, { email });
        return reply.code(401).send({ error: "Credenziali non valide." });
      }

      const access = issueAccessToken(fastify, user);
      const refresh = await issueRefreshToken(user.id, req);
      await audit(req, "login.success", user.id);

      return reply.send({
        user: publicUser(user),
        accessToken: access,
        refreshToken: refresh.token,
        refreshTokenExpiresAt: refresh.expiresAt,
      });
    }
  );

  // --- POST /v1/auth/refresh ---
  fastify.post(
    "/refresh",
    {
      schema: {
        body: {
          type: "object",
          required: ["refreshToken"],
          properties: { refreshToken: { type: "string" } },
          additionalProperties: false,
        },
      },
    },
    async (req, reply) => {
      const tokenHash = hashToken(req.body.refreshToken);
      const rows = await db
        .select()
        .from(schema.mcSessions)
        .where(eq(schema.mcSessions.refreshTokenHash, tokenHash))
        .limit(1);
      const session = rows[0];

      if (!session || session.revokedAt || new Date(session.expiresAt) < new Date()) {
        await audit(req, "refresh.invalid", session?.userId ?? null);
        return reply.code(401).send({ error: "Refresh token non valido o scaduto." });
      }

      // Ruoto il refresh token (security best practice).
      await db
        .update(schema.mcSessions)
        .set({ revokedAt: new Date() })
        .where(eq(schema.mcSessions.id, session.id));

      const userRows = await db
        .select()
        .from(schema.mcUsers)
        .where(eq(schema.mcUsers.id, session.userId))
        .limit(1);
      const user = userRows[0];
      if (!user) return reply.code(401).send({ error: "Utente non trovato." });

      const access = issueAccessToken(fastify, user);
      const refresh = await issueRefreshToken(user.id, req);
      await audit(req, "refresh.success", user.id);

      return reply.send({
        accessToken: access,
        refreshToken: refresh.token,
        refreshTokenExpiresAt: refresh.expiresAt,
      });
    }
  );

  // --- POST /v1/auth/logout ---
  fastify.post(
    "/logout",
    {
      schema: {
        body: {
          type: "object",
          properties: { refreshToken: { type: "string" } },
          additionalProperties: false,
        },
      },
    },
    async (req, reply) => {
      if (req.body?.refreshToken) {
        const tokenHash = hashToken(req.body.refreshToken);
        await db
          .update(schema.mcSessions)
          .set({ revokedAt: new Date() })
          .where(eq(schema.mcSessions.refreshTokenHash, tokenHash));
      }
      await audit(req, "logout", null);
      return reply.code(204).send();
    }
  );

  // --- GET /v1/auth/me --- (richiede access token)
  fastify.get(
    "/me",
    { onRequest: [fastify.authenticate] },
    async (req, reply) => {
      const userId = req.user.sub;
      const rows = await db
        .select()
        .from(schema.mcUsers)
        .where(eq(schema.mcUsers.id, userId))
        .limit(1);
      const user = rows[0];
      if (!user) return reply.code(404).send({ error: "Utente non trovato." });
      return reply.send({ user: publicUser(user) });
    }
  );
}
