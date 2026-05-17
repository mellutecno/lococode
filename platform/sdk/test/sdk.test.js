import test from "node:test";
import assert from "node:assert/strict";
import { MelluCode, MelluCodeError, createMemoryStorage } from "../src/index.js";

function jsonResponse(payload, status = 200) {
  return new Response(payload === null ? null : JSON.stringify(payload), {
    status,
    headers: payload === null ? {} : { "content-type": "application/json" },
  });
}

function createFetchMock(handlers) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const path = new URL(url).pathname;
    const call = {
      url,
      path,
      method: options.method || "GET",
      headers: options.headers || {},
      body: options.body ? JSON.parse(options.body) : null,
    };
    calls.push(call);
    const handler = handlers.shift();
    if (!handler) throw new Error(`Unexpected request: ${call.method} ${path}`);
    return handler(call);
  };
  return { fetchImpl, calls };
}

test("login stores tokens and me sends bearer token", async () => {
  const { fetchImpl, calls } = createFetchMock([
    (call) => {
      assert.equal(call.path, "/v1/app-auth/login");
      assert.equal(call.body.tenantSlug, "gym");
      return jsonResponse({
        accessToken: "access-1",
        refreshToken: "refresh-1",
        user: { email: "admin@example.com" },
      });
    },
    (call) => {
      assert.equal(call.path, "/v1/app-auth/me");
      assert.equal(call.headers.Authorization, "Bearer access-1");
      assert.equal(call.headers["X-Tenant-Slug"], "gym");
      return jsonResponse({ user: { email: "admin@example.com" } });
    },
  ]);

  const mc = new MelluCode({
    apiUrl: "https://api.example.test",
    tenantSlug: "gym",
    storage: createMemoryStorage(),
    fetchImpl,
  });

  await mc.auth.login({ email: "admin@example.com", password: "admin123" });
  const me = await mc.auth.me();

  assert.equal(me.user.email, "admin@example.com");
  assert.equal(mc.accessToken, "access-1");
  assert.equal(mc.refreshToken, "refresh-1");
  assert.equal(calls.length, 2);
});

test("request refreshes access token once on 401", async () => {
  const { fetchImpl, calls } = createFetchMock([
    () => jsonResponse({ error: "expired" }, 401),
    (call) => {
      assert.equal(call.path, "/v1/app-auth/refresh");
      assert.equal(call.body.refreshToken, "refresh-1");
      return jsonResponse({ accessToken: "access-2", refreshToken: "refresh-2" });
    },
    (call) => {
      assert.equal(call.headers.Authorization, "Bearer access-2");
      return jsonResponse({ records: [] });
    },
  ]);

  const storage = createMemoryStorage({
    "mellucode:gym:accessToken": "access-1",
    "mellucode:gym:refreshToken": "refresh-1",
  });
  const mc = new MelluCode({
    apiUrl: "https://api.example.test",
    tenantSlug: "gym",
    storage,
    fetchImpl,
  });

  const response = await mc.data("members").list();

  assert.deepEqual(response.records, []);
  assert.equal(mc.accessToken, "access-2");
  assert.equal(mc.refreshToken, "refresh-2");
  assert.equal(calls.length, 3);
});

test("entities and records call Data API paths", async () => {
  const { fetchImpl, calls } = createFetchMock([
    (call) => {
      assert.equal(call.path, "/v1/data/entities");
      assert.equal(call.method, "POST");
      assert.equal(call.body.name, "members");
      return jsonResponse({ entity: { name: "members" }, created: true }, 201);
    },
    (call) => {
      assert.equal(call.path, "/v1/data/members");
      assert.equal(call.method, "POST");
      assert.equal(call.body.fullName, "Mario Rossi");
      return jsonResponse({ record: { id: "rec-1", data: call.body } }, 201);
    },
    (call) => {
      assert.equal(call.path, "/v1/data/members/rec-1");
      assert.equal(call.method, "PATCH");
      return jsonResponse({ record: { id: "rec-1", data: call.body } });
    },
    (call) => {
      assert.equal(call.path, "/v1/data/members/rec-1");
      assert.equal(call.method, "DELETE");
      return jsonResponse(null, 204);
    },
  ]);

  const mc = new MelluCode({
    apiUrl: "https://api.example.test",
    tenantSlug: "gym",
    storage: createMemoryStorage({ "mellucode:gym:accessToken": "access-1" }),
    fetchImpl,
  });

  await mc.entities.upsert({ name: "members", schema: { required: ["fullName"] } });
  await mc.data("members").create({ fullName: "Mario Rossi" });
  await mc.data("members").update("rec-1", { active: false });
  const deleted = await mc.data("members").delete("rec-1");

  assert.equal(deleted, true);
  assert.equal(calls.length, 4);
});

test("API errors throw MelluCodeError", async () => {
  const { fetchImpl } = createFetchMock([
    () => jsonResponse({ error: "Accesso non consentito." }, 403),
  ]);
  const mc = new MelluCode({
    apiUrl: "https://api.example.test",
    tenantSlug: "gym",
    storage: createMemoryStorage({ "mellucode:gym:accessToken": "access-1" }),
    fetchImpl,
  });

  await assert.rejects(
    () => mc.data("members").create({}),
    (err) => {
      assert.ok(err instanceof MelluCodeError);
      assert.equal(err.status, 403);
      assert.equal(err.message, "Accesso non consentito.");
      return true;
    }
  );
});
