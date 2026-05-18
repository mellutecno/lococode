import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { extractJsonArray, validateEntityDef, buildSystemPrompt } from "../utils/orchestrator.js";

describe("buildSystemPrompt", () => {
  test("returns a non-empty string", () => {
    const prompt = buildSystemPrompt();
    assert.equal(typeof prompt, "string");
    assert.ok(prompt.length > 100);
    assert.ok(prompt.includes("JSON array"));
  });
});

describe("extractJsonArray", () => {
  test("parses raw JSON array", () => {
    const result = extractJsonArray('[{"name":"users"}]');
    assert.deepEqual(result, [{ name: "users" }]);
  });

  test("parses JSON with markdown fences", () => {
    const result = extractJsonArray("```json\n[{\"name\":\"users\"}]\n```");
    assert.deepEqual(result, [{ name: "users" }]);
  });

  test("parses JSON with plain fences", () => {
    const result = extractJsonArray("```\n[{\"name\":\"users\"}]\n```");
    assert.deepEqual(result, [{ name: "users" }]);
  });

  test("parses JSON embedded in text", () => {
    const result = extractJsonArray("Ecco le entita':\n\n```json\n[{\"name\":\"users\"}]\n```\n\nFine.");
    assert.deepEqual(result, [{ name: "users" }]);
  });

  test("parses JSON without fences but with surrounding text", () => {
    const result = extractJsonArray("Risultato: [{\"name\":\"users\"}] Fine.");
    assert.deepEqual(result, [{ name: "users" }]);
  });

  test("returns null for invalid JSON", () => {
    const result = extractJsonArray("not json");
    assert.equal(result, null);
  });

  test("returns null for empty string", () => {
    const result = extractJsonArray("");
    assert.equal(result, null);
  });

  test("returns null for JSON object instead of array", () => {
    const result = extractJsonArray('{\"name\":\"users\"}');
    assert.equal(result, null);
  });
});

describe("validateEntityDef", () => {
  test("accepts valid minimal entity", () => {
    const result = validateEntityDef({ name: "users", label: "Utenti" });
    assert.equal(result.ok, true);
    assert.equal(result.values.name, "users");
    assert.equal(result.values.label, "Utenti");
    assert.deepEqual(result.values.schema, {});
    assert.deepEqual(result.values.permissions, { read: "authenticated", create: "authenticated", update: "owner_or_admin", delete: "owner_or_admin" });
    assert.deepEqual(result.values.metadata, {});
  });

  test("accepts entity with schema and permissions", () => {
    const result = validateEntityDef({
      name: "products",
      label: "Prodotti",
      schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
      permissions: { read: "authenticated", delete: "admin" },
      metadata: { icon: "box" },
    });
    assert.equal(result.ok, true);
    assert.equal(result.values.name, "products");
    assert.equal(result.values.permissions.delete, "admin");
    assert.equal(result.values.permissions.update, "owner_or_admin");
  });

  test("rejects invalid name", () => {
    const result = validateEntityDef({ name: "123invalid" });
    assert.equal(result.ok, false);
    assert.ok(result.error.includes("Nome entità non valido"));
  });

  test("rejects missing name", () => {
    const result = validateEntityDef({ label: "No name" });
    assert.equal(result.ok, false);
    assert.ok(result.error.includes("Nome entità non valido"));
  });

  test("rejects invalid permission key", () => {
    const result = validateEntityDef({ name: "users", permissions: { write: "admin" } });
    assert.equal(result.ok, false);
    assert.ok(result.error.includes("Chiave permesso non valida"));
  });

  test("rejects invalid permission value", () => {
    const result = validateEntityDef({ name: "users", permissions: { read: "everyone" } });
    assert.equal(result.ok, false);
    assert.ok(result.error.includes("Valore permesso non valido"));
  });

  test("rejects non-object schema", () => {
    const result = validateEntityDef({ name: "users", schema: "bad" });
    assert.equal(result.ok, false);
    assert.ok(result.error.includes("schema deve essere un oggetto JSON"));
  });

  test("rejects schema with wrong top-level type", () => {
    const result = validateEntityDef({ name: "users", schema: { type: "array" } });
    assert.equal(result.ok, false);
    assert.ok(result.error.includes("type: 'object'"));
  });

  test("uses name as label fallback", () => {
    const result = validateEntityDef({ name: "orders" });
    assert.equal(result.ok, true);
    assert.equal(result.values.label, "orders");
  });

  test("rejects non-object input", () => {
    const result = validateEntityDef("string");
    assert.equal(result.ok, false);
  });
});
