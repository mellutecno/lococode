// Integration test della API gestita: gira solo se TEST_DATABASE_URL e' settata.
// Usa fastify.inject (niente listen reale) e pulisce le tabelle prima di ogni test
// per garantire isolamento.
//
// Come si lancia (PowerShell):
//   $env:TEST_DATABASE_URL = "postgres://mellucode:PASS@127.0.0.1:5432/mellucode_test"
//   npm test
//
// Crea il DB di test prima:
//   createdb mellucode_test
import { describe, test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const TEST_DB = process.env.TEST_DATABASE_URL;

if (!TEST_DB) {
  test("integration suite skipped (set TEST_DATABASE_URL to enable)", { skip: true }, () => {});
} else {
  // ATTENZIONE: setare env PRIMA di importare config/db, altrimenti config.js
  // legge le var al module-load e fallisce.
  process.env.DATABASE_URL = TEST_DB;
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-secret-must-be-at-least-32-characters-long";
  process.env.NODE_ENV = "test";
  // Storage isolato per i test files: tmpdir effimera, pulita dopo la suite.
  const STORAGE_ROOT = path.join(tmpdir(), `mc-files-it-${process.pid}-${Date.now()}`);
  process.env.STORAGE_DIR = STORAGE_ROOT;
  // Limite basso per testare il 413 senza dover allocare 10 MB.
  process.env.UPLOAD_MAX_BYTES = "2048";
  // Email test-safe: Nodemailer produce JSON, non apre connessioni SMTP reali.
  process.env.SMTP_TRANSPORT = "json";
  process.env.SMTP_FROM = "noreply@test.mellucode.local";
  // AI test-safe: niente chiamate reali a OpenRouter, ma quota/log reali su DB.
  process.env.OPENROUTER_TRANSPORT = "mock";
  process.env.OPENROUTER_DEFAULT_MODEL = "test/model";
  process.env.OPENROUTER_ALLOWED_MODELS = "test/model";
  process.env.AI_DEFAULT_MONTHLY_CREDITS = "1";
  process.env.AI_RESERVE_PER_REQUEST_CREDITS = "0.00001";
  process.env.OPENROUTER_MOCK_COST = "0.00002";

  const { buildApp } = await import("../app.js");
  const { db, schema } = await import("../db/index.js");
  const { runMigrations } = await import("../db/migrate.js");
  const { eq, sql } = await import("drizzle-orm");

  let app;

  before(async () => {
    await runMigrations();
    await fs.mkdir(STORAGE_ROOT, { recursive: true });
    app = await buildApp({ logger: false });
    await app.ready();
  });

  after(async () => {
    if (app) await app.close();
    await fs.rm(STORAGE_ROOT, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await db.execute(sql`
      TRUNCATE TABLE
        mc_audit_log,
        mc_ai_usage,
        mc_ai_quotas,
        mc_email_log,
        mc_app_files,
        mc_app_records,
        mc_app_entities,
        mc_app_user_sessions,
        mc_app_users,
        mc_tenants,
        mc_sessions,
        mc_users
      RESTART IDENTITY CASCADE
    `);
    // Pulizia file su disco: cancello solo il contenuto, mantengo la dir.
    try {
      const entries = await fs.readdir(STORAGE_ROOT);
      await Promise.all(entries.map((e) => fs.rm(path.join(STORAGE_ROOT, e), { recursive: true, force: true })));
    } catch {}
  });

  // ----- helpers -----
  const rand = () => Math.random().toString(36).slice(2, 10);

  async function registerCreator(overrides = {}) {
    const body = {
      email: `creator-${rand()}@test.local`,
      password: "Passw0rd!",
      name: "Test Creator",
      ...overrides,
    };
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: body,
    });
    return { res, body };
  }

  async function createTenant(accessToken, overrides = {}) {
    const body = {
      name: `App ${rand()}`,
      slug: `app-${rand()}`,
      adminEmail: `admin-${rand()}@test.local`,
      adminPassword: "AdminPass1!",
      adminName: "Admin",
      publicRegistrationEnabled: true,
      ...overrides,
    };
    const res = await app.inject({
      method: "POST",
      url: "/v1/tenants",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: body,
    });
    return { res, body };
  }

  async function appLogin(tenantSlug, email, password) {
    return app.inject({
      method: "POST",
      url: "/v1/app-auth/login",
      payload: { tenantSlug, email, password },
    });
  }

  function bearer(t) {
    return { authorization: `Bearer ${t}` };
  }

  // ================================================================
  // /v1/health
  // ================================================================
  describe("GET /v1/health", () => {
    test("returns ok payload", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/health" });
      assert.equal(res.statusCode, 200);
      const body = res.json();
      assert.equal(body.ok, true);
      assert.equal(body.service, "mellucode-api");
    });
  });

  // ================================================================
  // /v1/auth (creator)
  // ================================================================
  describe("/v1/auth (creator)", () => {
    test("register creates user and returns tokens", async () => {
      const { res, body } = await registerCreator();
      assert.equal(res.statusCode, 201);
      const json = res.json();
      assert.equal(json.user.email, body.email);
      assert.ok(json.accessToken);
      assert.ok(json.refreshToken);
      assert.ok(!("passwordHash" in json.user), "password hash mai esposto");
    });

    test("register rejects duplicate email with 409", async () => {
      const email = `dup-${rand()}@test.local`;
      const a = await app.inject({
        method: "POST", url: "/v1/auth/register",
        payload: { email, password: "Passw0rd!" },
      });
      assert.equal(a.statusCode, 201);
      const b = await app.inject({
        method: "POST", url: "/v1/auth/register",
        payload: { email, password: "Passw0rd!" },
      });
      assert.equal(b.statusCode, 409);
    });

    test("register rejects invalid email with 400", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/auth/register",
        payload: { email: "not-an-email", password: "Passw0rd!" },
      });
      assert.equal(res.statusCode, 400);
    });

    test("register rejects short password (Fastify schema)", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/auth/register",
        payload: { email: `x-${rand()}@test.local`, password: "short" },
      });
      assert.equal(res.statusCode, 400);
    });

    test("login with correct credentials returns 200 + tokens", async () => {
      const { body } = await registerCreator();
      const res = await app.inject({
        method: "POST", url: "/v1/auth/login",
        payload: { email: body.email, password: body.password },
      });
      assert.equal(res.statusCode, 200);
      assert.ok(res.json().accessToken);
    });

    test("login with wrong password returns 401", async () => {
      const { body } = await registerCreator();
      const res = await app.inject({
        method: "POST", url: "/v1/auth/login",
        payload: { email: body.email, password: "wrong-password-1" },
      });
      assert.equal(res.statusCode, 401);
    });

    test("login with unknown email returns 401 (not 404)", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/auth/login",
        payload: { email: `nope-${rand()}@test.local`, password: "Whatever1!" },
      });
      assert.equal(res.statusCode, 401);
    });

    test("GET /me requires bearer token", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/auth/me" });
      assert.equal(res.statusCode, 401);
    });

    test("GET /me with valid token returns user", async () => {
      const reg = await registerCreator();
      const token = reg.res.json().accessToken;
      const res = await app.inject({
        method: "GET", url: "/v1/auth/me",
        headers: bearer(token),
      });
      assert.equal(res.statusCode, 200);
      assert.equal(res.json().user.email, reg.body.email);
    });

    test("refresh rotates token (old one becomes invalid)", async () => {
      const reg = await registerCreator();
      const oldRefresh = reg.res.json().refreshToken;

      const first = await app.inject({
        method: "POST", url: "/v1/auth/refresh",
        payload: { refreshToken: oldRefresh },
      });
      assert.equal(first.statusCode, 200);
      assert.ok(first.json().accessToken);
      const newRefresh = first.json().refreshToken;
      assert.notEqual(newRefresh, oldRefresh);

      // riutilizzare il vecchio refresh deve fallire
      const second = await app.inject({
        method: "POST", url: "/v1/auth/refresh",
        payload: { refreshToken: oldRefresh },
      });
      assert.equal(second.statusCode, 401);

      // il nuovo deve funzionare
      const third = await app.inject({
        method: "POST", url: "/v1/auth/refresh",
        payload: { refreshToken: newRefresh },
      });
      assert.equal(third.statusCode, 200);
    });

    test("logout revokes refresh token", async () => {
      const reg = await registerCreator();
      const refreshToken = reg.res.json().refreshToken;

      const out = await app.inject({
        method: "POST", url: "/v1/auth/logout",
        payload: { refreshToken },
      });
      assert.equal(out.statusCode, 204);

      const after = await app.inject({
        method: "POST", url: "/v1/auth/refresh",
        payload: { refreshToken },
      });
      assert.equal(after.statusCode, 401);
    });
  });

  // ================================================================
  // /v1/tenants
  // ================================================================
  describe("/v1/tenants", () => {
    test("POST requires auth", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/tenants",
        payload: { name: "X" },
      });
      assert.equal(res.statusCode, 401);
    });

    test("POST creates tenant + initial admin", async () => {
      const reg = await registerCreator();
      const token = reg.res.json().accessToken;
      const { res, body } = await createTenant(token);
      assert.equal(res.statusCode, 201);
      const json = res.json();
      assert.equal(json.tenant.slug, body.slug);
      assert.equal(json.tenant.status, "active");
      assert.equal(json.initialAdmin.email, body.adminEmail);
      assert.equal(json.initialAdmin.role, "admin");
      assert.equal(json.initialAdmin.mustChangePassword, true);
    });

    test("POST rejects duplicate slug with 409", async () => {
      const reg = await registerCreator();
      const token = reg.res.json().accessToken;
      const slug = `dup-${rand()}`;
      const a = await createTenant(token, { slug });
      assert.equal(a.res.statusCode, 201);
      const b = await createTenant(token, { slug });
      assert.equal(b.res.statusCode, 409);
    });

    test("GET lists only tenants owned by the caller", async () => {
      const r1 = await registerCreator();
      const t1 = r1.res.json().accessToken;
      await createTenant(t1, { slug: `mine-${rand()}` });
      await createTenant(t1, { slug: `mine-${rand()}` });

      const r2 = await registerCreator();
      const t2 = r2.res.json().accessToken;
      await createTenant(t2, { slug: `other-${rand()}` });

      const mine = await app.inject({
        method: "GET", url: "/v1/tenants",
        headers: bearer(t1),
      });
      assert.equal(mine.statusCode, 200);
      assert.equal(mine.json().tenants.length, 2);

      const other = await app.inject({
        method: "GET", url: "/v1/tenants",
        headers: bearer(t2),
      });
      assert.equal(other.json().tenants.length, 1);
    });

    test("GET /:id/stats returns tenant aggregates and AI quota for owner", async () => {
      const reg = await registerCreator();
      const creatorToken = reg.res.json().accessToken;
      const { res, body } = await createTenant(creatorToken);
      const tenant = res.json().tenant;

      const adminLogin = await appLogin(tenant.slug, body.adminEmail, body.adminPassword);
      const adminToken = adminLogin.json().accessToken;
      const adminUser = adminLogin.json().user;

      const entityRes = await app.inject({
        method: "POST", url: "/v1/data/entities",
        headers: bearer(adminToken),
        payload: {
          name: "customers",
          label: "Customers",
          schema: {
            properties: { name: { type: "string" } },
            required: ["name"],
          },
        },
      });
      assert.equal(entityRes.statusCode, 201);

      const recordRes = await app.inject({
        method: "POST", url: "/v1/data/customers",
        headers: bearer(adminToken),
        payload: { name: "Ada" },
      });
      assert.equal(recordRes.statusCode, 201);

      await db.insert(schema.mcAppFiles).values({
        tenantId: tenant.id,
        ownerAppUserId: adminUser.id,
        originalFilename: "logo.png",
        mimeType: "image/png",
        sizeBytes: 1234,
        storagePath: `${tenant.id}/fake-file-id`,
      });
      await db.insert(schema.mcAiQuotas).values({
        tenantId: tenant.id,
        monthlyLimitMicros: 100000,
        usedThisPeriodMicros: 25000,
      });
      await db.insert(schema.mcAiUsage).values({
        tenantId: tenant.id,
        appUserId: adminUser.id,
        model: "test/model",
        status: "succeeded",
        totalTokens: 42,
        costMicros: 7000,
      });

      const stats = await app.inject({
        method: "GET", url: `/v1/tenants/${tenant.id}/stats`,
        headers: bearer(creatorToken),
      });
      assert.equal(stats.statusCode, 200);
      const bodyStats = stats.json().stats;
      assert.equal(bodyStats.appUsers, 1);
      assert.equal(bodyStats.entities, 1);
      assert.equal(bodyStats.records, 1);
      assert.equal(bodyStats.files.count, 1);
      assert.equal(bodyStats.files.sizeBytes, 1234);
      assert.equal(bodyStats.ai.monthlyLimitCredits, 0.1);
      assert.equal(bodyStats.ai.usedThisPeriodCredits, 0.025);
      assert.equal(bodyStats.ai.remainingCredits, 0.075);
      assert.equal(bodyStats.ai.callsSucceeded, 1);
      assert.equal(bodyStats.ai.totalTokens, 42);
      assert.equal(bodyStats.ai.costCredits, 0.007);
    });

    test("GET /:id/stats does not expose tenants owned by another creator", async () => {
      const owner = await registerCreator();
      const t = await createTenant(owner.res.json().accessToken);
      const other = await registerCreator();

      const res = await app.inject({
        method: "GET",
        url: `/v1/tenants/${t.res.json().tenant.id}/stats`,
        headers: bearer(other.res.json().accessToken),
      });
      assert.equal(res.statusCode, 404);
    });
  });

  // ================================================================
  // /v1/app-auth
  // ================================================================
  describe("/v1/app-auth", () => {
    async function setup() {
      const reg = await registerCreator();
      const token = reg.res.json().accessToken;
      const { res, body } = await createTenant(token);
      return { tenant: res.json().tenant, adminBody: body };
    }

    test("login as initial admin works", async () => {
      const { tenant, adminBody } = await setup();
      const res = await appLogin(tenant.slug, adminBody.adminEmail, adminBody.adminPassword);
      assert.equal(res.statusCode, 200);
      const j = res.json();
      assert.equal(j.user.role, "admin");
      assert.equal(j.tenant.slug, tenant.slug);
      assert.ok(j.accessToken);
    });

    test("login with wrong tenant slug returns 404", async () => {
      const { adminBody } = await setup();
      const res = await appLogin("ghost-tenant-xx", adminBody.adminEmail, adminBody.adminPassword);
      assert.equal(res.statusCode, 404);
    });

    test("login with wrong password returns 401", async () => {
      const { tenant, adminBody } = await setup();
      const res = await appLogin(tenant.slug, adminBody.adminEmail, "WrongPass1!");
      assert.equal(res.statusCode, 401);
    });

    test("end-user register creates a 'user' role account", async () => {
      const { tenant } = await setup();
      const email = `end-${rand()}@test.local`;
      const res = await app.inject({
        method: "POST", url: "/v1/app-auth/register",
        payload: { tenantSlug: tenant.slug, email, password: "EndUser1!" },
      });
      assert.equal(res.statusCode, 201);
      assert.equal(res.json().user.role, "user");
    });

    test("end-user register blocked when publicRegistrationEnabled=false", async () => {
      const reg = await registerCreator();
      const token = reg.res.json().accessToken;
      const t = await createTenant(token, { publicRegistrationEnabled: false });
      const tenant = t.res.json().tenant;
      const res = await app.inject({
        method: "POST", url: "/v1/app-auth/register",
        payload: { tenantSlug: tenant.slug, email: `e-${rand()}@test.local`, password: "EndUser1!" },
      });
      assert.equal(res.statusCode, 403);
    });

    test("change-password updates and clears mustChangePassword", async () => {
      const { tenant, adminBody } = await setup();
      const login = await appLogin(tenant.slug, adminBody.adminEmail, adminBody.adminPassword);
      const token = login.json().accessToken;
      const res = await app.inject({
        method: "POST", url: "/v1/app-auth/change-password",
        headers: bearer(token),
        payload: { currentPassword: adminBody.adminPassword, newPassword: "BrandNew1!" },
      });
      assert.equal(res.statusCode, 200);
      assert.equal(res.json().user.mustChangePassword, false);

      // vecchia password ora rifiutata
      const reLogin = await appLogin(tenant.slug, adminBody.adminEmail, adminBody.adminPassword);
      assert.equal(reLogin.statusCode, 401);
      // nuova accettata
      const ok = await appLogin(tenant.slug, adminBody.adminEmail, "BrandNew1!");
      assert.equal(ok.statusCode, 200);
    });

    test("change-password rejects wrong current password", async () => {
      const { tenant, adminBody } = await setup();
      const login = await appLogin(tenant.slug, adminBody.adminEmail, adminBody.adminPassword);
      const token = login.json().accessToken;
      const res = await app.inject({
        method: "POST", url: "/v1/app-auth/change-password",
        headers: bearer(token),
        payload: { currentPassword: "WrongOne1!", newPassword: "BrandNew1!" },
      });
      assert.equal(res.statusCode, 401);
    });

    test("creator JWT cannot be used as app-auth token", async () => {
      const reg = await registerCreator();
      const creatorToken = reg.res.json().accessToken;
      const res = await app.inject({
        method: "GET", url: "/v1/app-auth/me",
        headers: bearer(creatorToken),
      });
      assert.equal(res.statusCode, 401);
    });
  });

  // ================================================================
  // /v1/data
  // ================================================================
  describe("/v1/data", () => {
    async function setupTenantAndAdmin() {
      const reg = await registerCreator();
      const creatorToken = reg.res.json().accessToken;
      const t = await createTenant(creatorToken);
      const tenant = t.res.json().tenant;
      const adminBody = t.body;
      const login = await appLogin(tenant.slug, adminBody.adminEmail, adminBody.adminPassword);
      const adminToken = login.json().accessToken;
      return { tenant, adminToken, adminBody };
    }

    async function defineProducts(adminToken, perms = undefined) {
      const payload = {
        name: "products",
        label: "Products",
        schema: {
          properties: {
            name: { type: "string", maxLength: 60 },
            price: { type: "number" },
          },
          required: ["name", "price"],
        },
      };
      if (perms) payload.permissions = perms;
      return app.inject({
        method: "POST", url: "/v1/data/entities",
        headers: bearer(adminToken),
        payload,
      });
    }

    test("only admin can define entities", async () => {
      const { tenant, adminToken } = await setupTenantAndAdmin();
      const ok = await defineProducts(adminToken);
      assert.equal(ok.statusCode, 201);

      // utente normale prova a definire entita'
      const email = `eu-${rand()}@test.local`;
      await app.inject({
        method: "POST", url: "/v1/app-auth/register",
        payload: { tenantSlug: tenant.slug, email, password: "EndUser1!" },
      });
      const loginUser = await appLogin(tenant.slug, email, "EndUser1!");
      const userToken = loginUser.json().accessToken;

      const denied = await defineProducts(userToken);
      assert.equal(denied.statusCode, 403);
    });

    test("create record validates required fields", async () => {
      const { adminToken } = await setupTenantAndAdmin();
      await defineProducts(adminToken);
      const bad = await app.inject({
        method: "POST", url: "/v1/data/products",
        headers: bearer(adminToken),
        payload: { name: "Pizza" }, // manca price
      });
      assert.equal(bad.statusCode, 400);
    });

    test("create + list + get records (tenant-scoped)", async () => {
      const { adminToken } = await setupTenantAndAdmin();
      await defineProducts(adminToken);

      const created = await app.inject({
        method: "POST", url: "/v1/data/products",
        headers: bearer(adminToken),
        payload: { name: "Pizza", price: 8.5 },
      });
      assert.equal(created.statusCode, 201);
      const recordId = created.json().record.id;

      const list = await app.inject({
        method: "GET", url: "/v1/data/products",
        headers: bearer(adminToken),
      });
      assert.equal(list.statusCode, 200);
      assert.equal(list.json().records.length, 1);

      const one = await app.inject({
        method: "GET", url: `/v1/data/products/${recordId}`,
        headers: bearer(adminToken),
      });
      assert.equal(one.statusCode, 200);
      assert.equal(one.json().record.data.name, "Pizza");
    });

    test("records of one tenant are not visible to another tenant", async () => {
      // tenant A
      const a = await setupTenantAndAdmin();
      await defineProducts(a.adminToken);
      await app.inject({
        method: "POST", url: "/v1/data/products",
        headers: bearer(a.adminToken),
        payload: { name: "OnlyA", price: 1 },
      });

      // tenant B (creato da un altro creator)
      const b = await setupTenantAndAdmin();
      await defineProducts(b.adminToken);

      const list = await app.inject({
        method: "GET", url: "/v1/data/products",
        headers: bearer(b.adminToken),
      });
      assert.equal(list.statusCode, 200);
      assert.equal(list.json().records.length, 0, "tenant B non deve vedere record di tenant A");
    });

    test("owner_or_admin: owner can update own, others cannot", async () => {
      const { tenant, adminToken } = await setupTenantAndAdmin();
      await defineProducts(adminToken);

      // user A crea record
      const userAEmail = `ua-${rand()}@test.local`;
      await app.inject({
        method: "POST", url: "/v1/app-auth/register",
        payload: { tenantSlug: tenant.slug, email: userAEmail, password: "User1Pass!" },
      });
      const loginA = await appLogin(tenant.slug, userAEmail, "User1Pass!");
      const tokenA = loginA.json().accessToken;
      const created = await app.inject({
        method: "POST", url: "/v1/data/products",
        headers: bearer(tokenA),
        payload: { name: "Mine", price: 1 },
      });
      assert.equal(created.statusCode, 201);
      const recordId = created.json().record.id;

      // user B prova a modificare
      const userBEmail = `ub-${rand()}@test.local`;
      await app.inject({
        method: "POST", url: "/v1/app-auth/register",
        payload: { tenantSlug: tenant.slug, email: userBEmail, password: "User2Pass!" },
      });
      const loginB = await appLogin(tenant.slug, userBEmail, "User2Pass!");
      const tokenB = loginB.json().accessToken;

      const denied = await app.inject({
        method: "PATCH", url: `/v1/data/products/${recordId}`,
        headers: bearer(tokenB),
        payload: { price: 2 },
      });
      assert.equal(denied.statusCode, 403);

      // user A puo' (e' owner)
      const ok = await app.inject({
        method: "PATCH", url: `/v1/data/products/${recordId}`,
        headers: bearer(tokenA),
        payload: { price: 99 },
      });
      assert.equal(ok.statusCode, 200);
      assert.equal(ok.json().record.data.price, 99);

      // admin puo' sempre
      const okAdmin = await app.inject({
        method: "PATCH", url: `/v1/data/products/${recordId}`,
        headers: bearer(adminToken),
        payload: { price: 100 },
      });
      assert.equal(okAdmin.statusCode, 200);
    });

    test("delete with permission=admin denies non-admin, allows admin", async () => {
      const { tenant, adminToken } = await setupTenantAndAdmin();
      await defineProducts(adminToken, {
        read: "authenticated",
        create: "authenticated",
        update: "owner_or_admin",
        delete: "admin",
      });

      // user crea
      const email = `uc-${rand()}@test.local`;
      await app.inject({
        method: "POST", url: "/v1/app-auth/register",
        payload: { tenantSlug: tenant.slug, email, password: "User1Pass!" },
      });
      const login = await appLogin(tenant.slug, email, "User1Pass!");
      const userToken = login.json().accessToken;
      const created = await app.inject({
        method: "POST", url: "/v1/data/products",
        headers: bearer(userToken),
        payload: { name: "X", price: 1 },
      });
      const recordId = created.json().record.id;

      // user prova delete -> 403
      const denied = await app.inject({
        method: "DELETE", url: `/v1/data/products/${recordId}`,
        headers: bearer(userToken),
      });
      assert.equal(denied.statusCode, 403);

      // admin -> 204
      const ok = await app.inject({
        method: "DELETE", url: `/v1/data/products/${recordId}`,
        headers: bearer(adminToken),
      });
      assert.equal(ok.statusCode, 204);
    });

    test("get/list/update on unknown entity returns 404", async () => {
      const { adminToken } = await setupTenantAndAdmin();
      const res = await app.inject({
        method: "GET", url: "/v1/data/ghosts",
        headers: bearer(adminToken),
      });
      assert.equal(res.statusCode, 404);
    });

    test("data endpoints require an app_user JWT (creator JWT rejected)", async () => {
      const reg = await registerCreator();
      const creatorToken = reg.res.json().accessToken;
      const res = await app.inject({
        method: "GET", url: "/v1/data/entities",
        headers: bearer(creatorToken),
      });
      assert.equal(res.statusCode, 401);
    });
  });

  // ================================================================
  // /v1/files
  // ================================================================
  describe("/v1/files", () => {
    // Multipart body builder manuale (niente form-data dep).
    function multipartBody({ filename, mimeType, content, fields = {} }) {
      const boundary = `----mctest${Math.random().toString(36).slice(2)}`;
      const CRLF = "\r\n";
      const parts = [];
      for (const [k, v] of Object.entries(fields)) {
        parts.push(Buffer.from(
          `--${boundary}${CRLF}` +
          `Content-Disposition: form-data; name="${k}"${CRLF}${CRLF}` +
          `${v}${CRLF}`
        ));
      }
      parts.push(Buffer.from(
        `--${boundary}${CRLF}` +
        `Content-Disposition: form-data; name="file"; filename="${filename}"${CRLF}` +
        `Content-Type: ${mimeType}${CRLF}${CRLF}`
      ));
      parts.push(Buffer.isBuffer(content) ? content : Buffer.from(content));
      parts.push(Buffer.from(`${CRLF}--${boundary}--${CRLF}`));
      return {
        payload: Buffer.concat(parts),
        contentType: `multipart/form-data; boundary=${boundary}`,
      };
    }

    async function setupTenantAndAdmin() {
      const reg = await registerCreator();
      const t = await createTenant(reg.res.json().accessToken);
      const tenant = t.res.json().tenant;
      const login = await appLogin(tenant.slug, t.body.adminEmail, t.body.adminPassword);
      return { tenant, adminToken: login.json().accessToken, adminBody: t.body };
    }

    async function uploadAs(token, opts = {}) {
      const mp = multipartBody({
        filename: opts.filename ?? "hello.txt",
        mimeType: opts.mimeType ?? "text/plain",
        content: opts.content ?? "hello mellucode",
        fields: opts.fields ?? {},
      });
      return app.inject({
        method: "POST", url: "/v1/files/upload",
        headers: { ...bearer(token), "content-type": mp.contentType },
        payload: mp.payload,
      });
    }

    test("upload + metadata + list", async () => {
      const { adminToken } = await setupTenantAndAdmin();
      const up = await uploadAs(adminToken, { filename: "ciao.txt", content: "ciao" });
      assert.equal(up.statusCode, 201);
      const f = up.json().file;
      assert.equal(f.originalFilename, "ciao.txt");
      assert.equal(f.mimeType, "text/plain");
      assert.equal(f.sizeBytes, Buffer.from("ciao").length);

      const meta = await app.inject({
        method: "GET", url: `/v1/files/${f.id}`,
        headers: bearer(adminToken),
      });
      assert.equal(meta.statusCode, 200);
      assert.equal(meta.json().file.id, f.id);

      const list = await app.inject({
        method: "GET", url: "/v1/files",
        headers: bearer(adminToken),
      });
      assert.equal(list.statusCode, 200);
      assert.equal(list.json().files.length, 1);
    });

    test("download content returns the original bytes", async () => {
      const { adminToken } = await setupTenantAndAdmin();
      const payload = Buffer.from("12345abcde");
      const up = await uploadAs(adminToken, { filename: "data.bin", mimeType: "application/octet-stream", content: payload });
      const id = up.json().file.id;

      const dl = await app.inject({
        method: "GET", url: `/v1/files/${id}/content`,
        headers: bearer(adminToken),
      });
      assert.equal(dl.statusCode, 200);
      assert.equal(dl.headers["content-type"], "application/octet-stream");
      assert.match(dl.headers["content-disposition"], /filename="data\.bin"/);
      assert.equal(Buffer.from(dl.rawPayload).compare(payload), 0);
    });

    test("optional metadata field is preserved", async () => {
      const { adminToken } = await setupTenantAndAdmin();
      const up = await uploadAs(adminToken, {
        fields: { metadata: JSON.stringify({ alt: "logo", focal: "center" }) },
      });
      const f = up.json().file;
      assert.deepEqual(f.metadata, { alt: "logo", focal: "center" });
    });

    test("invalid JSON metadata is silently ignored (no upload failure)", async () => {
      const { adminToken } = await setupTenantAndAdmin();
      const up = await uploadAs(adminToken, { fields: { metadata: "{ not-json" } });
      assert.equal(up.statusCode, 201);
      assert.deepEqual(up.json().file.metadata, {});
    });

    test("upload over the byte limit returns 413", async () => {
      const { adminToken } = await setupTenantAndAdmin();
      const big = Buffer.alloc(4096, 0x41); // 4 KB > 2 KB limit in test env
      const up = await uploadAs(adminToken, { filename: "big.bin", content: big });
      assert.equal(up.statusCode, 413);
    });

    test("upload without multipart body returns 400", async () => {
      const { adminToken } = await setupTenantAndAdmin();
      const res = await app.inject({
        method: "POST", url: "/v1/files/upload",
        headers: { ...bearer(adminToken), "content-type": "application/json" },
        payload: { not: "multipart" },
      });
      assert.equal(res.statusCode, 400);
    });

    test("files of one tenant are not visible to another", async () => {
      const a = await setupTenantAndAdmin();
      const upA = await uploadAs(a.adminToken, { filename: "A.txt", content: "from A" });
      const fileAId = upA.json().file.id;

      const b = await setupTenantAndAdmin();
      const list = await app.inject({
        method: "GET", url: "/v1/files",
        headers: bearer(b.adminToken),
      });
      assert.equal(list.statusCode, 200);
      assert.equal(list.json().files.length, 0);

      const cross = await app.inject({
        method: "GET", url: `/v1/files/${fileAId}`,
        headers: bearer(b.adminToken),
      });
      assert.equal(cross.statusCode, 404);
    });

    test("delete: non-owner non-admin -> 403; owner -> 204; admin can always", async () => {
      const { tenant, adminToken } = await setupTenantAndAdmin();

      // user A uploada
      const emailA = `ua-${rand()}@test.local`;
      await app.inject({
        method: "POST", url: "/v1/app-auth/register",
        payload: { tenantSlug: tenant.slug, email: emailA, password: "User1Pass!" },
      });
      const tokenA = (await appLogin(tenant.slug, emailA, "User1Pass!")).json().accessToken;
      const id1 = (await uploadAs(tokenA, { filename: "mine.txt" })).json().file.id;

      // user B prova delete
      const emailB = `ub-${rand()}@test.local`;
      await app.inject({
        method: "POST", url: "/v1/app-auth/register",
        payload: { tenantSlug: tenant.slug, email: emailB, password: "User2Pass!" },
      });
      const tokenB = (await appLogin(tenant.slug, emailB, "User2Pass!")).json().accessToken;

      const denied = await app.inject({
        method: "DELETE", url: `/v1/files/${id1}`,
        headers: bearer(tokenB),
      });
      assert.equal(denied.statusCode, 403);

      // owner ok
      const ownerDel = await app.inject({
        method: "DELETE", url: `/v1/files/${id1}`,
        headers: bearer(tokenA),
      });
      assert.equal(ownerDel.statusCode, 204);

      // admin puo' sempre (su un nuovo file di user A)
      const id2 = (await uploadAs(tokenA, { filename: "second.txt" })).json().file.id;
      const adminDel = await app.inject({
        method: "DELETE", url: `/v1/files/${id2}`,
        headers: bearer(adminToken),
      });
      assert.equal(adminDel.statusCode, 204);
    });

    test("delete removes both DB row and disk file", async () => {
      const { adminToken } = await setupTenantAndAdmin();
      const up = await uploadAs(adminToken, { filename: "purge.txt", content: "x" });
      const id = up.json().file.id;

      await app.inject({
        method: "DELETE", url: `/v1/files/${id}`,
        headers: bearer(adminToken),
      });

      const after = await app.inject({
        method: "GET", url: `/v1/files/${id}`,
        headers: bearer(adminToken),
      });
      assert.equal(after.statusCode, 404);

      // verifica disco: la dir del tenant non contiene piu' il file id
      const tenantDirs = await fs.readdir(STORAGE_ROOT);
      for (const tdir of tenantDirs) {
        const files = await fs.readdir(path.join(STORAGE_ROOT, tdir)).catch(() => []);
        assert.ok(!files.includes(id), `file ${id} dovrebbe essere sparito dal disco`);
      }
    });

    test("files endpoints require an app_user JWT (creator JWT rejected)", async () => {
      const reg = await registerCreator();
      const res = await app.inject({
        method: "GET", url: "/v1/files",
        headers: bearer(reg.res.json().accessToken),
      });
      assert.equal(res.statusCode, 401);
    });

    test("GET /v1/files/:id requires bearer", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/files/00000000-0000-4000-8000-000000000000" });
      assert.equal(res.statusCode, 401);
    });
  });

  // ================================================================
  // /v1/email
  // ================================================================
  describe("/v1/email", () => {
    async function setupTenantAndUsers() {
      const reg = await registerCreator();
      const t = await createTenant(reg.res.json().accessToken);
      const tenant = t.res.json().tenant;
      const adminLogin = await appLogin(tenant.slug, t.body.adminEmail, t.body.adminPassword);
      const adminToken = adminLogin.json().accessToken;

      const userEmail = `mail-user-${rand()}@test.local`;
      await app.inject({
        method: "POST", url: "/v1/app-auth/register",
        payload: { tenantSlug: tenant.slug, email: userEmail, password: "User1Pass!" },
      });
      const userLogin = await appLogin(tenant.slug, userEmail, "User1Pass!");
      return { tenant, adminToken, userToken: userLogin.json().accessToken };
    }

    test("admin can send email and write log", async () => {
      const { adminToken } = await setupTenantAndUsers();
      const res = await app.inject({
        method: "POST", url: "/v1/email/send",
        headers: bearer(adminToken),
        payload: {
          to: ["Cliente@Example.com", "cliente@example.com"],
          subject: "Benvenuto",
          text: "La tua app e' pronta.",
          metadata: { reason: "welcome" },
        },
      });
      assert.equal(res.statusCode, 200);
      assert.equal(res.json().ok, true);
      assert.ok(res.json().messageId);

      const logs = await db.select().from(schema.mcEmailLog);
      assert.equal(logs.length, 1);
      assert.deepEqual(logs[0].to, ["cliente@example.com"]);
      assert.equal(logs[0].subject, "Benvenuto");
      assert.equal(logs[0].status, "sent");
      assert.equal(logs[0].metadata.reason, "welcome");
    });

    test("non-admin app user cannot send email", async () => {
      const { userToken } = await setupTenantAndUsers();
      const res = await app.inject({
        method: "POST", url: "/v1/email/send",
        headers: bearer(userToken),
        payload: {
          to: "cliente@example.com",
          subject: "No",
          text: "No",
        },
      });
      assert.equal(res.statusCode, 403);
    });

    test("creator token is rejected", async () => {
      const reg = await registerCreator();
      const res = await app.inject({
        method: "POST", url: "/v1/email/send",
        headers: bearer(reg.res.json().accessToken),
        payload: {
          to: "cliente@example.com",
          subject: "No",
          text: "No",
        },
      });
      assert.equal(res.statusCode, 401);
    });

    test("invalid recipient and empty body are rejected", async () => {
      const { adminToken } = await setupTenantAndUsers();
      const badTo = await app.inject({
        method: "POST", url: "/v1/email/send",
        headers: bearer(adminToken),
        payload: {
          to: "not-an-email",
          subject: "No",
          text: "No",
        },
      });
      assert.equal(badTo.statusCode, 400);

      const emptyContent = await app.inject({
        method: "POST", url: "/v1/email/send",
        headers: bearer(adminToken),
        payload: {
          to: "cliente@example.com",
          subject: "No",
        },
      });
      assert.equal(emptyContent.statusCode, 400);
    });
  });

  // ================================================================
  // /v1/ai
  // ================================================================
  describe("/v1/ai", () => {
    async function setupTenantAndUsers() {
      const reg = await registerCreator();
      const t = await createTenant(reg.res.json().accessToken);
      const tenant = t.res.json().tenant;
      const adminLogin = await appLogin(tenant.slug, t.body.adminEmail, t.body.adminPassword);
      const adminToken = adminLogin.json().accessToken;

      const userEmail = `ai-user-${rand()}@test.local`;
      await app.inject({
        method: "POST", url: "/v1/app-auth/register",
        payload: { tenantSlug: tenant.slug, email: userEmail, password: "User1Pass!" },
      });
      const userLogin = await appLogin(tenant.slug, userEmail, "User1Pass!");
      return { tenant, adminToken, userToken: userLogin.json().accessToken };
    }

    test("app user can call chat; usage and quota are recorded", async () => {
      const { tenant, userToken } = await setupTenantAndUsers();
      const res = await app.inject({
        method: "POST", url: "/v1/ai/chat",
        headers: bearer(userToken),
        payload: {
          messages: [{ role: "user", content: "Rispondi con un saluto." }],
          maxTokens: 64,
          metadata: { feature: "assistant" },
        },
      });
      assert.equal(res.statusCode, 200);
      const body = res.json();
      assert.equal(body.reply, "Risposta AI di test MelluCode.");
      assert.equal(body.usage.totalTokens, 20);
      assert.equal(body.usage.costCredits, 0.00002);
      assert.equal(body.usage.quota.remainingCredits, 0.99998);

      const usageRows = await db.select().from(schema.mcAiUsage);
      assert.equal(usageRows.length, 1);
      assert.equal(usageRows[0].tenantId, tenant.id);
      assert.equal(usageRows[0].model, "test/model");
      assert.equal(usageRows[0].status, "succeeded");
      assert.equal(usageRows[0].costMicros, 20);
      assert.equal(usageRows[0].requestMetadata.feature, "assistant");

      const quotaRows = await db.select().from(schema.mcAiQuotas).where(eq(schema.mcAiQuotas.tenantId, tenant.id));
      assert.equal(quotaRows[0].usedThisPeriodMicros, 20);
    });

    test("GET /quota returns current quota", async () => {
      const { userToken } = await setupTenantAndUsers();
      const res = await app.inject({
        method: "GET", url: "/v1/ai/quota",
        headers: bearer(userToken),
      });
      assert.equal(res.statusCode, 200);
      assert.equal(res.json().quota.monthlyLimitCredits, 1);
    });

    test("quota hard limit blocks chat before calling provider", async () => {
      const { tenant, userToken } = await setupTenantAndUsers();
      await db
        .insert(schema.mcAiQuotas)
        .values({
          tenantId: tenant.id,
          monthlyLimitMicros: 10,
          usedThisPeriodMicros: 10,
        })
        .onConflictDoUpdate({
          target: schema.mcAiQuotas.tenantId,
          set: { monthlyLimitMicros: 10, usedThisPeriodMicros: 10 },
        });

      const res = await app.inject({
        method: "POST", url: "/v1/ai/chat",
        headers: bearer(userToken),
        payload: {
          messages: [{ role: "user", content: "Ciao" }],
        },
      });
      assert.equal(res.statusCode, 402);
      assert.match(res.json().error, /Credito AI insufficiente/);
      const usageRows = await db.select().from(schema.mcAiUsage);
      assert.equal(usageRows.length, 0);
    });

    test("creator token is rejected and unknown model is blocked", async () => {
      const reg = await registerCreator();
      const creator = await app.inject({
        method: "POST", url: "/v1/ai/chat",
        headers: bearer(reg.res.json().accessToken),
        payload: { messages: [{ role: "user", content: "Ciao" }] },
      });
      assert.equal(creator.statusCode, 401);

      const { userToken } = await setupTenantAndUsers();
      const model = await app.inject({
        method: "POST", url: "/v1/ai/chat",
        headers: bearer(userToken),
        payload: {
          model: "very-expensive/model",
          messages: [{ role: "user", content: "Ciao" }],
        },
      });
      assert.equal(model.statusCode, 400);
      assert.match(model.json().error, /Modello AI non abilitato/);
    });
  });
}
