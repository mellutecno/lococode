import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";
import { themeReplaceMap } from "./themePalettes.js";
import { isValidThemeId } from "./themes.js";

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../..");
const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";

const TEXT_EXTENSIONS = new Set([
  ".cjs", ".css", ".html", ".js", ".jsx", ".json", ".md", ".mjs",
  ".postcss", ".ts", ".tsx",
]);

function defaultPath(value, fallback) {
  return value ? path.resolve(value) : fallback;
}

export function safeTokenText(value, fallback = "") {
  return String(value ?? fallback)
    .replace(/[\r\n\t]+/g, " ")
    .replace(/"/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function pickPrimaryEntity(entities = []) {
  return (
    entities.find((e) => e?.metadata?.primary || e?.metadata?.isPrimary) ||
    entities[0] ||
    null
  );
}

function labelPlural(entity) {
  return safeTokenText(
    entity?.metadata?.labelPlural ||
    entity?.metadata?.pluralLabel ||
    entity?.metadata?.label_plural ||
    entity?.label ||
    entity?.name ||
    "Elementi"
  );
}

export function buildTemplateReplacements({ tenant, entities }) {
  const primary = pickPrimaryEntity(entities);
  const theme = isValidThemeId(tenant?.metadata?.theme)
    ? tenant.metadata.theme
    : "dark-electric";

  if (!primary) {
    throw new Error("Nessuna tabella dati disponibile: genera prima lo schema.");
  }

  return {
    APP_NAME: safeTokenText(tenant.name, "App MelluCode"),
    APP_SUBTITLE: safeTokenText(
      tenant.metadata?.subtitle ||
      `Gestisci ${labelPlural(primary)} da un unico pannello.`,
      "Applicazione generata con MelluCode."
    ),
    TENANT_SLUG: safeTokenText(tenant.slug),
    BASE_PATH: `/apps/${safeTokenText(tenant.slug)}/`,
    PRIMARY_ENTITY_NAME: safeTokenText(primary.name),
    PRIMARY_ENTITY_LABEL: safeTokenText(primary.label || primary.name),
    PRIMARY_ENTITY_LABEL_PLURAL: labelPlural(primary),
    ...themeReplaceMap(theme),
  };
}

export function applyTemplateTokens(content, replacements) {
  let out = String(content);
  for (const [key, value] of Object.entries(replacements)) {
    out = out.replaceAll(`__${key}__`, String(value));
  }
  return out;
}

function isTextFile(file) {
  return TEXT_EXTENSIONS.has(path.extname(file).toLowerCase());
}

async function replaceTokensInTree(dir, replacements, sdkDir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      await replaceTokensInTree(full, replacements, sdkDir);
      continue;
    }
    if (!entry.isFile() || !isTextFile(full)) continue;

    let content = await fs.readFile(full, "utf8");
    content = applyTemplateTokens(content, replacements);
    if (entry.name === "package.json") {
      content = content.replaceAll("file:../../sdk", `file:${sdkDir.replaceAll("\\", "/")}`);
    }
    await fs.writeFile(full, content, "utf8");
  }
}

async function copyTemplate(templateDir, workDir) {
  await fs.cp(templateDir, workDir, {
    recursive: true,
    filter: (src) => {
      const name = path.basename(src);
      return name !== "node_modules" && name !== "dist";
    },
  });
}

async function runNpm(args, cwd, timeoutMs) {
  try {
    const res = await execFileAsync(npmBin, args, {
      cwd,
      shell: process.platform === "win32",
      timeout: timeoutMs,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
    });
    return `${res.stdout || ""}${res.stderr || ""}`.trim();
  } catch (err) {
    const output = `${err.stdout || ""}${err.stderr || ""}`.trim();
    const message = output ? `${err.message}\n${output}` : err.message;
    throw new Error(message.slice(0, 4000));
  }
}

function assertInside(parent, child) {
  const rel = path.relative(parent, child);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("Percorso generato fuori dalla cartella consentita.");
  }
}

export async function deleteGeneratedFrontend(slug) {
  if (!slug) return;
  const publishDir = defaultPath(config.generatedApps.publishDir, path.join(repoRoot, "apps"));
  const target = path.resolve(publishDir, slug);
  assertInside(publishDir, target);
  await fs.rm(target, { recursive: true, force: true });
}

export async function buildGeneratedFrontend({ tenant, entities }) {
  const templateDir = defaultPath(
    config.generatedApps.templateDir,
    path.join(repoRoot, "platform", "templates", "_base")
  );
  const publishDir = defaultPath(
    config.generatedApps.publishDir,
    path.join(repoRoot, "apps")
  );
  const buildRoot = defaultPath(
    config.generatedApps.buildRoot,
    path.join(os.tmpdir(), "mellucode-frontend-builds")
  );
  const sdkDir = defaultPath(
    config.generatedApps.sdkDir,
    path.join(repoRoot, "platform", "sdk")
  );
  const timeoutMs = Number(config.generatedApps.buildTimeoutMs || 600000);

  const slug = safeTokenText(tenant.slug);
  if (!slug) throw new Error("Slug app non valido.");

  const theme = isValidThemeId(tenant?.metadata?.theme)
    ? tenant.metadata.theme
    : "dark-electric";
  const replacements = buildTemplateReplacements({ tenant, entities });
  const buildId = `${slug}-${Date.now()}`;
  const workDir = path.join(buildRoot, buildId);
  const targetDir = path.resolve(publishDir, slug);
  assertInside(publishDir, targetDir);

  const started = Date.now();
  await fs.mkdir(buildRoot, { recursive: true });
  await fs.rm(workDir, { recursive: true, force: true });

  try {
    await copyTemplate(templateDir, workDir);
    await replaceTokensInTree(workDir, replacements, sdkDir);
    await runNpm(["install", "--silent", "--no-audit", "--no-fund"], workDir, timeoutMs);
    await runNpm(["run", "build"], workDir, timeoutMs);

    const distDir = path.join(workDir, "dist");
    await fs.rm(targetDir, { recursive: true, force: true });
    await fs.mkdir(path.dirname(targetDir), { recursive: true });
    await fs.cp(distDir, targetDir, { recursive: true });

    return {
      url: `/apps/${slug}/`,
      slug,
      theme,
      primaryEntity: replacements.PRIMARY_ENTITY_NAME,
      buildMs: Date.now() - started,
    };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
