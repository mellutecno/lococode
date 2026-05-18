import { eq } from "drizzle-orm";
import { config } from "../config.js";
import { db, schema } from "../db/index.js";
import { normalizeEmail } from "./normalize.js";

export function isPlatformAdminEmail(rawEmail) {
  const email = normalizeEmail(rawEmail);
  return Boolean(email && config.admin.emails.includes(email));
}

export function creatorRoleForEmail(rawEmail) {
  return isPlatformAdminEmail(rawEmail) ? "admin" : "user";
}

export async function ensurePlatformAdminRole(user) {
  if (!user || user.role === "admin" || !isPlatformAdminEmail(user.email)) {
    return user;
  }

  const rows = await db
    .update(schema.mcUsers)
    .set({ role: "admin", updatedAt: new Date() })
    .where(eq(schema.mcUsers.id, user.id))
    .returning();

  return rows[0] ?? { ...user, role: "admin" };
}

export async function requirePlatformAdmin(req, reply) {
  const userId = req.user?.sub;
  if (!userId) {
    reply.code(401).send({ error: "Non autenticato." });
    return null;
  }

  const rows = await db
    .select()
    .from(schema.mcUsers)
    .where(eq(schema.mcUsers.id, userId))
    .limit(1);

  const user = await ensurePlatformAdminRole(rows[0]);
  if (!user) {
    reply.code(404).send({ error: "Utente non trovato." });
    return null;
  }

  if (user.role !== "admin") {
    reply.code(403).send({ error: "Accesso riservato all'amministratore MelluCode." });
    return null;
  }

  req.platformAdminUser = user;
  return user;
}
