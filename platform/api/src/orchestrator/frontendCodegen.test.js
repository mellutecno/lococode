import assert from "node:assert/strict";
import { test } from "node:test";

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://noop";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-must-be-at-least-32-characters-long";

const {
  parseCodegenReply,
  validateGeneratedFiles,
} = await import("./frontendCodegen.js");

test("parseCodegenReply legge JSON con files object", () => {
  const parsed = parseCodegenReply(JSON.stringify({
    files: {
      "src/generated/GeneratedHome.jsx": "export default function GeneratedHome(){ return null; }",
      "src/generated/generated.css": ".x{}",
    },
  }));
  assert.equal(parsed["src/generated/generated.css"], ".x{}");
});

test("parseCodegenReply legge JSON dentro markdown fence", () => {
  const parsed = parseCodegenReply(`\`\`\`json
{"files":[{"path":"src/generated/GeneratedHome.jsx","content":"export default function GeneratedHome(){ return null; }"}]}
\`\`\``);
  assert.ok(parsed["src/generated/GeneratedHome.jsx"].includes("GeneratedHome"));
});

test("validateGeneratedFiles accetta solo file consentiti e aggiunge css fallback", () => {
  const result = validateGeneratedFiles({
    "src/generated/GeneratedHome.jsx": `
      import { Link } from "react-router-dom";
      import { APP_NAME } from "../lib/api.js";
      export default function GeneratedHome(){ return <Link to="/">{APP_NAME}</Link>; }
    `,
    "src/generated/GeneratedEntityList.jsx": `
      import EntityListPage from "../pages/EntityListPage.jsx";
      export default function GeneratedEntityList(){ return <EntityListPage />; }
    `,
  });
  assert.equal(result.ok, true);
  assert.ok(result.files["src/generated/generated.css"]);
});

test("validateGeneratedFiles rifiuta import esterni e API pericolose", () => {
  assert.equal(validateGeneratedFiles({
    "src/generated/GeneratedHome.jsx": `import axios from "axios"; export default function X(){return null;}`,
  }).ok, false);

  assert.equal(validateGeneratedFiles({
    "src/generated/GeneratedHome.jsx": `import "axios"; export default function X(){return null;}`,
  }).ok, false);

  assert.equal(validateGeneratedFiles({
    "src/generated/GeneratedHome.jsx": `import helper from "../lib/secret.js"; export default function X(){return null;}`,
  }).ok, false);

  assert.equal(validateGeneratedFiles({
    "src/generated/GeneratedHome.jsx": `export default function X(){ eval("alert(1)"); return null;}`,
  }).ok, false);

  assert.equal(validateGeneratedFiles({
    "src/generated/GeneratedHome.jsx": `export default function X(){ return null; }`,
    "src/generated/GeneratedEntityList.jsx": `export default function Y(){ fetch("/x"); return null; }`,
  }).ok, false);
});
