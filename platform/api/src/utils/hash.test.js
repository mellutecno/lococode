// argon2 e' volutamente lento (~50-150ms a hash). Teniamo poche chiamate.
import { test } from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword, generateToken, hashToken } from "./hash.js";

test("hashPassword produces argon2id hash that verifies", async () => {
  const hash = await hashPassword("CorrectHorseBattery!");
  assert.match(hash, /^\$argon2id\$/);
  assert.equal(await verifyPassword(hash, "CorrectHorseBattery!"), true);
});

test("verifyPassword rejects wrong password", async () => {
  const hash = await hashPassword("right-one");
  assert.equal(await verifyPassword(hash, "wrong-one"), false);
});

test("verifyPassword returns false on malformed hash without throwing", async () => {
  assert.equal(await verifyPassword("not-an-argon2-hash", "whatever"), false);
  assert.equal(await verifyPassword("", "whatever"), false);
});

test("generateToken yields base64url string of expected entropy", () => {
  const a = generateToken();
  const b = generateToken();
  assert.notEqual(a, b);
  assert.match(a, /^[A-Za-z0-9_-]+$/);
  // 32 bytes base64url -> 43 chars
  assert.equal(a.length, 43);

  const small = generateToken(16);
  assert.equal(small.length, 22);
});

test("hashToken is deterministic sha256 hex", () => {
  const h1 = hashToken("hello");
  const h2 = hashToken("hello");
  assert.equal(h1, h2);
  assert.equal(h1.length, 64);
  assert.match(h1, /^[0-9a-f]+$/);
  assert.notEqual(hashToken("hello"), hashToken("hellp"));
});
