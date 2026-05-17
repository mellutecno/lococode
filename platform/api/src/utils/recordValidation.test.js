import { test } from "node:test";
import assert from "node:assert/strict";
import { isPlainObject, validateRecordData } from "./recordValidation.js";

const productEntity = {
  jsonSchema: {
    properties: {
      name: { type: "string", maxLength: 60 },
      price: { type: "number" },
      qty: { type: "integer" },
      active: { type: "boolean" },
      tags: { type: "array" },
      meta: { type: "object" },
    },
    required: ["name", "price"],
  },
};

test("isPlainObject distinguishes objects from arrays/null/primitives", () => {
  assert.equal(isPlainObject({}), true);
  assert.equal(isPlainObject({ a: 1 }), true);
  assert.equal(isPlainObject([]), false);
  assert.equal(isPlainObject(null), false);
  assert.equal(isPlainObject(undefined), false);
  assert.equal(isPlainObject("foo"), false);
  assert.equal(isPlainObject(42), false);
});

test("validateRecordData rejects non-object payload", () => {
  assert.match(validateRecordData(productEntity, "nope"), /oggetto JSON/);
  assert.match(validateRecordData(productEntity, null), /oggetto JSON/);
  assert.match(validateRecordData(productEntity, []), /oggetto JSON/);
});

test("validateRecordData rejects missing required fields (and treats '' as missing)", () => {
  assert.match(
    validateRecordData(productEntity, { name: "x" }),
    /Campo obbligatorio mancante: price/
  );
  assert.match(
    validateRecordData(productEntity, { name: "", price: 1 }),
    /Campo obbligatorio mancante: name/
  );
  assert.match(
    validateRecordData(productEntity, { name: "x", price: null }),
    /Campo obbligatorio mancante: price/
  );
});

test("validateRecordData accepts well-formed payload", () => {
  assert.equal(
    validateRecordData(productEntity, { name: "Pizza", price: 8.5 }),
    null
  );
  assert.equal(
    validateRecordData(productEntity, {
      name: "Pizza",
      price: 8.5,
      qty: 3,
      active: true,
      tags: ["food"],
      meta: { vegan: false },
    }),
    null
  );
});

test("validateRecordData enforces field types", () => {
  assert.match(validateRecordData(productEntity, { name: 123, price: 1 }), /name deve essere testo/);
  assert.match(validateRecordData(productEntity, { name: "x", price: "free" }), /price deve essere numerico/);
  assert.match(validateRecordData(productEntity, { name: "x", price: 1, qty: 1.5 }), /qty deve essere intero/);
  assert.match(validateRecordData(productEntity, { name: "x", price: 1, active: "yes" }), /active deve essere vero\/falso/);
  assert.match(validateRecordData(productEntity, { name: "x", price: 1, tags: "food" }), /tags deve essere una lista/);
  assert.match(validateRecordData(productEntity, { name: "x", price: 1, meta: [] }), /meta deve essere un oggetto/);
});

test("validateRecordData enforces maxLength on strings", () => {
  assert.match(
    validateRecordData(productEntity, { name: "x".repeat(61), price: 1 }),
    /name supera la lunghezza massima/
  );
});

test("validateRecordData rejects unknown fields when additionalProperties=false", () => {
  const strict = {
    jsonSchema: {
      properties: { a: { type: "string" } },
      additionalProperties: false,
    },
  };
  assert.match(validateRecordData(strict, { a: "ok", surprise: 1 }), /Campo non previsto: surprise/);
  assert.equal(validateRecordData(strict, { a: "ok" }), null);
});

test("validateRecordData ignores null/undefined values for non-required typed fields", () => {
  assert.equal(validateRecordData(productEntity, { name: "x", price: 1, qty: null }), null);
  assert.equal(validateRecordData(productEntity, { name: "x", price: 1, qty: undefined }), null);
});

test("validateRecordData treats missing schema as fully permissive", () => {
  assert.equal(validateRecordData({}, { whatever: 1 }), null);
  assert.equal(validateRecordData({ jsonSchema: {} }, { whatever: 1 }), null);
});
