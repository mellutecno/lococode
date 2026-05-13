import express from "express";
import react from "@vitejs/plugin-react";
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import nodemailer from "nodemailer";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { build as viteBuild } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const execFileAsync = promisify(execFile);
const rootDir = path.resolve(__dirname, "..");
const repoDir = path.resolve(rootDir, "..");
const dataDir = path.join(rootDir, "data");
const projectsDir = path.join(dataDir, "projects");
const usersDir = path.join(dataDir, "users");
const appsPath = path.join(dataDir, "apps.json");
const configPath = path.join(dataDir, "config.json");
const legacyConfigPath = path.join(repoDir, "user_data", "config.json");

await loadEnvFile(path.join(rootDir, ".env"));

const port = Number(process.env.LOCOCODE_API_PORT || 8787);
const openRouterTimeoutMs = Number(process.env.OPENROUTER_TIMEOUT_MS || 10 * 60 * 1000);
const usersPath = path.join(dataDir, "users.json");
const authSecret = process.env.LOCOCODE_AUTH_SECRET || "lococode-local-auth-secret";
const loginTokenTtlMs = Number(process.env.LOCOCODE_LOGIN_TOKEN_TTL_MS || 24 * 60 * 60 * 1000);
const sessionTtlMs = Number(process.env.LOCOCODE_SESSION_TTL_MS || 30 * 24 * 60 * 60 * 1000);
const heartbeatTimeoutMs = Number(process.env.LOCOCODE_HEARTBEAT_TIMEOUT_MS || 2 * 60 * 1000);
const publicBaseUrl = String(process.env.LOCOCODE_PUBLIC_URL || "https://lococode.mellutecno.it").replace(/\/$/, "");
const runningJobs = new Map();
const frontendBuilds = new Map();

const commonModels = [
  "deepseek/deepseek-v4-pro",
  "moonshotai/kimi-k2.6",
];

const app = express();
app.use((req, res, next) => {
  const allowedOrigin = process.env.LOCOCODE_ALLOWED_ORIGIN || req.headers.origin || "*";
  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});
app.use(express.json({ limit: "12mb" }));

await fs.mkdir(dataDir, { recursive: true });
await fs.mkdir(projectsDir, { recursive: true });
await fs.mkdir(usersDir, { recursive: true });

async function loadEnvFile(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const separator = trimmed.indexOf("=");
      if (separator <= 0) continue;

      const key = trimmed.slice(0, separator).trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || process.env[key] !== undefined) continue;

      process.env[key] = parseEnvValue(trimmed.slice(separator + 1).trim());
    }
  } catch (err) {
    if (!err || err.code !== "ENOENT") {
      console.warn(`Non riesco a leggere ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

function parseEnvValue(value) {
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, mode: "web-sdd-orchestrator" });
});

app.get("/api/models", (_req, res) => {
  res.json({ models: commonModels });
});

app.get("/api/auth/session", async (req, res) => {
  const user = await getSessionUser(req);
  if (!user) {
    res.status(401).json({ authenticated: false });
    return;
  }

  res.json({ authenticated: true, user: publicUser(user) });
});

app.post("/api/auth/request-token", async (req, res) => {
  const email = normalizeEmail(req.body.email);
  if (!email) {
    res.status(400).json({ error: "Inserisci un indirizzo email valido." });
    return;
  }

  const store = await loadUsersStore();
  const user = findOrCreateUser(store, email);
  const token = generateLoginToken();
  const now = new Date().toISOString();
  user.pendingTokenHash = hashSecret(token);
  user.pendingTokenExpiresAt = new Date(Date.now() + loginTokenTtlMs).toISOString();
  user.pendingTokenSentAt = now;
  user.updatedAt = now;
  await saveUsersStore(store);

  try {
    const delivery = await sendLoginTokenEmail(email, token);
    res.json({
      ok: true,
      email,
      sent: delivery.sent,
      message: delivery.sent
        ? "Token inviato. Controlla la posta e inseriscilo qui."
        : "Token creato, ma SMTP non configurato sul server.",
      ...(process.env.LOCOCODE_DEBUG_AUTH_TOKEN === "1" ? { debugToken: token } : {}),
    });
  } catch (err) {
    res.status(502).json({
      error: `Non sono riuscito a inviare il token: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
});

app.post("/api/auth/verify-token", async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const token = String(req.body.token || "").trim();

  if (!email || !token) {
    res.status(400).json({ error: "Email e token sono obbligatori." });
    return;
  }

  const store = await loadUsersStore();
  const user = store.users.find((item) => item.email === email);
  if (!user || !user.pendingTokenHash || user.pendingTokenHash !== hashSecret(token)) {
    res.status(401).json({ error: "Token non valido." });
    return;
  }

  if (!user.pendingTokenExpiresAt || new Date(user.pendingTokenExpiresAt).getTime() < Date.now()) {
    res.status(401).json({ error: "Token scaduto. Richiedine uno nuovo." });
    return;
  }

  const sessionToken = crypto.randomBytes(32).toString("hex");
  const now = new Date().toISOString();
  addUserSession(user, sessionToken);
  user.sessionHash = hashSecret(sessionToken);
  user.sessionExpiresAt = new Date(Date.now() + sessionTtlMs).toISOString();
  user.lastLoginAt = now;
  user.updatedAt = now;
  await ensureUserStorage(user);
  await saveUsersStore(store);

  res.json({ ok: true, sessionToken, user: publicUser(user) });
});

app.post("/api/auth/logout", async (req, res) => {
  const sessionHash = getRequestSessionHash(req);
  const user = await getSessionUser(req);
  if (user) {
    await requestStopRunningJobsForUser(user, "Avanzamento in pausa: l'utente e uscito dalla sessione.");
    const store = await loadUsersStore();
    const stored = store.users.find((item) => item.id === user.id);
    if (stored) {
      stored.sessions = Array.isArray(stored.sessions)
        ? stored.sessions.filter((session) => session.hash !== sessionHash)
        : [];
      if (stored.sessionHash === sessionHash) {
        stored.sessionHash = "";
        stored.sessionExpiresAt = "";
      }
      stored.updatedAt = new Date().toISOString();
      await saveUsersStore(store);
    }
  }
  res.json({ ok: true });
});

app.post("/api/heartbeat", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  await touchUserHeartbeat(user.id);
  res.json({ ok: true, timeoutMs: heartbeatTimeoutMs });
});

app.get("/api/settings", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  res.json(await loadSettings(user));
});

app.post("/api/settings", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const store = await loadUsersStore();
  const stored = store.users.find((item) => item.id === user.id);
  if (!stored) {
    res.status(401).json({ error: "Sessione non valida." });
    return;
  }

  const settings = {
    openrouterApiKey: String(req.body.openrouterApiKey || "").trim(),
    defaultModel: normalizeModelId(req.body.defaultModel || commonModels[0]),
  };
  stored.settings = settings;
  stored.updatedAt = new Date().toISOString();
  await saveUsersStore(store);
  res.json(settings);
});

app.post("/api/check-openrouter", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const settings = await loadSettings(user);
  const apiKey = String(req.body.openrouterApiKey || settings.openrouterApiKey || "").trim();
  const model = normalizeModelId(req.body.model || settings.defaultModel || commonModels[0]);

  if (!apiKey) {
    res.status(400).json({ ok: false, error: "API key mancante." });
    return;
  }

  const started = Date.now();
  try {
    await callOpenRouter({
      apiKey,
      model,
      maxTokens: 250,
      timeoutMs: 30000,
      systemPrompt: "Return only the word OK.",
      userPrompt: "Connection test.",
    });
    res.json({ ok: true, model, ms: Date.now() - started });
  } catch (err) {
    res.status(502).json({
      ok: false,
      model,
      ms: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

app.get("/api/apps", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const apps = await loadApps(user);
  for (const target of apps) {
    if (!target.demoToken) target.demoToken = crypto.randomUUID();
    if (!target.lifecycle) target.lifecycle = "demo";
    await refreshProjectState(target);
    if (target.autopilot?.running && !runningJobs.has(jobKey(user.id, target.id))) {
      recoverStaleAutopilot(target);
    }
    if (!target.autopilot?.running && target.status === "ready" && target.sdd?.currentStep) {
      target.status = "partial";
    }
    if (target.status === "building" && target.files?.length && !target.html && !target.autopilot?.running) {
      target.status = "partial";
      target.messages = Array.isArray(target.messages) ? target.messages : [];
      if (!target.messages.some((message) => message.content?.includes("Generazione interrotta"))) {
        target.messages.push({
          role: "assistant",
          content: "Generazione interrotta o chiusa prima del completamento. Ho recuperato i file gia creati: puoi leggere SDD e File; l'avanzamento automatico puo riprendere dal prossimo task.",
          at: new Date().toISOString(),
        });
      }
    }
  }
  await saveApps(apps, user);
  res.json({ apps: apps.map(publicApp) });
});

function recoverStaleAutopilot(target) {
  const now = new Date().toISOString();
  const steps = target.sdd?.steps || [];
  const currentTask = target.sdd?.currentStep?.label || target.autopilot?.currentTask || "Progetto in pausa";
  const message = "Avanzamento automatico interrotto da riavvio server. Puoi riprendere dal prossimo task.";

  appendOperationalLog(target, message);
  target.status = target.sdd?.currentStep ? "paused" : "ready";
  target.updatedAt = now;
  target.autopilot = {
    ...(target.autopilot || {}),
    running: false,
    stopRequested: false,
    currentTask,
    completed: steps.filter((step) => step.done).length,
    total: steps.length,
    updatedAt: now,
    lastMessage: message,
    error: null,
  };

  target.messages = Array.isArray(target.messages) ? target.messages : [];
  if (!target.messages.some((item) => item.content === message)) {
    pushAssistantMessage(target, message);
  }
}

app.get("/api/apps/:id/files", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const apps = await loadApps(user);
  const target = apps.find((item) => item.id === req.params.id);
  if (!target) {
    res.status(404).json({ error: "App non trovata." });
    return;
  }

  const root = projectRoot(target);
  const files = await listProjectFiles(root);
  const payload = [];
  for (const relPath of files) {
    payload.push({
      path: relPath,
      content: await readProjectFile(target, relPath),
    });
  }
  res.json({ files: payload });
});

app.post("/api/generate", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const prompt = String(req.body.prompt || "").trim();
  const requestedProjectName = String(req.body.projectName || "").trim();
  const requestedModel = normalizeModelId(req.body.model || "");
  const appId = String(req.body.appId || "").trim();

  if (!prompt) {
    res.status(400).json({ error: "Prompt mancante." });
    return;
  }

  const settings = await loadSettings(user);
  const model = requestedModel || settings.defaultModel || commonModels[0];
  const apiKey = String(req.body.openrouterApiKey || settings.openrouterApiKey || "").trim();

  if (!apiKey) {
    res.status(400).json({
      error: "API key OpenRouter mancante. Salvala nelle impostazioni prima di generare.",
    });
    return;
  }

  const apps = await loadApps(user);
  const now = new Date().toISOString();
  let target = apps.find((item) => item.id === appId);
  const isNewApp = !target;

  if (isNewApp && !requestedProjectName) {
    res.status(400).json({ error: "Nome progetto mancante." });
    return;
  }

  if (!target) {
    target = {
      id: `app-${Date.now()}`,
      demoToken: crypto.randomUUID(),
      lifecycle: "demo",
      ownerId: user.id,
      name: requestedProjectName,
      createdAt: now,
      updatedAt: now,
      model,
      prompt,
      status: "building",
      phase: "intake",
      html: "",
      files: [],
      messages: [],
      sdd: emptySddState(),
    };
    apps.unshift(target);
    await createInitialWorkspace(target, prompt);
  }

  if (target.autopilot?.running || runningJobs.has(jobKey(user.id, target.id))) {
    res.status(409).json({
      error: "Questo progetto sta gia lavorando. Attendi il completamento oppure controlla il registro operativo.",
      app: publicApp(target),
    });
    return;
  }

  target.updatedAt = now;
  target.model = model;
  target.status = "building";
  target.autopilot = {
    running: true,
    currentTask: isNewApp ? "Preparazione SDD e piano operativo" : "Applicazione modifica richiesta",
    completed: 0,
    total: target.sdd?.steps?.length || 0,
    startedAt: now,
    updatedAt: now,
    lastMessage: "Lavoro avviato in background.",
    error: null,
  };
  target.messages = Array.isArray(target.messages) ? target.messages : [];
  target.messages.push({ role: "user", content: prompt, at: now });
  await saveApps(apps, user);

  startAutopilotJob({
    userId: user.id,
    appId: target.id,
    apiKey,
    model,
    userPrompt: prompt,
    mode: isNewApp ? "initial" : "change",
  });

  res.json({ app: publicApp(target), usedAi: true, queued: true, error: "" });
});

app.post("/api/apps/:id/continue", startAutopilotRequest);
app.post("/api/apps/:id/autopilot", startAutopilotRequest);

app.post("/api/apps/:id/stop", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const apps = await loadApps(user);
  const target = apps.find((item) => item.id === req.params.id);

  if (!target) {
    res.status(404).json({ error: "App non trovata." });
    return;
  }

  const now = new Date().toISOString();
  appendOperationalLog(target, "Stop richiesto dall'utente. Mi fermo appena termina l'operazione corrente.");
  target.status = "paused";
  target.updatedAt = now;
  target.autopilot = {
    ...(target.autopilot || {}),
    running: false,
    stopRequested: true,
    updatedAt: now,
    lastMessage: "Stop richiesto. Progetto in pausa.",
    error: null,
  };
  pushAssistantMessage(target, "Ho messo in pausa l'avanzamento automatico. Puoi riprendere dal prossimo task quando vuoi.");
  await saveApps(apps, user);
  res.json({ app: publicApp(target), stopped: true });
});

app.delete("/api/apps/:id/logs", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const apps = await loadApps(user);
  const target = apps.find((item) => item.id === req.params.id);

  if (!target) {
    res.status(404).json({ error: "App non trovata." });
    return;
  }

  const now = new Date().toISOString();
  target.updatedAt = now;
  target.autopilot = {
    ...(target.autopilot || {}),
    log: [],
    error: target.status === "error" ? target.autopilot?.error || null : null,
    lastMessage: "Log puliti dall'utente.",
    updatedAt: now,
  };

  await saveApps(apps, user);
  res.json({ app: publicApp(target), cleared: true });
});

async function startAutopilotRequest(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;

  const settings = await loadSettings(user);
  const apps = await loadApps(user);
  const target = apps.find((item) => item.id === req.params.id);

  if (!target) {
    res.status(404).json({ error: "App non trovata." });
    return;
  }

  const model = normalizeModelId(req.body.model || target.model || settings.defaultModel || commonModels[0]);
  const apiKey = String(req.body.openrouterApiKey || settings.openrouterApiKey || "").trim();

  if (!apiKey) {
    res.status(400).json({
      error: "API key OpenRouter mancante. Salvala nelle impostazioni prima di continuare.",
    });
    return;
  }

  if (target.autopilot?.running || runningJobs.has(jobKey(user.id, target.id))) {
    res.json({ app: publicApp(target), usedAi: true, queued: true, alreadyRunning: true, error: "" });
    return;
  }

  const now = new Date().toISOString();
  target.status = "building";
  target.model = model;
  target.updatedAt = now;
  target.autopilot = {
    running: true,
    currentTask: target.sdd?.currentStep?.label || "Ripresa dal prossimo task",
    completed: target.sdd?.steps?.filter((step) => step.done).length || 0,
    total: target.sdd?.steps?.length || 0,
    startedAt: now,
    updatedAt: now,
    lastMessage: "Avanzamento automatico riavviato.",
    error: null,
  };
  target.messages = Array.isArray(target.messages) ? target.messages : [];
  target.messages.push({
    role: "assistant",
    content: "Riprendo dal prossimo task.",
    at: now,
  });
  await saveApps(apps, user);

  startAutopilotJob({ userId: user.id, appId: target.id, apiKey, model, userPrompt: "", mode: "continue" });
  res.json({ app: publicApp(target), usedAi: true, queued: true, error: "" });
}

app.get("/api/apps/:id/preview", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const apps = await loadApps(user);
  const target = apps.find((item) => item.id === req.params.id);
  if (!target) {
    res.status(404).send("App non trovata");
    return;
  }

  const html = await readPreviewHtml(target);
  if (!html) {
    res.type("html").send(previewPendingHtml());
    return;
  }

  res.type("html").send(html);
});

app.get("/api/apps/:id/live-preview", livePreviewRequest);
app.get("/api/apps/:id/live-preview/*splat", livePreviewRequest);
app.get("/demo/:id/:token", publicDemoRequest);
app.get("/demo/:id/:token/*splat", publicDemoRequest);

async function livePreviewRequest(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;

  const apps = await loadApps(user);
  const target = apps.find((item) => item.id === req.params.id);
  if (!target) {
    res.status(404).send("App non trovata");
    return;
  }

  if (getPreviewQueryToken(req)) {
    res.cookie("lococode_preview_token", getPreviewQueryToken(req), {
      httpOnly: true,
      sameSite: "lax",
      path: `/api/apps/${target.id}/live-preview`,
      maxAge: 60 * 60 * 1000,
    });
  }

  await refreshProjectState(target);
  const builtFrontend = await ensureFrontendPreviewBuild(target);
  if (builtFrontend) target.preview = await resolvePreviewState(target, target.files || []);
  await saveApps(apps, user);
  const staticPath = previewStaticPath(req.params.splat);
  const served = await serveFrontendBuildFile(target, staticPath, res);
  if (served) return;

  const html = await readPreviewHtml(target);
  if (!html) {
    res.type("html").send(previewPendingHtml());
    return;
  }

  res.type("html").send(html);
}

async function publicDemoRequest(req, res) {
  const found = await findPublicDemoApp(req.params.id, req.params.token);
  if (!found) {
    res.status(404).type("html").send(previewPendingHtml("Demo non trovata", "Il link demo non e valido o non e piu attivo."));
    return;
  }

  const { user, apps, target } = found;
  await refreshProjectState(target);
  const builtFrontend = await ensureFrontendPreviewBuild(target);
  if (builtFrontend) target.preview = await resolvePreviewState(target, target.files || []);
  await saveApps(apps, user);

  const staticPath = previewStaticPath(req.params.splat);
  const served = await serveFrontendBuildFile(target, staticPath, res);
  if (served) return;

  const html = await readPreviewHtml(target);
  res.type("html").send(html || previewPendingHtml());
}

const distDir = path.join(rootDir, "dist");
app.use(express.static(distDir));
app.use(async (_req, res, next) => {
  try {
    await fs.access(path.join(distDir, "index.html"));
    res.sendFile(path.join(distDir, "index.html"));
  } catch {
    next();
  }
});

app.listen(port, () => {
  console.log(`LocoCode API running on http://localhost:${port}`);
});

function startAutopilotJob({ userId, appId, apiKey, model, userPrompt = "", mode = "continue" }) {
  const key = jobKey(userId, appId);
  if (runningJobs.has(key)) return false;

  const job = runAutopilotJob({ userId, appId, apiKey, model, userPrompt, mode })
    .catch((err) => {
      console.error(`Autopilot job failed for ${appId}:`, err);
    })
    .finally(() => {
      runningJobs.delete(key);
    });

  runningJobs.set(key, job);
  return true;
}

function jobKey(userId, appId) {
  return `${userId || "legacy"}:${appId}`;
}

async function runAutopilotJob({ userId, appId, apiKey, model, userPrompt = "", mode = "continue" }) {
  const user = await loadUserById(userId);
  if (!user) return;

  const apps = await loadApps(user);
  const target = apps.find((item) => item.id === appId);
  if (!target) return;

  const saveProgress = async (phaseLabel = "") => {
    await refreshProjectState(target);
    const steps = target.sdd?.steps || [];
    const currentTask = phaseLabel || target.sdd?.currentStep?.label || target.autopilot?.currentTask || "Preparazione progetto";
    appendOperationalLog(target, phaseLabel ? `Fase in corso: ${phaseLabel}` : `Task aggiornato: ${currentTask}`);
    target.autopilot = {
      ...(target.autopilot || {}),
      running: true,
      currentTask,
      completed: steps.filter((step) => step.done).length,
      total: steps.length,
      updatedAt: new Date().toISOString(),
      lastMessage: phaseLabel ? `Fase in corso: ${phaseLabel}` : "Task aggiornato.",
      error: null,
    };
    target.status = "building";
    target.updatedAt = target.autopilot.updatedAt;
    await saveApps(apps, user);
  };

  try {
    await saveProgress(mode === "initial" ? "Preparazione piano operativo" : target.sdd?.currentStep?.label || "Prossimo task");

    if (mode === "initial") {
      const result = await runOrchestratorTurn({
        target,
        apiKey,
        model,
        userPrompt,
        mode: "initial",
        onProgress: async (phaseLabel) => saveProgress(`Completata fase: ${phaseLabel}`),
        shouldStop: async () => shouldStopAutopilot(user, appId),
      });
      if (result.stopped) {
        await pauseAutopilot(target, apps, user, result.summary);
        return;
      }
      pushAssistantMessage(target, result.summary);
    } else if (mode === "change") {
      await saveProgress("Applicazione modifica richiesta");
      const result = await runOrchestratorTurn({
        target,
        apiKey,
        model,
        userPrompt,
        mode: "change",
        onProgress: async () => saveProgress("Modifica applicata"),
      });
      pushAssistantMessage(target, result.summary);
    }

    await refreshProjectState(target);

    const maxTurns = 40;
    let turns = 0;
    let stallCount = 0;

    while (target.sdd?.currentStep && turns < maxTurns) {
      const stopReasonBefore = await shouldStopAutopilot(user, appId);
      if (stopReasonBefore) {
        await pauseAutopilot(target, apps, user, stopReasonBefore);
        return;
      }

      const beforeTask = getNextTaskLabel(target);
      const beforeDone = (target.sdd?.steps || []).filter((step) => step.done).length;

      await saveProgress(beforeTask || "Prossimo task");
      const result = await runOrchestratorTurn({
        target,
        apiKey,
        model,
        userPrompt: "",
        mode: "continue",
        onProgress: async () => saveProgress(beforeTask || "Task in corso"),
      });

      pushAssistantMessage(target, result.summary);
      await refreshProjectState(target);

      const stopReasonAfter = await shouldStopAutopilot(user, appId);
      if (stopReasonAfter) {
        await pauseAutopilot(target, apps, user, stopReasonAfter);
        return;
      }

      const afterTask = getNextTaskLabel(target);
      const afterDone = (target.sdd?.steps || []).filter((step) => step.done).length;
      if (afterTask === beforeTask && afterDone <= beforeDone) {
        const autoUpdated = await markCurrentTaskCompleted(target, beforeTask, result.summary);
        if (autoUpdated) {
          await refreshProjectState(target);
          appendOperationalLog(
            target,
            `Ho aggiornato automaticamente .lc/spec/tasks.md: completato "${beforeTask}".`,
          );
          pushAssistantMessage(
            target,
            `Task completato: "${beforeTask}". Piano aggiornato.`,
          );
          stallCount = 0;
        } else {
          stallCount += 1;
        }
      } else {
        stallCount = 0;
      }

      if (stallCount >= 2) {
        throw new Error(
          `Il task "${beforeTask}" non risulta avanzare: il modello non ha aggiornato il piano SDD. LocoCode prova a spuntare automaticamente .lc/spec/tasks.md dopo ogni task; se ricapita, il task va verificato manualmente.`,
        );
      }

      turns += 1;
    }

    if (turns >= maxTurns && target.sdd?.currentStep) {
      throw new Error("Limite di sicurezza raggiunto: ho eseguito molti task senza arrivare alla fine del piano SDD.");
    }

    await finishAutopilot(target, apps, user);
  } catch (err) {
    await stopAutopilotWithError(target, apps, user, err, model);
  }
}

async function finishAutopilot(target, apps, user) {
  await refreshProjectState(target);
  const steps = target.sdd?.steps || [];
  const doneCount = steps.filter((step) => step.done).length;
  const now = new Date().toISOString();
  if (!target.demoToken) target.demoToken = crypto.randomUUID();
  if (!target.lifecycle) target.lifecycle = "demo";
  const demoUrl = demoUrlForApp(target);
  appendOperationalLog(
    target,
    target.sdd?.currentStep
      ? `In pausa. Prossimo task: ${target.sdd.currentStep.label}.`
      : `Demo pronta: ${demoUrl}`,
  );
  target.status = target.sdd?.currentStep ? "paused" : "ready";
  target.updatedAt = now;
  target.autopilot = {
    ...(target.autopilot || {}),
    running: false,
    currentTask: target.sdd?.currentStep?.label || "Piano completato",
    completed: doneCount,
    total: steps.length,
    updatedAt: now,
    lastMessage: target.sdd?.currentStep ? "Avanzamento in pausa." : "Tutti i task risultano completati.",
    error: null,
  };
  pushAssistantMessage(
    target,
    target.sdd?.currentStep
      ? `In pausa. Prossimo task: ${target.sdd.currentStep.label}.`
      : `Piano completato. Demo pronta: ${demoUrl}`,
  );
  await saveApps(apps, user);
}

async function shouldStopAutopilot(user, appId) {
  const timeoutReason = await getHeartbeatStopReason(user);
  if (timeoutReason) return timeoutReason;

  const apps = await loadApps(user);
  const latest = apps.find((item) => item.id === appId);
  return latest?.autopilot?.stopRequested ? "Avanzamento automatico fermato su richiesta. Puoi riprendere quando vuoi." : "";
}

async function pauseAutopilot(target, apps, user, message) {
  await refreshProjectState(target);
  const steps = target.sdd?.steps || [];
  const now = new Date().toISOString();
  appendOperationalLog(target, message);
  target.status = "paused";
  target.updatedAt = now;
  target.autopilot = {
    ...(target.autopilot || {}),
    running: false,
    stopRequested: false,
    currentTask: target.sdd?.currentStep?.label || target.autopilot?.currentTask || "Progetto in pausa",
    completed: steps.filter((step) => step.done).length,
    total: steps.length,
    updatedAt: now,
    lastMessage: message,
    error: null,
  };
  pushAssistantMessage(target, message);
  await saveApps(apps, user);
}

async function stopAutopilotWithError(target, apps, user, err, model) {
  const message = formatOpenRouterError(err);
  await refreshProjectState(target);
  const task = target.autopilot?.currentTask || getNextTaskLabel(target) || "Task corrente";
  const now = new Date().toISOString();
  appendOperationalLog(target, `Errore nel task "${task}": ${message}`);
  target.status = "error";
  target.updatedAt = now;
  target.autopilot = {
    ...(target.autopilot || {}),
    running: false,
    currentTask: task,
    updatedAt: now,
    lastMessage: "Fermo per errore.",
    error: buildOperationalError({ task, message, model }),
  };
  pushAssistantMessage(
    target,
    `Errore nel task "${task}": ${message}`,
  );
  await saveApps(apps, user);
}

function buildOperationalError({ task, message, model }) {
  const lower = String(message || "").toLowerCase();
  let suggestion = "Correggi la causa indicata e poi usa Riprendi: LocoCode continuera dal task fermo.";
  if (lower.includes("api key") || lower.includes("401") || lower.includes("unauthorized")) {
    suggestion = "Controlla la API key OpenRouter nelle impostazioni e riprova.";
  } else if (lower.includes("429") || lower.includes("rate")) {
    suggestion = "OpenRouter ha limitato le richieste. Attendi qualche minuto o cambia modello tra DeepSeek e Kimi.";
  } else if (lower.includes("json non valido") || lower.includes("risposta vuota")) {
    suggestion = "Il provider ha chiuso o troncato la risposta. Riprova: i file gia salvati restano nel progetto.";
  } else if (lower.includes("blocchi file")) {
    suggestion = "Il modello non ha restituito file nel formato richiesto. Riprova oppure passa all'altro modello disponibile.";
  }

  return {
    title: "LocoCode fermo",
    task,
    model,
    cause: message,
    suggestion,
  };
}

function appendOperationalLog(target, message) {
  if (!message) return;
  if (/^\s*Nota operativa/i.test(message) || isTechnicalNarration(message)) return;

  const previous = Array.isArray(target.autopilot?.log) ? target.autopilot.log : [];
  target.autopilot = {
    ...(target.autopilot || {}),
    log: [
      ...previous,
      {
        at: new Date().toISOString(),
        message,
      },
    ].slice(-18),
  };
}

async function markCurrentTaskCompleted(target, taskLabel, note = "") {
  const tasksPath = ".lc/spec/tasks.md";
  const current = await readProjectFile(target, tasksPath);
  if (!current.trim()) return false;

  const wanted = normalizeTaskText(taskLabel);
  let changed = false;
  const lines = current.split(/\r?\n/);
  const nextLines = lines.map((line) => {
    if (changed || !/^\s*[-*]\s+\[\s\]\s+.+$/.test(line)) return line;

    const label = line.replace(/^\s*[-*]\s+\[\s\]\s+/, "");
    const normalized = normalizeTaskText(label);
    if (wanted && normalized && normalized !== wanted && !normalized.includes(wanted) && !wanted.includes(normalized)) {
      return line;
    }

    changed = true;
    return line.replace(/\[\s\]/, "[x]");
  });

  if (!changed) {
    for (let index = 0; index < nextLines.length; index += 1) {
      if (/^\s*[-*]\s+\[\s\]\s+.+$/.test(nextLines[index])) {
        nextLines[index] = nextLines[index].replace(/\[\s\]/, "[x]");
        changed = true;
        break;
      }
    }
  }

  const next = nextLines.join("\n");

  if (!changed || next === current) return false;

  await writeProjectFile(target, tasksPath, next);

  const memoryPath = ".lc/memory/project_context.md";
  const memory = await readProjectFile(target, memoryPath);
  const stamp = new Date().toISOString();
  const cleanNote = String(note || "").replace(/\s+/g, " ").slice(0, 500);
  await writeProjectFile(
    target,
    memoryPath,
    `${memory.trim()}\n\n---\n\n## Avanzamento automatico ${stamp}\n\nTask completato: ${taskLabel || "prossimo task"}.\n${cleanNote ? `\nNota: ${cleanNote}\n` : ""}`,
  );

  return true;
}

function normalizeTaskText(value) {
  return String(value || "")
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function pushAssistantMessage(target, content) {
  target.messages = Array.isArray(target.messages) ? target.messages : [];
  target.messages.push({
    role: "assistant",
    content,
    at: new Date().toISOString(),
  });
}

async function runOrchestratorTurn({ target, apiKey, model, userPrompt, mode, onProgress, shouldStop }) {
  if (mode === "initial") {
    return runInitialOrchestration({ target, apiKey, model, userPrompt, onProgress, shouldStop });
  }

  const projectMemory = await loadProjectMemory(target);
  const nextTask = getNextTaskLabel(target);
  const systemPrompt = buildOrchestratorSystemPrompt();
  const prompt = buildFollowupOrchestratorPrompt({ userPrompt, projectMemory, nextTask, mode });

  const aiText = await callOpenRouter({
    apiKey,
    model,
    systemPrompt,
    userPrompt: prompt,
    maxTokens: 9000,
    timeoutMs: openRouterTimeoutMs,
  });
  const operations = parseOperations(aiText);
  if (!operations.length) {
    throw new Error(
      "Il modello ha risposto, ma non ha restituito blocchi file applicabili. LocoCode richiede blocchi ```file path=\"...\".",
    );
  }

  const result = await applyOperations(target, operations);
  if (result.errors.length) {
    throw new Error(`Operazioni file non valide: ${result.errors.join("; ")}`);
  }

  await refreshProjectState(target);
  await onProgress?.();

  const createdOrUpdated = [...result.created, ...result.updated];
  const action =
    mode === "initial"
      ? "SDD creato e primo MVP generato"
      : mode === "continue"
        ? "Task applicato"
        : "Modifica applicata";

  return {
    summary: `${action}. ${summarizeTouchedFiles(createdOrUpdated)}.`,
    touched: createdOrUpdated,
    changedFiles: createdOrUpdated.length,
  };
}

async function runInitialOrchestration({ target, apiKey, model, userPrompt, onProgress, shouldStop }) {
  const systemPrompt = buildOrchestratorSystemPrompt();
  const phases = [
    {
      label: "specifiche progetto",
      maxTokens: 7000,
      getPrompt: async () => buildInitialSpecsPrompt(userPrompt),
    },
    {
      label: "parte server",
      maxTokens: 7500,
      getPrompt: async () => buildInitialBackendPrompt(userPrompt, await loadProjectMemory(target)),
    },
    {
      label: "interfaccia e anteprima",
      maxTokens: 9500,
      getPrompt: async () => buildInitialFrontendPrompt(userPrompt, await loadProjectMemory(target)),
    },
  ];

  const touched = [];

  for (const phase of phases) {
    const stopReasonBefore = await shouldStop?.();
    if (stopReasonBefore) {
      return {
        summary: stopReasonBefore,
        touched: [...new Set(touched)],
        changedFiles: new Set(touched).size,
        stopped: true,
      };
    }

    const aiText = await callOpenRouter({
      apiKey,
      model,
      systemPrompt,
      userPrompt: await phase.getPrompt(),
      maxTokens: phase.maxTokens,
      timeoutMs: openRouterTimeoutMs,
    });
    const operations = parseOperations(aiText);
    if (!operations.length) {
      throw new Error(
        `Fase ${phase.label}: il modello ha risposto, ma non ha restituito blocchi file applicabili.`,
      );
    }

    const result = await applyOperations(target, operations);
    if (result.errors.length) {
      throw new Error(`Fase ${phase.label}: operazioni file non valide: ${result.errors.join("; ")}`);
    }

    touched.push(...result.created, ...result.updated);
    await refreshProjectState(target);
    target.updatedAt = new Date().toISOString();
    await onProgress?.(phase.label);

    const stopReasonAfter = await shouldStop?.();
    if (stopReasonAfter) {
      return {
        summary: stopReasonAfter,
        touched: [...new Set(touched)],
        changedFiles: new Set(touched).size,
        stopped: true,
      };
    }
  }

  return {
    summary: `Piano creato e prima demo generata. ${summarizeTouchedFiles([...new Set(touched)])}.`,
    touched: [...new Set(touched)],
    changedFiles: new Set(touched).size,
  };
}

function summarizeTouchedFiles(files) {
  const list = Array.isArray(files) ? files.filter(Boolean) : [];
  if (!list.length) return "Nessun file modificato";
  const preview = list.slice(0, 3).join(", ");
  return list.length <= 3 ? "File salvati nel progetto" : `${list.length} file salvati nel progetto`;
}

function appendModelNarration(target, aiText, phaseLabel = "") {
  const message = operationProgressMessage(phaseLabel, aiText);
  if (!message) return;
  appendOperationalLog(target, message);
}

function operationProgressMessage(phaseLabel = "", aiText = "") {
  const phase = String(phaseLabel || "").toLowerCase();
  if (phase.includes("specific")) return "Sto preparando il piano del progetto.";
  if (phase.includes("server") || phase.includes("backend") || phase.includes("deploy")) return "Sto preparando la parte server della demo.";
  if (phase.includes("interfaccia") || phase.includes("frontend") || phase.includes("anteprima")) return "Sto preparando interfaccia e anteprima reale.";

  const narration = extractModelNarration(aiText);
  if (!narration) return "Sto salvando le modifiche del progetto.";
  return narration;
}

function extractModelNarration(aiText) {
  const text = String(aiText || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/<file\s+path=["'][^"']+["'][\s\S]*?<\/file>/gi, " ")
    .replace(/\{[\s\S]*"files"\s*:\s*\[[\s\S]*\}/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!text || text.length < 8) return "";
  if (isTechnicalNarration(text)) return "";
  if (/^(ok|fatto|done)$/i.test(text)) return "";
  return text.length > 260 ? `${text.slice(0, 260).trim()}...` : text;
}

function isTechnicalNarration(text) {
  return /\[Browser\]|<--|-->|OMDB_API_KEY|API_KEY|bash\b|python\s+-|pip\s+install|cd\s+backend|FastAPI|SQLite|Vite|\.env|localhost|curl\b|npm\s+/i.test(
    text,
  );
}

function buildOrchestratorSystemPrompt() {
  return [
    "Sei LocoCode Web, il motore che crea web app complete partendo da una richiesta utente.",
    "Non sei una chat generica: lavori per specifiche, task piccoli e file reali.",
    "",
    "Stack predefinito:",
    "- Frontend: React + Vite",
    "- Backend: FastAPI",
    "- Database iniziale: SQLite",
    "- Deploy: sempre sul server LocoCode, nella cartella del progetto dell'utente",
    "- Provider AI: OpenRouter",
    "",
    "Regole:",
    "- Rispondi in italiano nei documenti SDD.",
    "- Non fare domande bloccanti quando puoi scegliere una soluzione ragionevole.",
    "- Non inserire API key o segreti nei file.",
    "- Ogni progetto generato deve tendere a un prodotto testabile: frontend, backend, database/config e istruzioni di avvio coerenti.",
    "- Ogni progetto deve avere un flusso demo -> abbonamento: demo con chiave provvisoria, pulsante/testo 'Richiedi chiave di attivazione' o 'Abbonati', e stato pronto per chiave reale mensile.",
    "- Non proporre Render, Netlify, Vercel, Firebase o servizi esterni: il prodotto demo deve girare sul server LocoCode.",
    "- Il backend deve esporre API avviabili sul server e il frontend deve poter usare una URL API configurabile con VITE_API_URL.",
    "- Il database iniziale deve stare nella cartella del progetto, preferibilmente SQLite per la demo.",
    "- Se l'app prevede accesso utenti, crea credenziali demo fittizie documentate nel README, mai credenziali reali.",
    "- Se l'app richiede API esterne, non bloccare la demo e non mostrare errori tecnici: crea una schermata Impostazioni/Chiavi API per inserirle, usa dati fittizi finche mancano, e documenta le chiavi richieste in deploy/lococode.json.",
    "- Non inserire istruzioni da terminale, comandi bash, pip, npm o placeholder tipo OMDB_API_KEY nel testo visibile al cliente finale.",
    "- Ogni modifica deve restituire file completi, non patch parziali.",
    "- Usa solo percorsi relativi alla root progetto.",
    "- Non creare mai .venv, venv, node_modules, dist o build: l'ambiente verra installato dal server LocoCode.",
    "- La preview principale deve essere l'app reale in frontend/ quando esiste: React + Vite, buildabile e navigabile.",
    "- Usa preview/index.html solo come fallback iniziale quando il frontend vero non e ancora pronto.",
    "- Se generi backend, includi sempre backend/requirements.txt, backend/app/__init__.py, backend/app/main.py e backend/.env.example.",
    "- Aggiorna sempre .lc/spec/tasks.md spuntando il task corrente completato con [x].",
    "",
    "Formato obbligatorio per creare/modificare file:",
    "```file path=\"percorso/relativo/file.ext\"",
    "contenuto completo del file",
    "```",
    "",
    "Puoi restituire piu blocchi file nella stessa risposta. Evita testo lungo fuori dai blocchi.",
  ].join("\n");
}

function buildInitialSpecsPrompt(initialPrompt) {
  return [
    "Richiesta iniziale utente:",
    initialPrompt,
    "",
    "FASE 1/3 - Specifiche SDD.",
    "Genera solo documenti di progetto e piano operativo. Non generare ancora codice applicativo.",
    "",
    "File obbligatori da restituire:",
    "- .lc/spec/sdd.md",
    "- .lc/spec/requirements.md",
    "- .lc/spec/architecture.md",
    "- .lc/spec/tasks.md",
    "- .lc/memory/project_context.md",
    "- README.md",
    "- deploy/lococode.json",
    "",
    "Il file .lc/spec/tasks.md deve contenere checkbox markdown con task piccoli e verificabili.",
    "Il piano deve includere: link demo finale, chiave demo provvisoria, richiesta chiave di attivazione, abbonamento mensile, gestione scadenza chiave.",
    "Se servono API esterne, pianifica una schermata interna per inserire le chiavi senza bloccare la demo.",
    "Marca completati solo i task di specifica realmente coperti in questa fase.",
    "Se il dominio e medico/dentistico, il prodotto deve gestire processi amministrativi e clinici registrati dallo studio, ma non deve dare diagnosi o consigli medici automatici.",
    "Restituisci solo blocchi file.",
  ].join("\n");
}

function buildInitialBackendPrompt(initialPrompt, projectMemory) {
  return [
    "Richiesta iniziale utente:",
    initialPrompt,
    "",
    "FASE 2/3 - Backend, database e deploy locale server.",
    "Usa la memoria SDD qui sotto e genera i file backend completi per FastAPI + SQLite.",
    "",
    "Memoria progetto:",
    projectMemory,
    "",
    "File obbligatori da restituire:",
    "- backend/requirements.txt",
    "- backend/app/__init__.py",
    "- backend/app/main.py",
    "- backend/.env.example",
    "- deploy/lococode.json",
    "- .lc/spec/tasks.md",
    "- .lc/memory/project_context.md",
    "",
    "backend/app/main.py deve includere FastAPI, CORS, health check, modelli Pydantic, inizializzazione SQLite e API CRUD minime coerenti con il progetto.",
    "deploy/lococode.json deve descrivere nome servizio, porta suggerita, comando backend, comando build frontend, percorso SQLite, credenziali demo, chiave demo, chiave di attivazione mensile e API esterne richieste.",
    "Il backend deve accettare una chiave demo provvisoria e predisporre una chiave reale con scadenza mensile, anche se il pagamento reale verra collegato dopo.",
    "Se sono necessarie API esterne, crea endpoint/config SQLite per salvare le chiavi fornite dall'utente nella demo; se mancano, restituisci dati fittizi e messaggi gentili, non errori bloccanti.",
    "Non usare render.yaml, Netlify, Vercel o altri deploy esterni.",
    "Non inserire dati sanitari reali, API key o segreti.",
    "Aggiorna il piano dei task completati in questa fase.",
    "Restituisci solo blocchi file.",
  ].join("\n");
}

function buildInitialFrontendPrompt(initialPrompt, projectMemory) {
  return [
    "Richiesta iniziale utente:",
    initialPrompt,
    "",
    "FASE 3/3 - Frontend React e anteprima.",
    "Usa la memoria SDD qui sotto e genera il frontend MVP completo.",
    "",
    "Memoria progetto:",
    projectMemory,
    "",
    "File obbligatori da restituire:",
    "- frontend/package.json",
    "- frontend/index.html",
    "- frontend/src/App.jsx",
    "- frontend/src/styles.css",
    "- preview/index.html (fallback, non sostituisce il frontend reale)",
    "- .lc/spec/tasks.md",
    "- .lc/memory/project_context.md",
    "",
    "Il frontend deve essere in italiano, gestionale, responsive, navigabile e con dati demo realistici ma fittizi.",
    "L'utente deve poter provare l'MVP come prodotto: pagine principali, pulsanti, form e routing devono funzionare nella preview reale.",
    "Il frontend deve mostrare nella demo un'area 'Attivazione' o 'Abbonamento' con richiesta chiave di attivazione, stato demo e call to action per abbonarsi.",
    "Se l'app usa API esterne, il frontend deve avere una schermata Impostazioni/Chiavi API dove inserire la chiave; senza chiave deve funzionare con dati demo, non fermarsi.",
    "Il frontend deve leggere l'API da import.meta.env.VITE_API_URL e funzionare quando viene servito sotto un path pubblico del server LocoCode.",
    "preview/index.html serve solo da fallback statico se il frontend vero non e ancora pronto.",
    "Aggiorna il piano dei task completati in questa fase.",
    "Restituisci solo blocchi file.",
  ].join("\n");
}

function buildFollowupOrchestratorPrompt({ userPrompt, projectMemory, nextTask, mode }) {
  const instruction =
    mode === "continue"
      ? `Continua automaticamente dal prossimo task: ${nextTask || "completa il prossimo passo tecnico utile"}.`
      : `Applica questa richiesta utente seguendo la memoria SDD: ${userPrompt}`;

  return [
    instruction,
    "",
    "Memoria progetto disponibile:",
    projectMemory,
    "",
    "Istruzioni operative:",
    "- Non ripartire da zero.",
    "- Modifica solo i file necessari.",
    "- Aggiorna sempre .lc/spec/tasks.md spuntando il task corrente completato con [x].",
    "- Aggiorna sempre .lc/memory/project_context.md con una nota breve.",
    "- Se esiste frontend/, aggiorna il frontend reale quando cambia comportamento o UI.",
    "- Aggiorna preview/index.html solo come fallback statico quando il frontend reale non e ancora pronto.",
    "- Mantieni sempre funzionante il link demo: se una chiave API esterna manca, mostra impostazioni e dati demo invece di un errore tecnico.",
    "- Mantieni il flusso demo -> richiesta chiave di attivazione -> abbonamento mensile.",
    "- Non creare mai .venv, venv, node_modules, dist o build.",
    "- Restituisci solo blocchi file nel formato richiesto.",
  ].join("\n");
}

async function createInitialWorkspace(target, initialPrompt) {
  const root = projectRoot(target);
  const now = new Date().toISOString();
  const safeName = safeProjectName(target.name);
  const files = {
    ".lc/project.json": JSON.stringify(
      {
        display_name: target.name,
        folder_name: safeName,
        created_at: now,
        mode: "web-sdd-orchestrator",
      },
      null,
      2,
    ),
    ".lc/spec/initial_prompt.md": `# Prompt iniziale\n\nGenerato da LocoCode il ${now}.\n\n${initialPrompt}\n`,
    ".lc/state.json": JSON.stringify(
      {
        updated_at: now,
        phase: "idea_iniziale",
        label: "Fase: idea iniziale",
        has_sdd: false,
        has_requirements: false,
        has_architecture: false,
        has_tasks: false,
      },
      null,
      2,
    ),
    ".lc/memory/project_context.md": `# Project Context\n\nGenerato da LocoCode il ${now}.\n\n## Prompt iniziale\n\n${initialPrompt}\n`,
    ".gitignore": ["node_modules/", "dist/", "build/", ".env", "__pycache__/", "*.pyc", ".lc/tmp/", ".lococode_runtime/"].join("\n"),
  };

  for (const [relPath, content] of Object.entries(files)) {
    await writeProjectFile(target, relPath, content);
  }
}

async function refreshProjectState(target) {
  const root = projectRoot(target);
  const files = await listProjectFiles(root);
  target.files = files;
  target.fileCount = files.length;
  target.preview = await resolvePreviewState(target, files);
  target.html = await readPreviewHtml(target);

  const specs = {
    sdd: await readProjectFile(target, ".lc/spec/sdd.md"),
    requirements: await readProjectFile(target, ".lc/spec/requirements.md"),
    architecture: await readProjectFile(target, ".lc/spec/architecture.md"),
    tasks: await readProjectFile(target, ".lc/spec/tasks.md"),
    memory: await readProjectFile(target, ".lc/memory/project_context.md"),
  };
  const steps = parseTaskList(specs.tasks);
  const currentStep = steps.find((step) => !step.done) || null;

  target.sdd = {
    specs,
    steps,
    currentStep,
    phase: currentStep?.phase || "",
    filePaths: [
      ".lc/spec/sdd.md",
      ".lc/spec/requirements.md",
      ".lc/spec/architecture.md",
      ".lc/spec/tasks.md",
      ".lc/memory/project_context.md",
    ].filter((relPath) => files.includes(relPath)),
  };
  target.phase = currentStep ? "building" : "ready";
}

async function resolvePreviewState(target, files = []) {
  const hasFrontend = files.includes("frontend/package.json") && files.includes("frontend/index.html");
  const frontendDistIndex = await frontendDistIndexPath(target);
  const hasLiveBuild = Boolean(frontendDistIndex);

  return {
    mode: hasLiveBuild ? "frontend" : "fallback",
    hasFrontend,
    hasLiveBuild,
    url: `/api/apps/${target.id}/live-preview/`,
    fallbackUrl: `/api/apps/${target.id}/preview`,
    updatedAt: hasLiveBuild ? await fileMtimeIso(frontendDistIndex) : "",
  };
}

async function ensureFrontendPreviewBuild(target) {
  const frontendDirPath = frontendDir(target);
  if (!(await exists(path.join(frontendDirPath, "index.html")))) return false;
  if (!(await exists(path.join(frontendDirPath, "package.json")))) return false;

  const key = jobKey(target.ownerId || "legacy", `${target.id}:preview`);
  if (frontendBuilds.has(key)) return frontendBuilds.get(key);

  const buildJob = buildFrontendPreview(target)
    .catch((err) => {
      console.warn(`Preview build non pronta per ${target.id}: ${err instanceof Error ? err.message : String(err)}`);
      appendOperationalLog(target, "Anteprima reale in preparazione. LocoCode la aggiornera appena il frontend sara completo.");
      return false;
    })
    .finally(() => {
      frontendBuilds.delete(key);
    });

  frontendBuilds.set(key, buildJob);
  return buildJob;
}

async function buildFrontendPreview(target) {
  const frontendDirPath = frontendDir(target);
  const outDir = frontendRuntimeDistDir(target);
  const sourceMtime = await latestMtimeMs(frontendDirPath, new Set(["node_modules", "dist", "build", ".lococode_runtime"]));
  const distIndex = path.join(outDir, "index.html");
  const distMtime = await fileMtimeMs(distIndex);

  if (distMtime && sourceMtime && distMtime >= sourceMtime) return true;

  await ensureFrontendDependencies(frontendDirPath);
  await fs.mkdir(outDir, { recursive: true });
  await viteBuild({
    root: frontendDirPath,
    base: "./",
    configFile: false,
    publicDir: false,
    logLevel: "silent",
    plugins: [react()],
    resolve: {
      alias: {
        react: path.join(rootDir, "node_modules/react"),
        "react-dom": path.join(rootDir, "node_modules/react-dom"),
        "react-dom/client": path.join(rootDir, "node_modules/react-dom/client"),
        "lucide-react": path.join(rootDir, "node_modules/lucide-react"),
      },
    },
    build: {
      outDir,
      emptyOutDir: true,
      sourcemap: false,
    },
  });

  return exists(distIndex);
}

async function ensureFrontendDependencies(frontendDirPath) {
  const packageJsonPath = path.join(frontendDirPath, "package.json");
  const nodeModulesPath = path.join(frontendDirPath, "node_modules");
  const markerPath = path.join(nodeModulesPath, ".lococode-install.json");
  const packageMtime = await fileMtimeMs(packageJsonPath);
  const marker = await readJson(markerPath);

  if ((await exists(nodeModulesPath)) && marker?.packageMtime === packageMtime) return;

  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  await execFileAsync(
    npmCommand,
    ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false", "--legacy-peer-deps"],
    {
      cwd: frontendDirPath,
      timeout: 5 * 60 * 1000,
      maxBuffer: 1024 * 1024 * 8,
    },
  );

  await fs.mkdir(nodeModulesPath, { recursive: true });
  await fs.writeFile(markerPath, JSON.stringify({ packageMtime, installedAt: new Date().toISOString() }, null, 2), "utf8");
}

async function serveFrontendBuildFile(target, requestedPath, res) {
  const distDirPath = frontendRuntimeDistDir(target);
  const safePath = normalizePreviewAssetPath(requestedPath);
  const targetPath = safePath ? path.join(distDirPath, safePath) : path.join(distDirPath, "index.html");
  const indexPath = path.join(distDirPath, "index.html");
  let filePath = targetPath;

  if (!(await exists(filePath))) {
    if (safePath && path.extname(safePath)) return false;
    filePath = indexPath;
  }

  if (!(await exists(filePath))) return false;

  res.type(mimeTypeForPath(filePath));
  res.setHeader("Cache-Control", "no-store");
  res.send(await fs.readFile(filePath));
  return true;
}

function previewStaticPath(value) {
  if (Array.isArray(value)) return value.join("/");
  return String(value || "").replaceAll(",", "/");
}

function normalizePreviewAssetPath(value) {
  const normalized = String(value || "").replaceAll("\\", "/").replace(/^\/+/, "").trim();
  if (!normalized) return "";
  const parts = normalized.split("/").filter(Boolean);
  if (parts.includes("..")) return "";
  return parts.join("/");
}

async function frontendDistIndexPath(target) {
  const filePath = path.join(frontendRuntimeDistDir(target), "index.html");
  return (await exists(filePath)) ? filePath : "";
}

function frontendDir(target) {
  return path.join(projectRoot(target), "frontend");
}

function frontendRuntimeDistDir(target) {
  return path.join(projectRoot(target), ".lococode_runtime", "frontend-dist");
}

async function latestMtimeMs(dir, ignoredNames = new Set()) {
  let latest = 0;

  async function walk(current) {
    let entries = [];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (ignoredNames.has(entry.name)) continue;
      const fullPath = path.join(current, entry.name);
      const stat = await fs.stat(fullPath);
      if (stat.mtimeMs > latest) latest = stat.mtimeMs;
      if (entry.isDirectory()) await walk(fullPath);
    }
  }

  await walk(dir);
  return latest;
}

async function fileMtimeMs(filePath) {
  try {
    return (await fs.stat(filePath)).mtimeMs;
  } catch {
    return 0;
  }
}

async function fileMtimeIso(filePath) {
  try {
    return (await fs.stat(filePath)).mtime.toISOString();
  } catch {
    return "";
  }
}

function mimeTypeForPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    ".html": "html",
    ".js": "application/javascript",
    ".mjs": "application/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
  }[ext] || "application/octet-stream";
}

async function loadProjectMemory(target) {
  const root = projectRoot(target);
  const files = await listProjectFiles(root);
  const memoryFiles = [
    ".lc/spec/requirements.md",
    ".lc/spec/architecture.md",
    ".lc/spec/tasks.md",
    ".lc/memory/project_context.md",
    "README.md",
  ];

  const chunks = [];
  for (const relPath of memoryFiles) {
    const content = await readProjectFile(target, relPath);
    if (content.trim()) {
      chunks.push(`--- FILE: ${relPath} ---\n${truncate(content, 9000)}`);
    }
  }

  chunks.push(`--- FILE LIST ---\n${files.join("\n") || "Nessun file ancora."}`);
  return truncate(chunks.join("\n\n"), 36000);
}

function parseOperations(responseText) {
  if (!responseText) return [];

  const operations = [];
  operations.push(...parseJsonOperations(responseText));
  operations.push(...parseFencedFileBlocks(responseText));
  operations.push(...parseXmlFileTags(responseText));

  const seen = new Set();
  return operations.filter((operation) => {
    const key = `${operation.action || "write"}:${operation.path}:${operation.content}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseFencedFileBlocks(text) {
  const operations = [];
  const fencePattern = /```(?<header>[^\n`]*)\n(?<body>[\s\S]*?)```/gi;
  for (const match of text.matchAll(fencePattern)) {
    const header = (match.groups?.header || "").trim();
    const pathValue = extractPathFromHeader(header);
    if (!pathValue) continue;
    operations.push({
      path: pathValue,
      action: extractActionFromHeader(header) || "write",
      content: `${(match.groups?.body || "").replace(/\s+$/g, "")}\n`,
      source: "fenced",
    });
  }

  const unclosed = text.match(/```(?<header>[^\n`]*)\n(?<body>[\s\S]*)$/i);
  if (unclosed?.groups) {
    const pathValue = extractPathFromHeader(unclosed.groups.header || "");
    if (pathValue && !operations.some((operation) => operation.path === pathValue)) {
      operations.push({
        path: pathValue,
        action: extractActionFromHeader(unclosed.groups.header || "") || "write",
        content: `${(unclosed.groups.body || "").replace(/\s+$/g, "")}\n`,
        source: "fenced-unclosed",
      });
    }
  }

  return operations;
}

function parseXmlFileTags(text) {
  const operations = [];
  const tagPattern =
    /<file\s+path=["'](?<path>[^"']+)["'](?:\s+action=["'](?<action>[^"']+)["'])?\s*>(?<body>[\s\S]*?)<\/file>/gi;

  for (const match of text.matchAll(tagPattern)) {
    operations.push({
      path: (match.groups?.path || "").trim(),
      action: (match.groups?.action || "write").trim(),
      content: `${(match.groups?.body || "").trimEnd()}\n`,
      source: "xml",
    });
  }

  return operations;
}

function parseJsonOperations(text) {
  const operations = [];
  const jsonBlocks = [];
  const fencePattern = /```(?:json|lococode-json)?\s*\n(?<body>\{[\s\S]*?\})\s*```/gi;

  for (const match of text.matchAll(fencePattern)) {
    if (match.groups?.body) jsonBlocks.push(match.groups.body);
  }

  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) jsonBlocks.push(trimmed);

  for (const block of jsonBlocks) {
    try {
      const data = JSON.parse(block);
      if (!Array.isArray(data.files)) continue;
      for (const item of data.files) {
        if (!item || typeof item !== "object") continue;
        const pathValue = String(item.path || "").trim();
        if (!pathValue) continue;
        operations.push({
          path: pathValue,
          action: String(item.action || "write").trim(),
          content: String(item.content || ""),
          source: "json",
        });
      }
    } catch {
      // Ignore non-file JSON snippets.
    }
  }

  return operations;
}

function extractPathFromHeader(header) {
  const patterns = [
    /(?:path|file|filename)\s*=\s*"([^"]+)"/i,
    /(?:path|file|filename)\s*=\s*'([^']+)'/i,
    /(?:path|file|filename)\s*=\s*([^\s]+)/i,
    /(?:file|lococode-file)\s+([^\s]+)/i,
  ];

  for (const pattern of patterns) {
    const found = header.match(pattern);
    if (found?.[1]) return found[1].trim();
  }

  return "";
}

function extractActionFromHeader(header) {
  const patterns = [/action\s*=\s*"([^"]+)"/i, /action\s*=\s*'([^']+)'/i, /action\s*=\s*([^\s]+)/i];
  for (const pattern of patterns) {
    const found = header.match(pattern);
    if (found?.[1]) return found[1].trim();
  }
  return "write";
}

async function applyOperations(target, operations) {
  const root = projectRoot(target);
  await fs.mkdir(root, { recursive: true });

  const result = {
    created: [],
    updated: [],
    skipped: [],
    errors: [],
    totalOperations: operations.length,
  };

  for (const operation of operations) {
    const relPath = normalizeSafePath(operation.path);
    if (!relPath) {
      result.errors.push(`Percorso non sicuro o vuoto: ${operation.path || ""}`);
      continue;
    }

    const targetPath = path.join(root, relPath);
    const existed = await exists(targetPath);
    const action = String(operation.action || "write").toLowerCase();

    try {
      if (["write", "create", "overwrite", "update"].includes(action)) {
        await fs.mkdir(path.dirname(targetPath), { recursive: true });
        await fs.writeFile(targetPath, String(operation.content || ""), "utf8");
        if (existed) result.updated.push(relPath);
        else result.created.push(relPath);
      } else if (["delete", "remove"].includes(action)) {
        if (existed) {
          await fs.unlink(targetPath);
          result.updated.push(`deleted:${relPath}`);
        } else {
          result.skipped.push(`File non trovato: ${relPath}`);
        }
      } else {
        result.skipped.push(`Azione non supportata '${action}' per ${relPath}`);
      }
    } catch (err) {
      result.errors.push(`Errore su ${relPath}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return result;
}

async function callOpenRouter({
  apiKey,
  model,
  systemPrompt,
  userPrompt,
  maxTokens = 12000,
  timeoutMs = openRouterTimeoutMs,
}) {
  const shouldAbort = Number(timeoutMs) > 0;
  const controller = shouldAbort ? new AbortController() : null;
  const timeout = shouldAbort ? setTimeout(() => controller.abort(), timeoutMs) : null;

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      signal: controller?.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://lococode.local",
        "X-Title": "LocoCode",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: maxTokens,
        temperature: 0.22,
      }),
    });

    const raw = await response.text();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${raw.slice(0, 600)}`);
    }

    if (!raw.trim()) {
      throw new Error("OpenRouter ha restituito una risposta vuota.");
    }

    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error(`OpenRouter ha restituito JSON non valido o troncato: ${raw.slice(0, 220)}`);
    }

    return data.choices?.[0]?.message?.content || "";
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function loadSettings(user = null) {
  const defaults = {
    openrouterApiKey: "",
    defaultModel: commonModels[0],
  };

  if (user) {
    return {
      ...defaults,
      ...(user.settings || {}),
      defaultModel: normalizeModelId(user.settings?.defaultModel || defaults.defaultModel),
    };
  }

  const own = await readJson(configPath);
  if (own) {
    return {
      ...defaults,
      ...own,
      defaultModel: normalizeModelId(own.defaultModel || defaults.defaultModel),
    };
  }

  const legacy = await readJson(legacyConfigPath);
  if (!legacy) return defaults;

  return {
    openrouterApiKey: legacy.openrouter_api_key || "",
    defaultModel: defaults.defaultModel,
  };
}

async function loadUsersStore() {
  const data = await readJson(usersPath);
  return { users: Array.isArray(data?.users) ? data.users : [] };
}

async function saveUsersStore(store) {
  await fs.writeFile(usersPath, JSON.stringify({ users: store.users || [] }, null, 2), "utf8");
}

async function getSessionUser(req) {
  const tokenHash = getRequestSessionHash(req);
  if (!tokenHash) return null;

  const store = await loadUsersStore();
  const now = Date.now();
  let changed = false;
  let user = null;

  for (const item of store.users) {
    if (Array.isArray(item.sessions)) {
      const validSessions = item.sessions.filter((session) => new Date(session.expiresAt || "").getTime() > now);
      if (validSessions.length !== item.sessions.length) {
        item.sessions = validSessions;
        changed = true;
      }
      if (validSessions.some((session) => session.hash === tokenHash)) user = item;
    }

    if (
      !user &&
      item.sessionHash === tokenHash &&
      item.sessionExpiresAt &&
      new Date(item.sessionExpiresAt).getTime() > now
    ) {
      user = item;
    }
  }

  if (changed) await saveUsersStore(store);
  if (!user) return null;

  await ensureUserStorage(user);
  return user;
}

function getRequestSessionHash(req) {
  const token = getBearerToken(req) || getPreviewQueryToken(req) || getCookieValue(req, "lococode_preview_token");
  return token ? hashSecret(token) : "";
}

function getBearerToken(req) {
  const header = String(req.headers.authorization || "");
  return header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
}

function getPreviewQueryToken(req) {
  const token = req.query?.preview_token || req.query?.token || "";
  return String(token).trim();
}

function getCookieValue(req, name) {
  const raw = String(req.headers.cookie || "");
  if (!raw) return "";

  for (const chunk of raw.split(";")) {
    const [key, ...valueParts] = chunk.trim().split("=");
    if (key === name) return decodeURIComponent(valueParts.join("=") || "");
  }

  return "";
}

async function requireUser(req, res) {
  const user = await getSessionUser(req);
  if (!user) {
    res.status(401).json({ error: "Accesso richiesto. Inserisci email e token." });
    return null;
  }
  return user;
}

async function touchUserHeartbeat(userId) {
  const store = await loadUsersStore();
  const stored = store.users.find((item) => item.id === userId);
  if (!stored) return null;

  const now = new Date().toISOString();
  stored.lastHeartbeatAt = now;
  stored.updatedAt = now;
  await saveUsersStore(store);
  return stored;
}

async function getHeartbeatStopReason(user) {
  const store = await loadUsersStore();
  const fresh = store.users.find((item) => item.id === user.id);
  const heartbeatAt = fresh?.lastHeartbeatAt || fresh?.lastLoginAt || user.lastHeartbeatAt || user.lastLoginAt;
  if (!heartbeatAt) return "";

  const age = Date.now() - new Date(heartbeatAt).getTime();
  if (!Number.isFinite(age) || age <= heartbeatTimeoutMs) return "";

  return "Avanzamento in pausa: la pagina non risulta piu aperta. Puoi riprendere quando torni.";
}

async function requestStopRunningJobsForUser(user, message) {
  const apps = await loadApps(user);
  let changed = false;
  for (const appData of apps) {
    const liveJob = runningJobs.has(jobKey(user.id, appData.id));
    const isActive = appData.autopilot?.running || appData.status === "building";
    if (!isActive) continue;

    appData.autopilot = {
      ...(appData.autopilot || {}),
      stopRequested: true,
      lastMessage: message,
      updatedAt: new Date().toISOString(),
    };

    if (!liveJob) {
      appData.status = "paused";
      appData.autopilot.running = false;
    }

    appendOperationalLog(appData, message);
    changed = true;
  }

  if (changed) await saveApps(apps, user);
}

async function loadUserById(userId) {
  const store = await loadUsersStore();
  const user = store.users.find((item) => item.id === userId);
  if (!user) return null;
  await ensureUserStorage(user);
  return user;
}

function findOrCreateUser(store, email) {
  const existing = store.users.find((item) => item.email === email);
  if (existing) return existing;

  const now = new Date().toISOString();
  const user = {
    id: `usr-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
    email,
    createdAt: now,
    updatedAt: now,
    settings: {
      openrouterApiKey: "",
      defaultModel: commonModels[0],
    },
    pendingTokenHash: "",
    pendingTokenExpiresAt: "",
    sessions: [],
    sessionHash: "",
    sessionExpiresAt: "",
  };
  store.users.unshift(user);
  return user;
}

function addUserSession(user, sessionToken) {
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + sessionTtlMs).toISOString();
  const sessions = Array.isArray(user.sessions) ? user.sessions : [];
  user.sessions = [
    { hash: hashSecret(sessionToken), createdAt: now, expiresAt },
    ...sessions.filter((session) => new Date(session.expiresAt || "").getTime() > Date.now()),
  ].slice(0, 12);
}

async function ensureUserStorage(user) {
  await fs.mkdir(userRoot(user.id), { recursive: true });
  await fs.mkdir(userProjectsDir(user.id), { recursive: true });
  if (!(await exists(userAppsPath(user.id)))) {
    await fs.writeFile(userAppsPath(user.id), JSON.stringify({ apps: [] }, null, 2), "utf8");
  }
}

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt || "",
  };
}

function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function generateLoginToken() {
  return String(crypto.randomInt(100000, 1000000));
}

function hashSecret(value) {
  return crypto.createHmac("sha256", authSecret).update(String(value || "")).digest("hex");
}

async function sendLoginTokenEmail(email, token) {
  const host = process.env.SMTP_HOST;
  const from = process.env.SMTP_FROM || process.env.SMTP_USER || "noreply@lococode.local";
  if (!host) {
    console.warn(`SMTP non configurato. Token LocoCode per ${email}: ${token}`);
    return { sent: false };
  }

  const portValue = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER || "";
  const pass = process.env.SMTP_PASS || "";
  const transporter = nodemailer.createTransport({
    host,
    port: portValue,
    secure: String(process.env.SMTP_SECURE || "").toLowerCase() === "true" || portValue === 465,
    auth: user && pass ? { user, pass } : undefined,
  });

  await transporter.sendMail({
    from,
    to: email,
    subject: "Il tuo token LocoCode",
    text: `Il tuo token LocoCode e: ${token}\n\nScade tra 15 minuti.`,
    html: `<p>Il tuo token LocoCode e:</p><p style="font-size:24px;font-weight:700;letter-spacing:4px">${token}</p><p>Scade tra 15 minuti.</p>`,
  });

  return { sent: true };
}

async function loadApps(user = null) {
  const data = await readJson(user ? userAppsPath(user.id) : appsPath);
  return Array.isArray(data?.apps) ? data.apps : [];
}

async function saveApps(apps, user = null) {
  const targetPath = user ? userAppsPath(user.id) : appsPath;
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, JSON.stringify({ apps }, null, 2), "utf8");
}

async function findPublicDemoApp(appId, token) {
  const cleanId = String(appId || "").trim();
  const cleanToken = String(token || "").trim();
  if (!cleanId || !cleanToken) return null;

  const store = await loadUsersStore();
  for (const user of store.users || []) {
    const apps = await loadApps(user);
    const target = apps.find((item) => item.id === cleanId && item.demoToken === cleanToken);
    if (target) return { user, apps, target };
  }

  return null;
}

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

function publicApp(appData) {
  const safe = {
    ...appData,
  };
  delete safe.ownerId;
  const demoToken = appData.demoToken || "";
  const demoUrl = demoUrlForApp(appData);

  return {
    ...safe,
    lifecycle: appData.lifecycle || "demo",
    demoUrl,
    autopilot: sanitizeAutopilotForClient(appData.autopilot),
    html: appData.html || "",
    preview: appData.preview || {
      mode: "fallback",
      hasFrontend: false,
      hasLiveBuild: false,
      url: `/api/apps/${appData.id}/live-preview/`,
      fallbackUrl: `/api/apps/${appData.id}/preview`,
      updatedAt: "",
    },
    files: Array.isArray(appData.files) ? appData.files : [],
    fileCount: appData.fileCount || (Array.isArray(appData.files) ? appData.files.length : 0),
    sdd: appData.sdd || emptySddState(),
    storagePath: appData.ownerId ? `users/${appData.ownerId}/projects/${appData.id}` : projectRoot(appData),
  };
}

function demoUrlForApp(appData) {
  return appData?.demoToken ? `${publicBaseUrl}/demo/${appData.id}/${appData.demoToken}/` : "";
}

function sanitizeAutopilotForClient(autopilot = {}) {
  const safe = {
    ...(autopilot || {}),
  };
  safe.log = Array.isArray(autopilot?.log)
    ? autopilot.log.filter((entry) => {
        const message = String(entry?.message || "");
        return message && !/^\s*Nota operativa/i.test(message) && !isTechnicalNarration(message);
      })
    : [];
  return safe;
}

function emptySddState() {
  return {
    specs: {
      sdd: "",
      requirements: "",
      architecture: "",
      tasks: "",
      memory: "",
    },
    steps: [],
    currentStep: null,
    filePaths: [],
  };
}

function formatOpenRouterError(err) {
  if (err?.name === "AbortError") {
    if (openRouterTimeoutMs > 0) {
      return `Timeout: ${Math.round(openRouterTimeoutMs / 1000)} secondi non sono bastati per completare la generazione con questo modello.`;
    }
    return "La richiesta e stata interrotta dal client o dalla connessione, non dal timeout interno di LocoCode.";
  }

  if (err instanceof Error) return err.message;
  return String(err);
}

async function readPreviewHtml(target) {
  const preview = await readProjectFile(target, "preview/index.html");
  if (preview.trim()) return preview;

  const rootIndex = await readProjectFile(target, "index.html");
  if (looksLikeStandaloneHtml(rootIndex)) return rootIndex;

  return target.html || "";
}

function previewPendingHtml(
  title = "Anteprima in preparazione",
  message = "Sara disponibile appena LocoCode avra creato i primi file dell'app.",
) {
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><style>body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:Inter,Arial,sans-serif;background:#f7f5ff;color:#343b4f}.box{text-align:center;padding:28px}.box h1{margin:0 0 10px;font-size:30px}.box p{margin:0;color:#697184;font-size:16px;line-height:1.5}</style></head><body><div class="box"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></div></body></html>`;
}

function looksLikeStandaloneHtml(value) {
  return /<!doctype html|<html[\s>]/i.test(value || "");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function readProjectFile(target, relPath) {
  const safe = normalizeSafePath(relPath);
  if (!safe) return "";

  try {
    return await fs.readFile(path.join(projectRoot(target), safe), "utf8");
  } catch {
    return "";
  }
}

async function writeProjectFile(target, relPath, content) {
  const safe = normalizeSafePath(relPath);
  if (!safe) throw new Error(`Percorso non sicuro: ${relPath}`);
  const targetPath = path.join(projectRoot(target), safe);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, content, "utf8");
}

async function listProjectFiles(root) {
  if (!(await exists(root))) return [];

  const results = [];
  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full).replaceAll("\\", "/");
      if (entry.isDirectory()) {
        if ([".git", ".venv", "venv", "node_modules", "dist", "build", "__pycache__", ".pytest_cache", ".mypy_cache", ".lococode_runtime"].includes(entry.name)) continue;
        await walk(full);
      } else {
        results.push(rel);
      }
    }
  }

  await walk(root);
  return results.sort((a, b) => a.localeCompare(b));
}

function userRoot(userId) {
  return path.join(usersDir, userId);
}

function userProjectsDir(userId) {
  return path.join(userRoot(userId), "projects");
}

function userAppsPath(userId) {
  return path.join(userRoot(userId), "apps.json");
}

function projectRoot(targetOrId) {
  const appId = typeof targetOrId === "object" ? targetOrId.id : String(targetOrId || "");
  const ownerId = typeof targetOrId === "object" ? targetOrId.ownerId : "";
  if (ownerId) return path.join(userProjectsDir(ownerId), appId);
  return path.join(projectsDir, appId);
}

function normalizeSafePath(relPath) {
  const normalized = String(relPath || "").replaceAll("\\", "/").trim();
  if (!normalized) return "";
  if (/^[a-zA-Z]:\//.test(normalized) || normalized.startsWith("/")) return "";
  const parts = normalized.split("/").filter(Boolean);
  if (!parts.length || parts.includes("..")) return "";
  if (parts.some((part) => [".git", ".venv", "venv", "node_modules", "dist", "build", "__pycache__", ".lococode_runtime"].includes(part))) return "";
  return parts.join("/");
}

function parseTaskList(tasksMarkdown) {
  if (!tasksMarkdown) return [];

  const steps = [];
  const lines = tasksMarkdown.split(/\r?\n/);
  let currentPhase = "";
  let currentPhaseNumber = 0;

  for (const line of lines) {
    const heading = line.match(/^\s*#{1,4}\s+(?<title>.+)$/);
    if (heading?.groups?.title && /fase|phase/i.test(heading.groups.title)) {
      currentPhase = cleanTaskHeading(heading.groups.title);
      currentPhaseNumber = Number((currentPhase.match(/fase\s+(\d+)/i) || [])[1] || currentPhaseNumber || 0);
      continue;
    }

    const match = line.match(/^\s*[-*]\s+\[(?<mark>[ xX])\]\s+(?<label>.+)$/);
    if (!match?.groups) continue;

    const rawLabel = match.groups.label
      .replace(/\*\*/g, "")
      .replace(/`/g, "")
      .replace(/\s+/g, " ")
      .trim();

    steps.push({
      id: `task-${steps.length + 1}`,
      label: rawLabel,
      done: match.groups.mark.toLowerCase() === "x",
      phase: currentPhase,
      phaseNumber: currentPhaseNumber,
    });
  }

  return steps;
}

function cleanTaskHeading(value) {
  return String(value || "")
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .replace(/[✓✔]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function getNextTaskLabel(target) {
  const step = target?.sdd?.steps?.find((item) => !item.done);
  return step?.label || "";
}

function titleFromPrompt(prompt) {
  const words = prompt.match(/[A-Za-zÀ-ÿ0-9]+/g) || ["LocoCode", "App"];
  return words
    .slice(0, 4)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function safeProjectName(name) {
  const cleaned = String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "nuovo-progetto-lococode";
}

function normalizeModelId(model) {
  const raw = String(model || "").trim();
  const lower = raw.toLowerCase();
  const aliases = {
    deepseek: "deepseek/deepseek-v4-pro",
    "deepseek pro": "deepseek/deepseek-v4-pro",
    "deepseek v4 pro": "deepseek/deepseek-v4-pro",
    kimi: "moonshotai/kimi-k2.6",
    "kimi k2.6": "moonshotai/kimi-k2.6",
    moonshot: "moonshotai/kimi-k2.6",
  };
  const normalized = aliases[lower] || raw || commonModels[0];
  return commonModels.includes(normalized) ? normalized : commonModels[0];
}

function truncate(value, maxChars) {
  const text = String(value || "");
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n\n[CONTESTO TAGLIATO]` : text;
}

async function exists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}
