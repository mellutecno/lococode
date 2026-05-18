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

// ---- Nuove capacita' Ajv (format, pattern, enum, min/max, nested) ----

test("Ajv format=email is enforced", () => {
  const entity = { jsonSchema: { properties: { contact: { type: "string", format: "email" } } } };
  assert.match(validateRecordData(entity, { contact: "not-an-email" }), /contact non e' un valore valido \(email\)/);
  assert.equal(validateRecordData(entity, { contact: "ok@test.it" }), null);
});

test("Ajv format=uri is enforced", () => {
  const entity = { jsonSchema: { properties: { homepage: { type: "string", format: "uri" } } } };
  assert.match(validateRecordData(entity, { homepage: "not a url" }), /homepage non e' un valore valido \(uri\)/);
  assert.equal(validateRecordData(entity, { homepage: "https://mellucode.mellutecno.it" }), null);
});

test("Ajv format=uuid is enforced", () => {
  // Uso "external_id" perche' "id" e' system field e viene strippato.
  const entity = { jsonSchema: { properties: { external_id: { type: "string", format: "uuid" } } } };
  assert.match(validateRecordData(entity, { external_id: "abc" }), /external_id non e' un valore valido \(uuid\)/);
  assert.equal(validateRecordData(entity, { external_id: "00000000-0000-4000-8000-000000000000" }), null);
});

test("validateRecordData strips system fields from data and schema (defense)", () => {
  // Anche se l'AI sbaglia e mette "id" nel jsonSchema come required, il
  // sistema lo strippa: il record viene accettato anche se il client non
  // manda "id" (verra' generato server-side come UUID).
  const entity = {
    jsonSchema: {
      properties: {
        id: { type: "string", format: "uuid" },
        name: { type: "string" },
      },
      required: ["id", "name"],
    },
  };
  // Senza "id" -> deve PASSARE perche' system fields strippati
  assert.equal(validateRecordData(entity, { name: "Mario" }), null);
  // Con "id" sporco -> stesso esito (id strippato da data)
  assert.equal(validateRecordData(entity, { id: "not-uuid-junk", name: "Mario" }), null);
  // Required vero (name) rispettato
  assert.match(validateRecordData(entity, { id: "x" }), /Campo obbligatorio mancante: name/);
});

test("Ajv pattern enforces regex", () => {
  const entity = { jsonSchema: { properties: { code: { type: "string", pattern: "^[A-Z]{3}-\\d{4}$" } } } };
  assert.match(validateRecordData(entity, { code: "lower-1234" }), /code non rispetta il formato richiesto/);
  assert.equal(validateRecordData(entity, { code: "ABC-1234" }), null);
});

test("Ajv enum constrains to allowed values", () => {
  const entity = { jsonSchema: { properties: { status: { type: "string", enum: ["draft", "published", "archived"] } } } };
  const err = validateRecordData(entity, { status: "deleted" });
  assert.match(err, /status deve essere uno tra: draft, published, archived/);
  assert.equal(validateRecordData(entity, { status: "draft" }), null);
});

test("Ajv minimum/maximum/exclusiveMinimum on numbers", () => {
  const entity = { jsonSchema: { properties: { age: { type: "integer", minimum: 0, maximum: 120 } } } };
  assert.match(validateRecordData(entity, { age: -1 }), /age deve essere >= 0/);
  assert.match(validateRecordData(entity, { age: 121 }), /age deve essere <= 120/);
  assert.equal(validateRecordData(entity, { age: 30 }), null);

  const positive = { jsonSchema: { properties: { qty: { type: "integer", exclusiveMinimum: 0 } } } };
  assert.match(validateRecordData(positive, { qty: 0 }), /qty deve essere > 0/);
  assert.equal(validateRecordData(positive, { qty: 1 }), null);
});

test("Ajv minLength constraint", () => {
  const entity = { jsonSchema: { properties: { name: { type: "string", minLength: 3 } } } };
  assert.match(validateRecordData(entity, { name: "ab" }), /name e' troppo corto/);
  assert.equal(validateRecordData(entity, { name: "abc" }), null);
});

test("Ajv minItems/maxItems/uniqueItems on arrays", () => {
  const entity = {
    jsonSchema: {
      properties: {
        tags: { type: "array", minItems: 1, maxItems: 3, uniqueItems: true, items: { type: "string" } },
      },
    },
  };
  assert.match(validateRecordData(entity, { tags: [] }), /tags deve avere almeno 1/);
  assert.match(validateRecordData(entity, { tags: ["a", "b", "c", "d"] }), /tags puo' avere al massimo 3/);
  assert.match(validateRecordData(entity, { tags: ["a", "a"] }), /tags non puo' contenere duplicati/);
  assert.equal(validateRecordData(entity, { tags: ["a", "b"] }), null);
});

test("Ajv nested object validation reports the nested path", () => {
  const entity = {
    jsonSchema: {
      properties: {
        address: {
          type: "object",
          properties: {
            zip: { type: "string", pattern: "^\\d{5}$" },
          },
          required: ["zip"],
        },
      },
    },
  };
  assert.match(validateRecordData(entity, { address: {} }), /Campo obbligatorio mancante: zip/);
  assert.match(validateRecordData(entity, { address: { zip: "abc" } }), /address\.zip non rispetta il formato richiesto/);
  assert.equal(validateRecordData(entity, { address: { zip: "20100" } }), null);
});

test("malformed entity schema returns a friendly error instead of crashing", () => {
  // type sconosciuto -> Ajv lancia in compile, noi lo intercettiamo
  const broken = { jsonSchema: { properties: { x: { type: "telepathy" } } } };
  const out = validateRecordData(broken, { x: "anything" });
  assert.match(out, /Schema entita' non valido/);
});
