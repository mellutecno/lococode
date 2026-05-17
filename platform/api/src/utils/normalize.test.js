import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeEmail, slugify, normalizeKey } from "./normalize.js";

test("normalizeEmail trims, lowercases, validates basic shape", () => {
  assert.equal(normalizeEmail("  Foo@Bar.IT "), "foo@bar.it");
  assert.equal(normalizeEmail("admin@admin.it"), "admin@admin.it");
});

test("normalizeEmail rejects invalid input", () => {
  assert.equal(normalizeEmail(""), "");
  assert.equal(normalizeEmail(null), "");
  assert.equal(normalizeEmail(undefined), "");
  assert.equal(normalizeEmail("not-an-email"), "");
  assert.equal(normalizeEmail("a@b"), "");
  assert.equal(normalizeEmail("a @b.c"), "");
  assert.equal(normalizeEmail("@b.c"), "");
});

test("slugify produces url-safe lowercase slug", () => {
  assert.equal(slugify("Pizzeria Da Mario"), "pizzeria-da-mario");
  assert.equal(slugify("  Hello   World  "), "hello-world");
  assert.equal(slugify("Cafè Però"), "cafe-pero");
  assert.equal(slugify("foo_bar.baz!"), "foo-bar-baz");
});

test("slugify trims leading/trailing dashes and caps at 80 chars", () => {
  assert.equal(slugify("---abc---"), "abc");
  const long = "x".repeat(120);
  assert.equal(slugify(long).length, 80);
});

test("slugify handles empty/falsy input", () => {
  assert.equal(slugify(""), "");
  assert.equal(slugify(null), "");
  assert.equal(slugify(undefined), "");
  assert.equal(slugify("!!!"), "");
});

test("normalizeKey allows underscores, strips other punctuation", () => {
  assert.equal(normalizeKey("My Field"), "my_field");
  assert.equal(normalizeKey("FOO_BAR"), "foo_bar");
  assert.equal(normalizeKey("a-b-c"), "a_b_c");
  assert.equal(normalizeKey("___trim___"), "trim");
  assert.equal(normalizeKey(""), "");
});
