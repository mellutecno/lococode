import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { extractJsonArray, validateEntityDef, buildSystemPrompt, pickThemeFromEntities } from "../utils/orchestrator.js";
import { SECTORS } from "../orchestrator/sectors/_index.js";
import { THEME_IDS } from "../orchestrator/themes.js";

describe("buildSystemPrompt", () => {
  test("returns a non-empty string", () => {
    const prompt = buildSystemPrompt();
    assert.equal(typeof prompt, "string");
    assert.ok(prompt.length > 100);
    assert.ok(prompt.includes("JSON array"));
  });

  test("default call includes design brief + themes + catalog blocks", () => {
    const prompt = buildSystemPrompt();
    assert.ok(prompt.includes("BRIEF DESIGN"), "design brief mancante");
    assert.ok(prompt.includes("TEMI VISIVI DISPONIBILI"), "themes block mancante");
    assert.ok(prompt.includes("CATALOGO SETTORI"), "sectors catalog mancante");
    // dovrebbero esserci tutti i tema ids
    for (const t of THEME_IDS) assert.ok(prompt.includes(t), `tema ${t} mancante dal prompt`);
  });

  test("context.designBrief=false omits the brief", () => {
    const prompt = buildSystemPrompt({ designBrief: false });
    assert.ok(!prompt.includes("BRIEF DESIGN"));
  });

  test("context.themes=false and includeCatalog=false strip those blocks", () => {
    const prompt = buildSystemPrompt({ themes: false, includeCatalog: false });
    assert.ok(!prompt.includes("TEMI VISIVI DISPONIBILI"));
    assert.ok(!prompt.includes("CATALOGO SETTORI"));
  });

  test("with sector hint, prompt includes sector orientation block", () => {
    const prompt = buildSystemPrompt({ sector: SECTORS.ristorante });
    assert.ok(prompt.includes("ORIENTAMENTO SETTORE"), "blocco orientamento mancante");
    assert.ok(prompt.includes("ristorante"));
    assert.ok(prompt.includes("warm-amber"), "tema raccomandato mancante");
    assert.ok(prompt.includes("menu_items"), "nome entita' di riferimento mancante");
    // Importante: il prompt deve insistere che il riferimento NON e' vincolante
    assert.ok(/non.+vincolante/i.test(prompt) || /ignora.+riferimento/i.test(prompt),
      "il prompt deve dire chiaramente che il riferimento non e' vincolante");
  });
});

describe("pickThemeFromEntities", () => {
  test("returns the first valid theme found in entity metadata", () => {
    const entities = [
      { values: { metadata: {} } },
      { values: { metadata: { theme: "warm-amber" } } },
      { values: { metadata: { theme: "dark-electric" } } },
    ];
    assert.equal(pickThemeFromEntities(entities), "warm-amber");
  });

  test("returns fallback when no entity declares a theme", () => {
    const entities = [
      { values: { metadata: {} } },
      { values: { metadata: { icon: "Box" } } },
    ];
    assert.equal(pickThemeFromEntities(entities, "dark-cyan"), "dark-cyan");
    assert.equal(pickThemeFromEntities(entities), null);
  });

  test("ignores invalid theme ids", () => {
    const entities = [
      { values: { metadata: { theme: "not-a-real-theme" } } },
      { values: { metadata: { theme: "navy-trust" } } },
    ];
    assert.equal(pickThemeFromEntities(entities), "navy-trust");
  });

  test("safe with non-array input", () => {
    assert.equal(pickThemeFromEntities(null, "dark-electric"), "dark-electric");
    assert.equal(pickThemeFromEntities(undefined, "dark-electric"), "dark-electric");
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

  test("accepts metadata.theme when in THEME_IDS whitelist", () => {
    const result = validateEntityDef({
      name: "things",
      label: "Cose",
      metadata: { theme: "warm-amber", icon: "Box", primary: true },
    });
    assert.equal(result.ok, true);
    assert.equal(result.values.metadata.theme, "warm-amber");
    assert.equal(result.values.metadata.icon, "Box");
    assert.equal(result.values.metadata.primary, true);
  });

  test("rejects metadata.theme not in whitelist", () => {
    const result = validateEntityDef({
      name: "things",
      metadata: { theme: "neon-meme-2026" },
    });
    assert.equal(result.ok, false);
    assert.ok(result.error.includes("non è un tema valido"), `errore inatteso: ${result.error}`);
  });

  test("metadata.theme empty/null is tolerated (just skipped)", () => {
    const a = validateEntityDef({ name: "x", metadata: { theme: "" } });
    assert.equal(a.ok, true);
    const b = validateEntityDef({ name: "x", metadata: { theme: null } });
    assert.equal(b.ok, true);
  });
});
