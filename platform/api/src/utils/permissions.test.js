import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PERMISSIONS, permissionFor, canAccess } from "./permissions.js";

const admin = { id: "u-admin", role: "admin" };
const userA = { id: "u-a", role: "user" };
const userB = { id: "u-b", role: "user" };
const recordOfA = { createdByAppUserId: "u-a" };

function entity(permOverrides = {}) {
  return { permissions: permOverrides };
}

test("DEFAULT_PERMISSIONS reflect conservative posture", () => {
  assert.equal(DEFAULT_PERMISSIONS.read, "authenticated");
  assert.equal(DEFAULT_PERMISSIONS.create, "authenticated");
  assert.equal(DEFAULT_PERMISSIONS.update, "owner_or_admin");
  assert.equal(DEFAULT_PERMISSIONS.delete, "owner_or_admin");
});

test("permissionFor falls back to default on missing/invalid mode", () => {
  assert.equal(permissionFor({}, "read"), "authenticated");
  assert.equal(permissionFor({ permissions: { read: "wat" } }, "read"), "authenticated");
  assert.equal(permissionFor({ permissions: { read: "admin" } }, "read"), "admin");
  assert.equal(permissionFor(null, "delete"), "owner_or_admin");
});

test("canAccess with mode=none denies everyone, even admin", () => {
  const e = entity({ delete: "none" });
  assert.equal(canAccess(e, "delete", admin, recordOfA), false);
  assert.equal(canAccess(e, "delete", userA, recordOfA), false);
});

test("canAccess with mode=authenticated allows any logged-in user", () => {
  const e = entity({ create: "authenticated" });
  assert.equal(canAccess(e, "create", userA), true);
  assert.equal(canAccess(e, "create", userB), true);
  assert.equal(canAccess(e, "create", admin), true);
});

test("canAccess denies when no user is provided", () => {
  assert.equal(canAccess(entity(), "read", null), false);
  assert.equal(canAccess(entity(), "read", undefined), false);
});

test("canAccess with mode=admin only allows admin role", () => {
  const e = entity({ create: "admin" });
  assert.equal(canAccess(e, "create", admin), true);
  assert.equal(canAccess(e, "create", userA), false);
});

test("canAccess with mode=owner_or_admin lets owner or admin", () => {
  const e = entity({ update: "owner_or_admin" });
  assert.equal(canAccess(e, "update", admin, recordOfA), true, "admin always wins");
  assert.equal(canAccess(e, "update", userA, recordOfA), true, "owner can");
  assert.equal(canAccess(e, "update", userB, recordOfA), false, "other user cannot");
});

test("canAccess with owner_or_admin and no record denies non-admin", () => {
  const e = entity({ update: "owner_or_admin" });
  assert.equal(canAccess(e, "update", userA, null), false);
  assert.equal(canAccess(e, "update", admin, null), true);
});

test("canAccess uses defaults when entity has no permissions block", () => {
  assert.equal(canAccess({}, "read", userA), true);
  assert.equal(canAccess({}, "update", userB, recordOfA), false);
  assert.equal(canAccess({}, "update", userA, recordOfA), true);
});
