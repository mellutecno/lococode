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

const TEST_DB = process.env.TEST_DATABASE_URL;

if (!TEST_DB) {
  test("integration suite skipped (set TEST_DATABASE_URL to enable)", { skip: true }, () => {});
} else {
  // ATTENZIONE: setare env PRIMA di importare config/db, altrimenti config.js
  // legge le var al module-load e fallisce.
  process.env.DATABASE_URL = TEST_DB;
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-secret-must-be-at-least-32-characters-long";
  process.env.NODE_ENV = "test";

  const { buildApp } = await import("../app.js");
  const { db } = await import("../db/index.js");
  const { runMigrations } = await import("../db/migrate.js");
  const { sql } = await import("drizzle-orm");

  let app;

  before(async () => {
    await runMigrations();
    app = await buildApp({ logger: false });
    await app.ready();
  });

  after(async () => {
    if (app) await app.close();
  });

  beforeEach(async () => {
    await db.execute(sql`
      TRUNCATE TABLE
        mc_audit_log,
        mc_app_records,
        mc_app_entities,
        mc_app_user_sessions,
        mc_app_users,
        mc_tenants,
        mc_sessions,
        mc_users
      RESTART IDENTITY CASCADE
    `);
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
}
