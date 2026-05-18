import assert from "node:assert/strict";
import { test } from "node:test";

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://noop";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-must-be-at-least-32-characters-long";

const {
  applyTemplateTokens,
  buildTemplateReplacements,
  pickPrimaryEntity,
} = await import("./frontendBuilder.js");

test("pickPrimaryEntity preferisce l'entita marcata primary", () => {
  const entities = [
    { name: "members", label: "Membri", metadata: {} },
    { name: "appointments", label: "Appuntamenti", metadata: { primary: true } },
  ];
  assert.equal(pickPrimaryEntity(entities).name, "appointments");
});

test("buildTemplateReplacements prepara path, tema e label principali", () => {
  const replacements = buildTemplateReplacements({
    tenant: {
      name: "Studio Mellucci",
      slug: "studio-mellucci",
      metadata: { theme: "navy-trust" },
    },
    entities: [
      {
        name: "patients",
        label: "Paziente",
        metadata: { labelPlural: "Pazienti" },
      },
    ],
  });

  assert.equal(replacements.APP_NAME, "Studio Mellucci");
  assert.equal(replacements.BASE_PATH, "/apps/studio-mellucci/");
  assert.equal(replacements.PRIMARY_ENTITY_NAME, "patients");
  assert.equal(replacements.PRIMARY_ENTITY_LABEL_PLURAL, "Pazienti");
  assert.equal(replacements.THEME_BASE, "light");
  assert.ok(replacements.THEME_ACCENT_500);
});

test("applyTemplateTokens sostituisce i token del template", () => {
  const out = applyTemplateTokens(
    "__APP_NAME__ gira sotto __BASE_PATH__ con __THEME_BASE__",
    { APP_NAME: "Mellu", BASE_PATH: "/apps/mellu/", THEME_BASE: "dark" }
  );
  assert.equal(out, "Mellu gira sotto /apps/mellu/ con dark");
});
