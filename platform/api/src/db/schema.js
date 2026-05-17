// Schema iniziale Fase 1: solo tabelle per auth dei creator MelluCode.
// Le tabelle multi-tenant per app generate (mc_app_users, mc_app_records, etc.)
// arrivano dopo, quando facciamo /v1/data e /v1/app-auth.
import {
  pgTable, uuid, text, timestamp, varchar, jsonb, index, uniqueIndex,
} from "drizzle-orm/pg-core";

// Utenti di MelluCode: chi accede al pannello, crea app, paga abbonamento.
// NON sono gli utenti delle app generate (quelli stanno in mc_app_users).
export const mcUsers = pgTable("mc_users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: varchar("email", { length: 320 }).notNull(),
  passwordHash: text("password_hash").notNull(),
  name: varchar("name", { length: 120 }),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  role: varchar("role", { length: 32 }).notNull().default("user"), // user | admin
  metadata: jsonb("metadata").default({}).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  emailUx: uniqueIndex("mc_users_email_ux").on(t.email),
}));

// Refresh tokens dei creator. Hash sha256 del token (mai plaintext sul DB).
// Il client tiene il token in cookie httpOnly o localStorage.
export const mcSessions = pgTable("mc_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => mcUsers.id, { onDelete: "cascade" }),
  refreshTokenHash: text("refresh_token_hash").notNull(),
  userAgent: text("user_agent"),
  ip: varchar("ip", { length: 64 }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  userIdIdx: index("mc_sessions_user_id_idx").on(t.userId),
  tokenHashUx: uniqueIndex("mc_sessions_token_hash_ux").on(t.refreshTokenHash),
}));

// Log eventi auth: register, login, logout, refresh, password reset, failed login.
// Utile per sicurezza (rate limiting, alert su brute force) e debug.
export const mcAuditLog = pgTable("mc_audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => mcUsers.id, { onDelete: "set null" }),
  event: varchar("event", { length: 64 }).notNull(),
  ip: varchar("ip", { length: 64 }),
  userAgent: text("user_agent"),
  details: jsonb("details").default({}).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  userEventIdx: index("mc_audit_user_event_idx").on(t.userId, t.event),
  createdAtIdx: index("mc_audit_created_idx").on(t.createdAt),
}));
