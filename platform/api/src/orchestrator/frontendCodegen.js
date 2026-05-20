import { promises as fs } from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { callOpenRouterChat } from "../utils/openRouterClient.js";
import { logOrchestratorSuccess, logOrchestratorFailure } from "../utils/aiUsageLogger.js";

export const ALLOWED_CODEGEN_FILES = Object.freeze([
  "src/generated/GeneratedHome.jsx",
  "src/generated/generated.css",
]);

const REQUIRED_HOME_FILE = "src/generated/GeneratedHome.jsx";
const CSS_FILE = "src/generated/generated.css";
const MAX_FILE_CHARS = 24000;

const FALLBACK_HOME = `import "./generated.css";
import HomePage from "../pages/HomePage.jsx";

export default function GeneratedHome() {
  return <HomePage />;
}
`;

const FALLBACK_ENTITY_LIST = `import EntityListPage from "../pages/EntityListPage.jsx";

export default function GeneratedEntityList() {
  return <EntityListPage />;
}
`;

const FALLBACK_CSS = "/* MelluCode generated styles */\n";

function isObj(v) {
  return v && typeof v === "object" && !Array.isArray(v);
}

function stripFence(text = "") {
  const trimmed = String(text || "").trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  return fence ? fence[1].trim() : trimmed;
}

export function parseCodegenReply(reply) {
  const text = stripFence(reply);
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    const match = text.match(/(\{[\s\S]*\})/);
    if (!match) return null;
    try {
      parsed = JSON.parse(match[1]);
    } catch {
      return null;
    }
  }

  if (!isObj(parsed)) return null;
  const source = parsed.files ?? parsed;
  const files = {};

  if (Array.isArray(source)) {
    for (const item of source) {
      if (!isObj(item) || typeof item.path !== "string" || typeof item.content !== "string") return null;
      files[item.path] = item.content;
    }
    return files;
  }

  if (isObj(source)) {
    for (const [filePath, content] of Object.entries(source)) {
      if (typeof content !== "string") return null;
      files[filePath] = content;
    }
    return files;
  }

  return null;
}

const DISALLOWED_JS = [
  "dangerouslySetInnerHTML",
  "eval(",
  "new Function",
  "document.cookie",
  "localStorage",
  "sessionStorage",
  "window.location",
  "XMLHttpRequest",
  "fetch(",
  "import.meta",
  "import(",
  "process.",
  "require(",
  "child_process",
  "node:",
  "fs/promises",
  "http://",
  "https://",
];

const ALLOWED_BARE_IMPORTS = new Set([
  "react",
  "react-router-dom",
  "lucide-react",
]);

const ALLOWED_RELATIVE_IMPORTS = new Set([
  "./generated.css",
  "../lib/api.js",
  "../pages/EntityListPage.jsx",
  "../components/Avatar.jsx",
  "../components/StatusPill.jsx",
  "../components/Skeleton.jsx",
  "../components/EmptyState.jsx",
  "../components/FieldRenderer.jsx",
  "../lib/entityIntrospect.js",
]);

function validateImports(content) {
  const importRe = /from\s+["']([^"']+)["']/g;
  const sideEffectImportRe = /import\s+["']([^"']+)["']/g;
  function checkSpec(spec) {
    if (spec.startsWith("../") || spec.startsWith("./")) {
      return ALLOWED_RELATIVE_IMPORTS.has(spec) ? null : `Import relativo non consentito: ${spec}`;
    }
    if (ALLOWED_BARE_IMPORTS.has(spec)) return null;
    return `Import non consentito: ${spec}`;
  }

  let match;
  while ((match = importRe.exec(content))) {
    const error = checkSpec(match[1]);
    if (error) return error;
  }
  while ((match = sideEffectImportRe.exec(content))) {
    const error = checkSpec(match[1]);
    if (error) return error;
  }
  return null;
}

export function validateGeneratedFiles(files) {
  if (!isObj(files)) return { ok: false, error: "Risposta codegen non valida." };

  const allowed = new Set(ALLOWED_CODEGEN_FILES);
  const normalized = {};
  for (const [rawPath, rawContent] of Object.entries(files)) {
    const rel = String(rawPath || "").replaceAll("\\", "/").replace(/^\/+/, "");
    if (!allowed.has(rel)) {
      return { ok: false, error: `File non consentito: ${rawPath}` };
    }
    if (typeof rawContent !== "string" || rawContent.trim().length === 0) {
      return { ok: false, error: `Contenuto vuoto per ${rel}` };
    }
    if (rawContent.length > MAX_FILE_CHARS) {
      return { ok: false, error: `File troppo grande: ${rel}` };
    }
    normalized[rel] = rawContent;
  }

  if (!normalized[REQUIRED_HOME_FILE]) {
    return { ok: false, error: `Manca ${REQUIRED_HOME_FILE}` };
  }
  if (!normalized[CSS_FILE]) {
    normalized[CSS_FILE] = "/* MelluCode generated styles */\n";
  }

  const home = normalized[REQUIRED_HOME_FILE];
  if (!/export\s+default/.test(home)) {
    return { ok: false, error: "GeneratedHome.jsx deve esportare un default React component." };
  }
  const bad = DISALLOWED_JS.find((needle) => home.includes(needle));
  if (bad) return { ok: false, error: `Uso non consentito in GeneratedHome.jsx: ${bad}` };

  const importError = validateImports(home);
  if (importError) return { ok: false, error: importError };

  const css = normalized[CSS_FILE];
  if (/@import|url\s*\(\s*["']?https?:/i.test(css)) {
    return { ok: false, error: "generated.css non puo' importare risorse esterne." };
  }

  return { ok: true, files: normalized };
}

function summarizeEntities(entities = []) {
  return entities.map((e) => ({
    name: e.name,
    label: e.label,
    metadata: e.metadata || {},
    fields: Object.entries(e.jsonSchema?.properties || {}).map(([name, def]) => ({
      name,
      title: def?.title || null,
      type: def?.type || "string",
      format: def?.format || null,
      enum: Array.isArray(def?.enum) ? def.enum : null,
      required: (e.jsonSchema?.required || []).includes(name),
    })).slice(0, 18),
  }));
}

function buildCodegenPrompt({ tenant, entities, replacements, previousError = null }) {
  const entitySummary = summarizeEntities(entities);
  return `Sei MelluCode Frontend Codegen. Devi generare SOLO il file per
personalizzare la HOME/dashboard di una web app gia' funzionante.
La lista dati e le pagine CRUD sono gia' gestite dal template: tu devi solo
fare la dashboard/hero di primo impatto.

APP:
- nome: ${tenant.name}
- richiesta utente originale: ${tenant.metadata?.initialPrompt || "non disponibile"}
- settore inferito: ${tenant.metadata?.sector || "non definito"}
- tema: ${tenant.metadata?.theme || "non definito"}
- layout base scelto: ${replacements.APP_LAYOUT}
- entita' disponibili:
${JSON.stringify(entitySummary, null, 2)}

CONTESTO TECNICO:
- Il file da generare e' src/generated/GeneratedHome.jsx.
- Puoi importare SOLO:
  - react
  - react-router-dom
  - lucide-react
  - "../lib/api.js"
  - "../pages/EntityListPage.jsx"
  - "../components/Avatar.jsx"
  - "../components/StatusPill.jsx"
  - "../components/Skeleton.jsx"
  - "../components/EmptyState.jsx"
  - "../components/FieldRenderer.jsx"
  - "../lib/entityIntrospect.js"
- Da "../lib/api.js" puoi usare: APP_NAME, APP_SUBTITLE, APP_LAYOUT, mc,
  entityRoute, entityNewRoute, recordRoute, statusTone.
- In GeneratedHome puoi caricare dati sintetici con mc.entities.list() e
  mc.data(entity.name).list({limit: 6}).
- Mantieni tutte le sezioni collegate: ogni card/CTA deve linkare a
  entityRoute(entity.name) o entityNewRoute(entity.name).

OBIETTIVO UI:
- Deve sembrare una dashboard/landing interna premium e specifica per dominio,
  NON una tabella generica.
- Testo sempre leggibile, contrasto forte, niente testo scuro su sfondo scuro.
- Hero forte, statistiche utili, card per sezioni principali, CTA chiare.
- Mobile responsive.
- Niente chiamate esterne, niente immagini esterne, niente SVG enormi.
- Usa lucide-react per icone, Tailwind e al massimo generated.css.

REGOLE DI SICUREZZA:
- Non usare dangerouslySetInnerHTML, eval, localStorage, sessionStorage,
  window.location, fetch diretto, URL esterni, import non consentiti.
- Non modificare auth o routing globale.

${previousError ? `ERRORE BUILD PRECEDENTE DA CORREGGERE:\n${String(previousError).slice(0, 3000)}\n` : ""}

Rispondi SOLO con JSON puro, nessun markdown:
{
  "files": {
    "src/generated/GeneratedHome.jsx": "contenuto completo del file",
    "src/generated/generated.css": "contenuto CSS opzionale"
  }
}`;
}

export async function writeGeneratedFiles(workDir, files) {
  for (const [rel, content] of Object.entries(files)) {
    const target = path.resolve(workDir, rel);
    const relToRoot = path.relative(workDir, target);
    if (relToRoot.startsWith("..") || path.isAbsolute(relToRoot)) {
      throw new Error(`Percorso codegen fuori build dir: ${rel}`);
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, "utf8");
  }
}

export async function generateFrontendCodeWithRetry({
  tenant,
  entities,
  replacements,
  workDir,
  buildOnce,
  logger = console,
}) {
  if (!config.generatedApps.codegenEnabled) {
    await buildOnce();
    return { enabled: false, used: false, attempts: 0 };
  }

  const attempts = Math.max(1, Math.min(4, Number(config.generatedApps.codegenRetries || 2)));
  const model = config.generatedApps.codegenModel || config.orchestrator.model;
  let previousError = null;
  let lastValidationError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const messages = [
      {
        role: "system",
        content: "Sei un senior frontend engineer. Produci JSON valido con file React che compilano al primo colpo.",
      },
      {
        role: "user",
        content: buildCodegenPrompt({ tenant, entities, replacements, previousError }),
      },
    ];

    let ai;
    try {
      ai = await callOpenRouterChat({
        messages,
        model,
        maxTokens: config.generatedApps.codegenMaxTokens,
        temperature: attempt === 1 ? 0.35 : 0.15,
        metadata: { feature: "frontend-codegen", tenantId: tenant.id, attempt },
        user: tenant.ownerUserId,
        timeoutMs: config.generatedApps.codegenTimeoutMs,
      });
      await logOrchestratorSuccess({
        tenantId: tenant.id,
        feature: "frontend-codegen",
        model,
        messages,
        ai,
        requestMetadata: { attempt, layout: replacements.APP_LAYOUT },
      });
    } catch (e) {
      await logOrchestratorFailure({
        tenantId: tenant.id,
        feature: "frontend-codegen",
        model,
        err: e,
        requestMetadata: { attempt, layout: replacements.APP_LAYOUT },
      });
      if (e?.code === "OPENROUTER_TIMEOUT" && attempt < attempts) {
        previousError = `La chiamata AI precedente e' andata in timeout dopo ${Math.round((e.timeoutMs || 0) / 1000)} secondi. Riprova generando file piu' compatti e JSON valido.`;
        logger?.warn?.({ tenantId: tenant.id, attempt, err: e }, "frontend codegen timed out; retrying");
        continue;
      }
      throw e;
    }

    const parsed = parseCodegenReply(ai.reply);
    const validated = validateGeneratedFiles(parsed);
    if (!validated.ok) {
      lastValidationError = validated.error;
      previousError = `Validazione file fallita: ${validated.error}`;
      logger?.warn?.({ tenantId: tenant.id, attempt, error: validated.error }, "frontend codegen validation failed");
      continue;
    }

    await writeGeneratedFiles(workDir, validated.files);
    try {
      await buildOnce();
      return { enabled: true, used: true, attempts: attempt, files: Object.keys(validated.files) };
    } catch (e) {
      previousError = e?.message || String(e);
      logger?.warn?.({ tenantId: tenant.id, attempt, err: e }, "frontend codegen build failed; retrying");
    }
  }

  // Fallback graceful: ripristina i file originali del template e builda.
  // L'utente ottiene comunque un'app funzionante con il template premium.
  await writeGeneratedFiles(workDir, {
    [REQUIRED_HOME_FILE]: FALLBACK_HOME,
    [CSS_FILE]: FALLBACK_CSS,
    "src/generated/GeneratedEntityList.jsx": FALLBACK_ENTITY_LIST,
  });
  await buildOnce();
  return {
    enabled: true,
    used: false,
    attempts,
    error: previousError || lastValidationError || "Codegen fallito, usato fallback template.",
  };
}
