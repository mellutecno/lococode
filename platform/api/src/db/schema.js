// Schema Fase 1: creator MelluCode, tenant/app generate e auth utenti app.
import {
  pgTable, uuid, text, timestamp, varchar, jsonb, index, uniqueIndex, boolean, bigint,
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

// Ogni app generata e' un tenant. Il backend gestito filtra sempre per tenant_id.
export const mcTenants = pgTable("mc_tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerUserId: uuid("owner_user_id").notNull().references(() => mcUsers.id, { onDelete: "cascade" }),
  slug: varchar("slug", { length: 80 }).notNull(),
  name: varchar("name", { length: 160 }).notNull(),
  status: varchar("status", { length: 32 }).notNull().default("active"), // active | suspended | archived
  plan: varchar("plan", { length: 32 }).notNull().default("trial"), // trial | hosted | exported
  publicRegistrationEnabled: boolean("public_registration_enabled").notNull().default(true),
  metadata: jsonb("metadata").default({}).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  slugUx: uniqueIndex("mc_tenants_slug_ux").on(t.slug),
  ownerIdx: index("mc_tenants_owner_idx").on(t.ownerUserId),
}));

// Utenti finali delle app generate. Sono separati dai creator MelluCode.
export const mcAppUsers = pgTable("mc_app_users", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => mcTenants.id, { onDelete: "cascade" }),
  email: varchar("email", { length: 320 }).notNull(),
  passwordHash: text("password_hash").notNull(),
  name: varchar("name", { length: 120 }),
  role: varchar("role", { length: 32 }).notNull().default("user"), // admin | user | custom role
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  metadata: jsonb("metadata").default({}).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  tenantEmailUx: uniqueIndex("mc_app_users_tenant_email_ux").on(t.tenantId, t.email),
  tenantRoleIdx: index("mc_app_users_tenant_role_idx").on(t.tenantId, t.role),
}));

// Refresh tokens degli utenti finali delle app generate.
export const mcAppUserSessions = pgTable("mc_app_user_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => mcTenants.id, { onDelete: "cascade" }),
  appUserId: uuid("app_user_id").notNull().references(() => mcAppUsers.id, { onDelete: "cascade" }),
  refreshTokenHash: text("refresh_token_hash").notNull(),
  userAgent: text("user_agent"),
  ip: varchar("ip", { length: 64 }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  tenantUserIdx: index("mc_app_sessions_tenant_user_idx").on(t.tenantId, t.appUserId),
  tokenHashUx: uniqueIndex("mc_app_sessions_token_hash_ux").on(t.refreshTokenHash),
}));

// Entita' dati delle app generate. L'orchestrator crea/aggiorna queste definizioni,
// il frontend poi usa /v1/data/{entity} senza avere backend dedicato.
export const mcAppEntities = pgTable("mc_app_entities", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => mcTenants.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 80 }).notNull(),
  label: varchar("label", { length: 160 }),
  jsonSchema: jsonb("json_schema").default({}).notNull(),
  permissions: jsonb("permissions").default({}).notNull(),
  metadata: jsonb("metadata").default({}).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  tenantNameUx: uniqueIndex("mc_app_entities_tenant_name_ux").on(t.tenantId, t.name),
  tenantIdx: index("mc_app_entities_tenant_idx").on(t.tenantId),
}));

// File caricati dalle app generate. Metadata sul DB, binario su disco a
// `${STORAGE_DIR}/{tenant_id}/{file_id}`. Storage_path e' il path RELATIVO
// a STORAGE_DIR (forward slash anche su Windows).
export const mcAppFiles = pgTable("mc_app_files", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => mcTenants.id, { onDelete: "cascade" }),
  ownerAppUserId: uuid("owner_app_user_id").references(() => mcAppUsers.id, { onDelete: "set null" }),
  originalFilename: varchar("original_filename", { length: 255 }).notNull(),
  mimeType: varchar("mime_type", { length: 160 }).notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  storagePath: text("storage_path").notNull(),
  metadata: jsonb("metadata").default({}).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  tenantIdx: index("mc_app_files_tenant_idx").on(t.tenantId),
  ownerIdx: index("mc_app_files_owner_idx").on(t.ownerAppUserId),
  tenantCreatedIdx: index("mc_app_files_tenant_created_idx").on(t.tenantId, t.createdAt),
}));

// Record generici delle app generate. Ogni record e' JSONB, sempre scoped a tenant.
export const mcAppRecords = pgTable("mc_app_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => mcTenants.id, { onDelete: "cascade" }),
  entityId: uuid("entity_id").notNull().references(() => mcAppEntities.id, { onDelete: "cascade" }),
  entity: varchar("entity", { length: 80 }).notNull(),
  data: jsonb("data").default({}).notNull(),
  createdByAppUserId: uuid("created_by_app_user_id").references(() => mcAppUsers.id, { onDelete: "set null" }),
  updatedByAppUserId: uuid("updated_by_app_user_id").references(() => mcAppUsers.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  tenantEntityIdx: index("mc_app_records_tenant_entity_idx").on(t.tenantId, t.entity),
  entityIdIdx: index("mc_app_records_entity_id_idx").on(t.entityId),
  tenantCreatedIdx: index("mc_app_records_tenant_created_idx").on(t.tenantId, t.createdAt),
}));
