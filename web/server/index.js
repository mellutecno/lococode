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
const portRegistryPath = path.join(dataDir, "port-registry.json");
const APPS_NGINX_DIR = "/etc/nginx/conf.d/lococode-apps";
const PORT_START = 19002;
const PORT_END = 19999;
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
const sharedOpenRouterKey = String(process.env.LOCOCODE_OPENROUTER_KEY || "").trim();

// Restituisce la chiave OpenRouter da usare: personale dell'utente oppure quella condivisa del server.
// La chiave condivisa è disponibile durante il trial (30gg dall'iscrizione) o se l'utente è abbonato.
function resolveApiKey(user, requestedKey = "") {
  const personal = String(requestedKey || user?.settings?.openrouterApiKey || "").trim();
  if (personal) return personal;
  if (!sharedOpenRouterKey) return "";
  const trialExpiresAt = user?.trialExpiresAt;
  const inTrial = !trialExpiresAt || new Date(trialExpiresAt) > new Date();
  return (inTrial || user?.subscribed === true) ? sharedOpenRouterKey : "";
}
const runningJobs = new Map();
const frontendBuilds = new Map();
const previewBuildTimers = new Map(); // debounce timer per incrementale live-preview

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
  const settings = await loadSettings(user);
  const trialExpiresAt = user.trialExpiresAt || null;
  const isSubscribed = user.subscribed === true;
  const trialDaysLeft = trialExpiresAt && !isSubscribed
    ? Math.max(0, Math.ceil((new Date(trialExpiresAt) - new Date()) / 86400000))
    : null;
  const hasPersonalKey = !!settings.openrouterApiKey;
  const sharedAvailable = !!sharedOpenRouterKey;
  const usingSharedKey = !hasPersonalKey && sharedAvailable && (isSubscribed || (trialDaysLeft === null ? false : trialDaysLeft > 0));
  res.json({
    ...settings,
    sharedKeyAvailable: sharedAvailable,
    usingSharedKey,
    trialDaysLeft,
    isSubscribed,
  });
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
  const apiKey = resolveApiKey(user, req.body.openrouterApiKey || settings.openrouterApiKey);
  const model = normalizeModelId(req.body.model || settings.defaultModel || commonModels[0]);

  if (!apiKey) {
    res.status(400).json({ ok: false, error: "API key non disponibile. Inseriscila nelle impostazioni o abbonati." });
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
    if (!target.appToken) target.appToken = target.demoToken || crypto.randomUUID();
    if (!target.lifecycle) target.lifecycle = "trial";
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

  // Avvia in background la build del frontend per app completate o parziali che non hanno ancora
  // il live build. Garantisce che dopo ogni riavvio del server le preview vengano ricostruite.
  for (const target of apps) {
    if (
      (target.status === "ready" || target.status === "partial") &&
      !target.autopilot?.running &&
      target.preview?.hasFrontend &&
      !target.preview?.hasLiveBuild
    ) {
      ensureFrontendPreviewBuild(target)
        .then(async (built) => {
          if (built) {
            const newPreview = await resolvePreviewState(target, target.files || []);
            newPreview.buildVersion = (target.preview?.buildVersion || 0) + 1;
            target.preview = newPreview;
            await saveApps(apps, user).catch(() => {});
            console.log(`[preview] Build in background completata per ${target.id} (${target.name})`);
          }
        })
        .catch(() => {});
    }
  }
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
  const apiKey = resolveApiKey(user, req.body.openrouterApiKey || settings.openrouterApiKey);

  if (!apiKey) {
    const trialExpired = user.trialExpiresAt && new Date(user.trialExpiresAt) < new Date();
    res.status(400).json({
      error: trialExpired
        ? "Il tuo trial di 30 giorni è scaduto. Abbonati per continuare a usare la chiave condivisa, oppure inserisci la tua API key OpenRouter nelle impostazioni."
        : "API key OpenRouter non disponibile. Inseriscila nelle impostazioni o riprova più tardi.",
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
      appToken: crypto.randomUUID(),
      lifecycle: "trial",
      trialExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
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

app.delete("/api/apps/:id", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const apps = await loadApps(user);
  const target = apps.find((item) => item.id === req.params.id);

  if (!target) {
    res.status(404).json({ error: "App non trovata." });
    return;
  }

  // Mark stop so any running job exits cleanly
  if (target.autopilot) {
    target.autopilot.stopRequested = true;
    target.autopilot.running = false;
  }

  // Remove from apps list and save
  const updatedApps = apps.filter((item) => item.id !== target.id);
  await saveApps(updatedApps, user);

  // Ferma backend e rimuove nginx
  await stopBackend(target.id).catch((e) => console.warn("[deploy] stopBackend:", e.message));

  // Elimina cartella progetto
  const root = projectRoot(target);
  try {
    await fs.rm(root, { recursive: true, force: true });
  } catch (err) {
    console.warn(`[server] Errore eliminando cartella ${root}:`, err.message);
  }

  res.json({ deleted: true, id: target.id });
});

app.post("/api/apps/:id/request-license", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const apps = await loadApps(user);
  const target = apps.find((item) => item.id === req.params.id);
  if (!target) { res.status(404).json({ error: "App non trovata." }); return; }

  const appUrl = appUrlForApp(target);
  const daysLeft = target.trialExpiresAt
    ? Math.max(0, Math.ceil((new Date(target.trialExpiresAt) - new Date()) / 86400000))
    : "N/A";

  const subject = `[LocoCode] Richiesta licenza: ${target.name}`;
  const body = [
    `Utente: ${user.email}`,
    `App: ${target.name} (${target.id})`,
    `URL: ${appUrl}`,
    `Giorni trial rimanenti: ${daysLeft}`,
    ``,
    `Per attivare la licenza permanente imposta lifecycle="active" in:`,
    `  data/users/${user.id}/apps.json`,
  ].join("\n");

  await sendAdminEmail(subject, body);

  target.licenseRequested = true;
  target.licenseRequestedAt = new Date().toISOString();
  await saveApps(apps, user);

  res.json({ ok: true, message: "Richiesta inviata. Sarai contattato a breve per l'attivazione della licenza permanente." });
});

async function sendAdminEmail(subject, text) {
  const adminEmail = process.env.LOCOCODE_ADMIN_EMAIL || "mellucciantonio@gmail.com";
  const smtpHost = process.env.SMTP_HOST;
  if (!smtpHost) {
    console.log(`[license] ${subject}\n${text}`);
    return;
  }
  const portValue = Number(process.env.SMTP_PORT || 587);
  const smtpUser = process.env.SMTP_USER || "";
  const smtpPass = process.env.SMTP_PASS || "";
  const from = process.env.SMTP_FROM || smtpUser || "noreply@lococode.local";
  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: portValue,
    secure: String(process.env.SMTP_SECURE || "").toLowerCase() === "true" || portValue === 465,
    auth: smtpUser && smtpPass ? { user: smtpUser, pass: smtpPass } : undefined,
  });
  await transporter.sendMail({ from, to: adminEmail, subject, text });
}

function trialExpiredHtml(appName = "") {
  const name = escapeHtml(appName || "Questa app");
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Trial scaduto · LocoCode</title><style>*{box-sizing:border-box;margin:0;padding:0}body{min-height:100vh;display:grid;place-items:center;font-family:Inter,system-ui,sans-serif;background:#0d1117;color:#e2e8f0}.card{background:#161b27;border:1px solid rgba(91,62,232,.25);border-radius:20px;padding:40px 36px;text-align:center;max-width:380px;box-shadow:0 0 0 1px rgba(91,62,232,.1),0 24px 64px rgba(0,0,0,.5)}.badge{display:inline-flex;align-items:center;gap:6px;background:rgba(220,38,38,.12);color:#f87171;border:1px solid rgba(220,38,38,.2);border-radius:99px;padding:4px 12px;font-size:12px;font-weight:600;margin-bottom:20px;letter-spacing:.5px}h1{font-size:20px;font-weight:700;margin-bottom:10px;color:#f1f5f9}p{font-size:14px;color:#94a3b8;line-height:1.65;margin-bottom:24px}.btn{display:inline-flex;align-items:center;gap:8px;background:linear-gradient(135deg,#5b3ee8,#7c5af0);color:#fff;text-decoration:none;padding:12px 24px;border-radius:10px;font-size:14px;font-weight:600;transition:opacity .2s}.btn:hover{opacity:.85}.footer{margin-top:16px;font-size:12px;color:#4b5563}</style></head><body><div class="card"><div class="badge">⏱ Trial scaduto</div><h1>${name}</h1><p>Il periodo di prova gratuito di questa app è terminato. Per continuare ad usarla richiedi una licenza permanente.</p><a class="btn" href="mailto:mellucciantonio@gmail.com?subject=Richiesta licenza LocoCode&body=Ciao, vorrei attivare la licenza permanente per l'app: ${name}">✉ Richiedi licenza</a><p class="footer">Generato con LocoCode · lococode.mellutecno.it</p></div></body></html>`;
}

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
  const apiKey = resolveApiKey(user, req.body.openrouterApiKey || settings.openrouterApiKey);

  if (!apiKey) {
    const trialExpired = user.trialExpiresAt && new Date(user.trialExpiresAt) < new Date();
    res.status(400).json({
      error: trialExpired
        ? "Il tuo trial è scaduto. Abbonati per continuare a usare la chiave condivisa, oppure inserisci la tua API key OpenRouter."
        : "API key OpenRouter non disponibile. Inseriscila nelle impostazioni.",
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
app.get("/apps/:id/:token", publicAppRequest);
app.get("/apps/:id/:token/*splat", publicAppRequest);
// URL pubblica leggibile: /apps/nome-app-a8f756 o /apps/nome-app-a8f756/*
app.get("/app/:slug", publicAppSlugRequest);
app.get("/app/:slug/*splat", publicAppSlugRequest);

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

  if (target.status === "ready") {
    // Backend attivo: il frontend puo girare con le API reali — servi il build compilato
    const builtFrontend = await ensureFrontendPreviewBuild(target);
    if (builtFrontend) {
      // Aggiorna preview state in modo che il polling del client rilevi il cambio
      const newPreview = await resolvePreviewState(target, target.files || []);
      if (!target.preview?.hasLiveBuild) {
        target.preview = newPreview;
        await saveApps(apps, user);
      }
      const staticPath = previewStaticPath(req.params.splat);
      const served = await serveFrontendBuildFile(target, staticPath, res);
      if (served) return;
    }
  } else {
    // Progetto ancora in costruzione — avvia build in background cosi e pronto al completamento.
    ensureFrontendPreviewBuild(target).catch(() => {});
  }

  // Fallback: wireframe statico generato dall'orchestrator, oppure pending card
  const html = await readPreviewHtml(target);
  if (!html) {
    const isActive = target?.autopilot?.running || target.status === "building";
    res.type("html").send(previewPendingHtml(
      target.name || "App in costruzione",
      isActive
        ? "LocoCode sta costruendo la tua app. L'anteprima live sara disponibile a completamento."
        : "Avvia o riprendi il progetto per continuare la generazione."
    ));
    return;
  }

  res.type("html").send(html);
}

async function publicAppRequest(req, res) {
  const found = await findPublicApp(req.params.id, req.params.token);
  if (!found) {
    res.status(404).type("html").send(previewPendingHtml("App non trovata", "Il link dell'app non e valido o non e piu attivo."));
    return;
  }

  const { user, apps, target } = found;
  await refreshProjectState(target);

  // Trial check — blocca accesso se scaduto e non attivo
  if (target.trialExpiresAt && target.lifecycle !== "active" && new Date(target.trialExpiresAt) < new Date()) {
    res.type("html").send(trialExpiredHtml(target.name));
    return;
  }

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
app.use(express.static(distDir, {
  etag: false,
  lastModified: false,
  setHeaders(res) {
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
  },
}));
app.use(async (_req, res, next) => {
  try {
    await fs.access(path.join(distDir, "index.html"));
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
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

    // Recupero wireframe: se manca preview/index.html (bug formato passato), generalo subito
    if (mode !== "initial") {
      const existingWireframe = await readProjectFile(target, "preview/index.html");
      if (!existingWireframe.toLowerCase().includes("<!doctype")) {
        appendOperationalLog(target, "Wireframe mancante — generazione in corso...");
        await generateWireframePreview({ target, apiKey, model, userPrompt });
        await refreshProjectState(target);
        target.preview = { ...target.preview, buildVersion: (target.preview?.buildVersion || 0) + 1 };
        await saveApps(apps, user);
      }
    }

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
      // Scaffolding iniziale completato: avvia prima build preview in background
      schedulePreviewBuild(target, apps, user, 6000);
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
      if (result.touched?.some(f => f.startsWith("frontend/"))) {
        schedulePreviewBuild(target, apps, user, 4000);
      }
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

      // Lovable-style: build incrementale in background ogni volta che il frontend cambia
      if (result.touched?.some(f => f.startsWith("frontend/"))) {
        schedulePreviewBuild(target, apps, user, 4000);
      }

      const stopReasonAfter = await shouldStopAutopilot(user, appId);
      if (stopReasonAfter) {
        await pauseAutopilot(target, apps, user, stopReasonAfter);
        return;
      }

      const afterTask = getNextTaskLabel(target);
      const afterDone = (target.sdd?.steps || []).filter((step) => step.done).length;
      if (afterTask === beforeTask && afterDone <= beforeDone) {
        stallCount += 1;
        if (stallCount === 1) {
          appendOperationalLog(
            target,
            `Attenzione: il task "${beforeTask}" non ha prodotto progressi visibili nel piano. Riprovo (tentativo ${stallCount}/2).`,
          );
        }
      } else {
        stallCount = 0;
      }

      if (stallCount >= 2) {
        throw new Error(
          `Il task "${beforeTask}" è bloccato: dopo 2 tentativi il modello non ha aggiornato .lc/spec/tasks.md né avanzato al task successivo. Verifica il progetto e riprendi manualmente.`,
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


// ─── Backend deploy helpers ────────────────────────────────

async function allocatePort(appId) {
  const registry = (await readJson(portRegistryPath)) || {};
  if (registry[appId]) return registry[appId];
  const used = new Set(Object.values(registry));
  let port = PORT_START;
  while (used.has(port) && port <= PORT_END) port++;
  if (port > PORT_END) throw new Error("Nessuna porta disponibile per il backend.");
  registry[appId] = port;
  await fs.writeFile(portRegistryPath, JSON.stringify(registry, null, 2), "utf8");
  return port;
}

async function releasePort(appId) {
  const registry = (await readJson(portRegistryPath)) || {};
  delete registry[appId];
  await fs.writeFile(portRegistryPath, JSON.stringify(registry, null, 2), "utf8");
}

async function writeAppNginxConf(target, port) {
  const token = target.appToken || target.demoToken || "";
  if (!token) return;
  await fs.mkdir(APPS_NGINX_DIR, { recursive: true });
  const lines = [
    `# App: ${target.name} (${target.id})`,
    `location /apps/${target.id}/${token}/api/ {`,
    `    proxy_pass http://127.0.0.1:${port}/;`,
    `    proxy_http_version 1.1;`,
    `    proxy_read_timeout 120s;`,
    `    proxy_set_header Host $host;`,
    `    proxy_set_header X-Real-IP $remote_addr;`,
    `    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`,
    `    proxy_set_header X-Forwarded-Proto $scheme;`,
    `}`,
  ];
  await fs.writeFile(
    path.join(APPS_NGINX_DIR, `${target.id}.conf`),
    lines.join("\n") + "\n",
    "utf8"
  );
}

async function removeAppNginxConf(appId) {
  await fs.rm(path.join(APPS_NGINX_DIR, `${appId}.conf`), { force: true });
}

async function reloadNginx() {
  try {
    await execFileAsync("nginx", ["-t"]);
    await execFileAsync("nginx", ["-s", "reload"]);
    console.log("[deploy] Nginx ricaricato.");
  } catch (err) {
    console.error("[deploy] nginx reload error:", err.message);
    throw err;
  }
}

async function deployBackend(target) {
  const root = projectRoot(target);
  const backendPath = path.join(root, "backend");
  const reqFile = path.join(backendPath, "requirements.txt");
  const mainFile = path.join(backendPath, "app", "main.py");

  if (!(await exists(reqFile)) || !(await exists(mainFile))) {
    console.log(`[deploy] Nessun backend per ${target.id}, skip.`);
    return null;
  }

  const port = await allocatePort(target.id);
  const venvPath = path.join(backendPath, "venv");
  const pm2Name = `lococode-app-${target.id}`;

  console.log(`[deploy] Build backend ${target.id} porta ${port}`);

  await execFileAsync("python3", ["-m", "venv", venvPath]);
  const pipBin = path.join(venvPath, "bin", "pip");
  await execFileAsync(pipBin, ["install", "--quiet", "--no-cache-dir", "-r", reqFile]);

  await execFileAsync("pm2", ["delete", pm2Name]).catch(() => {});
  const uvicornBin = path.join(venvPath, "bin", "uvicorn");
  await execFileAsync("pm2", [
    "start", uvicornBin,
    "--name", pm2Name,
    "--",
    "app.main:app",
    "--host", "127.0.0.1",
    "--port", String(port),
  ], { cwd: backendPath });
  await execFileAsync("pm2", ["save"]);

  await writeAppNginxConf(target, port);
  await reloadNginx();

  console.log(`[deploy] Backend ${target.id} attivo porta ${port}`);
  return port;
}

async function stopBackend(appId) {
  const pm2Name = `lococode-app-${appId}`;
  await execFileAsync("pm2", ["delete", pm2Name]).catch(() => {});
  await removeAppNginxConf(appId);
  await releasePort(appId);
  await reloadNginx().catch(() => {});
}

// ────────────────────────────────────────────────────────────

async function finishAutopilot(target, apps, user) {
  await refreshProjectState(target);
  const steps = target.sdd?.steps || [];
  const doneCount = steps.filter((step) => step.done).length;
  const now = new Date().toISOString();
  if (!target.appToken) target.appToken = target.demoToken || crypto.randomUUID();
  if (!target.lifecycle) target.lifecycle = "trial";
  const appUrl = appUrlForApp(target);
  appendOperationalLog(
    target,
    target.sdd?.currentStep
      ? `In pausa. Prossimo task: ${target.sdd.currentStep.label}.`
      : `App pronta: ${appUrl}`,
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
      : `Piano completato. App pronta: ${appUrl}`,
  );
  await saveApps(apps, user);

  // Avvia build del frontend in background: quando il polling rileva preview.hasLiveBuild=true
  // il client ricarica l'iframe mostrando la vera app React invece del wireframe.
  if (!target.sdd?.currentStep) {
    ensureFrontendPreviewBuild(target)
      .then(async (built) => {
        if (built) {
          target.preview = await resolvePreviewState(target, target.files || []);
          await saveApps(apps, user).catch(() => {});
        }
      })
      .catch(() => {});
  }
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
  // Avvia backend se tutti i task sono completati
  if (target.status === "ready") {
    deployBackend(target)
      .then((port) => {
        if (port) {
          target.backendPort = port;
          appendOperationalLog(target,
            `Backend avviato (porta ${port}). API disponibile su /apps/${target.id}/${target.appToken}/api/`);
        }
        return saveApps(apps, user);
      })
      .catch((err) => {
        console.error(`[deploy] Errore ${target.id}:`, err.message);
        appendOperationalLog(target, `Backend non avviato: ${err.message.slice(0, 200)}`);
        return saveApps(apps, user);
      });
  }
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

async function generateWireframePreview({ target, apiKey, model, userPrompt }) {
  try {
    const sdd = (await readProjectFile(target, ".lc/spec/sdd.md")).slice(0, 2000);
    const arch = (await readProjectFile(target, ".lc/spec/architecture.md")).slice(0, 1500);
    const wireframePrompt = `Genera una pagina HTML statica (preview/index.html) che mostri un'anteprima visiva realistica dell'app descritta qui sotto. È un mockup/wireframe da mostrare mentre l'app viene costruita.

Requisiti HTML:
- Pagina completa con CSS inline (niente file esterni)
- Design moderno, sfondo chiaro (#f8f9fa o bianco), testo scuro
- Mostra l'interfaccia principale dell'app con dati fittizi ma realistici (nomi, date, numeri inventati)
- Includi una barra di navigazione o header con il nome dell'app
- Mostra almeno una schermata significativa (lista, form, dashboard) con 3-5 elementi di esempio
- In basso: un badge discreto "🔨 In costruzione..." con sfondo giallo chiaro
- NO JavaScript complesso — solo HTML+CSS statici
- Ottimizzato per visualizzazione in iframe 400×600px

Specifiche app:
${sdd}

Architettura:
${arch}

Prompt originale: ${userPrompt}

Restituisci SOLO il file nel formato fenced code block:
\`\`\`preview/index.html
<!doctype html>
...
\`\`\``;

    const aiText = await callOpenRouter({
      apiKey,
      model,
      systemPrompt: "Sei un designer UI. Genera solo il blocco file richiesto, senza spiegazioni.",
      userPrompt: wireframePrompt,
      maxTokens: 2500,
      timeoutMs: openRouterTimeoutMs,
    });

    const ops = parseOperations(aiText);
    if (ops.length) {
      await applyOperations(target, ops);
    } else {
      // Fallback: estrai HTML grezzo dalla risposta o genera un wireframe minimale
      const htmlMatch = aiText.match(/<!doctype html[\s\S]*?<\/html>/i);
      const html = htmlMatch
        ? htmlMatch[0]
        : `<!doctype html><html lang="it"><head><meta charset="utf-8"><title>${target.name || "App"}</title><style>body{font-family:sans-serif;background:#f8f9fa;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;margin:0;color:#333}.card{background:#fff;border-radius:12px;padding:32px 40px;box-shadow:0 4px 24px rgba(0,0,0,.1);text-align:center;max-width:340px}.badge{margin-top:24px;padding:6px 14px;background:#fff9c4;border-radius:20px;font-size:.75rem;color:#666}</style></head><body><div class="card"><h2>${target.name || "App"}</h2><p style="color:#888;font-size:.9rem">La tua app è in costruzione</p><div class="badge">🔨 In costruzione...</div></div></body></html>`;
      await writeProjectFile(target, "preview/index.html", html);
    }
  } catch (err) {
    // Il wireframe è opzionale — non bloccare il build se fallisce
    appendOperationalLog(target, `Wireframe preview non generato: ${err?.message || err}`);
  }
}

async function runOrchestratorTurn({ target, apiKey, model, userPrompt, mode, onProgress, shouldStop }) {
  if (mode === "initial") {
    return runInitialOrchestration({ target, apiKey, model, userPrompt, onProgress, shouldStop });
  }

  const projectMemory = await loadProjectMemory(target);
  const nextTask = getNextTaskLabel(target);
  const systemPrompt = buildOrchestratorSystemPrompt();
  const steps = target.sdd?.steps || [];
  const completedCount = steps.filter((s) => s.done).length;
  const totalCount = steps.length;
  const root = projectRoot(target);
  const files = await listProjectFiles(root);
  const prompt = buildFollowupOrchestratorPrompt({ userPrompt, projectMemory, nextTask, mode, completedCount, totalCount, files });

  const aiText = await callOpenRouter({
    apiKey,
    model,
    systemPrompt,
    userPrompt: prompt,
    maxTokens: 12000,
    timeoutMs: openRouterTimeoutMs,
  });
  const operations = parseOperations(aiText);
  if (!operations.length) {
    throw new Error(
      enrichedErrorMessage(`Turn autopilot (task: ${nextTask || "sconosciuto"})`, aiText),
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
      phaseNum: 1,
      maxTokens: 10000,
      getPrompt: async () => buildInitialSpecsPrompt(userPrompt),
      expectedFiles: [".lc/spec/sdd.md", ".lc/spec/architecture.md", ".lc/spec/tasks.md", "README.md"],
    },
    {
      label: "parte server",
      phaseNum: 2,
      maxTokens: 12000,
      getPrompt: async () => buildInitialBackendPrompt(userPrompt, await loadProjectMemory(target)),
      expectedFiles: ["backend/app/main.py", "backend/requirements.txt", "backend/.env.example"],
    },
    {
      label: "interfaccia utente",
      phaseNum: 3,
      maxTokens: 14000,
      getPrompt: async () => buildInitialFrontendPrompt(userPrompt, await loadProjectMemory(target)),
      expectedFiles: ["frontend/src/App.jsx", "frontend/package.json", "preview/index.html"],
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
        enrichedErrorMessage(`Fase ${phase.phaseNum}/3 (${phase.label})`, aiText, phase.expectedFiles),
      );
    }

    const result = await applyOperations(target, operations);
    if (result.errors.length) {
      throw new Error(`Fase ${phase.phaseNum}/3 (${phase.label}): operazioni file non valide: ${result.errors.join("; ")}`);
    }

    touched.push(...result.created, ...result.updated);
    await refreshProjectState(target);
    target.updatedAt = new Date().toISOString();
    await onProgress?.(phase.label);

    // — Validazione output per fase (3.1) —
    if (phase.phaseNum === 1) {
      const tasksContent = await readProjectFile(target, ".lc/spec/tasks.md");
      const pendingCount = (tasksContent.match(/^\s*-\s*\[\s*\]/gm) || []).length;
      const archContent = (await readProjectFile(target, ".lc/spec/architecture.md")).trim();
      if (pendingCount < 3 || !archContent) {
        throw new Error(
          `Fase 1 incompleta: tasks.md contiene ${pendingCount} task aperti (minimo 3)${!archContent ? " e architecture.md è vuoto" : ""}. Riavvia il progetto o verifica il prompt.`,
        );
      }
      // Genera subito un wireframe visivo e lo mostra nell'anteprima
      appendOperationalLog(target, "Genero anteprima visiva dell'app...");
      await generateWireframePreview({ target, apiKey, model, userPrompt });
      await refreshProjectState(target);
      // Incrementa buildVersion: il client rileva il cambio nel polling (2.4s)
      // e ricarica l'iframe mostrando il wireframe appena scritto.
      target.preview = { ...target.preview, buildVersion: (target.preview?.buildVersion || 0) + 1 };
      await onProgress?.(phase.label);
    }

    if (phase.phaseNum === 2) {
      const mainPy = await readProjectFile(target, "backend/app/main.py");
      if (mainPy.length < 500) {
        appendOperationalLog(
          target,
          `Attenzione: backend/app/main.py è corto (${mainPy.length} chars). Il backend potrebbe essere incompleto.`,
        );
      }
    }

    if (phase.phaseNum === 3) {
      const previewHtml = await readProjectFile(target, "preview/index.html");
      if (!previewHtml.toLowerCase().includes("<!doctype")) {
        appendOperationalLog(target, "preview/index.html mancante o non valido — tentativo recovery...");
        const recoveryText = await callOpenRouter({
          apiKey,
          model,
          systemPrompt,
          userPrompt: `La fase 3 non ha prodotto preview/index.html valido. Restituisci SOLO il file preview/index.html con una pagina HTML completa funzionante che mostri l'interfaccia dell'app.\n\nMemoria:\n${await loadProjectMemory(target)}`,
          maxTokens: 3000,
          timeoutMs: openRouterTimeoutMs,
        });
        const recoveryOps = parseOperations(recoveryText);
        if (recoveryOps.length) {
          const recoveryResult = await applyOperations(target, recoveryOps);
          touched.push(...recoveryResult.created, ...recoveryResult.updated);
          await refreshProjectState(target);
        }
      }
    }

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
    summary: `Piano creato e prima versione generata. ${summarizeTouchedFiles([...new Set(touched)])}.`,
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
  if (phase.includes("server") || phase.includes("backend") || phase.includes("deploy")) return "Sto preparando la parte server dell'app.";
  if (phase.includes("interfaccia") || phase.includes("frontend")) return "Sto costruendo l'interfaccia utente reale.";

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

function enrichedErrorMessage(label, aiText, expectedFiles = []) {
  const len = (aiText || "").length;
  const preview = (aiText || "").slice(0, 300).replace(/\n/g, " ").trim();
  const expected = expectedFiles.length ? `\nAttesi: ${expectedFiles.join(", ")}.` : "";
  return `${label}: il modello ha risposto con ${len} caratteri ma senza blocchi file applicabili.${expected}\nRisposta (inizio): "${preview || "(vuota)"}"`;
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
    "- Ogni progetto deve avere un flusso attivazione: chiave di avvio precaricata, pulsante 'Abbonati' o 'Attiva licenza', e gestione chiave definitiva mensile.",
    "- Non proporre Render, Netlify, Vercel, Firebase o servizi esterni: il prodotto deve girare sul server LocoCode, dentro la cartella del progetto dell'utente.",
    "- Il backend deve esporre API avviabili sul server e il frontend deve poter usare una URL API configurabile con VITE_API_URL.",
    "- Il database deve stare nella cartella del progetto, preferibilmente SQLite. Precarica dati di esempio realistici.",
    "- Se l'app prevede accesso utenti, crea credenziali di prova fittizie documentate nel README, mai credenziali reali.",
    "- Se l'app richiede API esterne, crea una schermata Impostazioni/Chiavi API per inserirle. Senza chiave mostra dati di esempio, non errori tecnici. Documenta le chiavi in deploy/lococode.json.",
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

function detectDomain(prompt) {
  const p = prompt.toLowerCase();
  if (/medic|dentist|pazient|clinica|cura|terapia/.test(p)) return "medical";
  if (/contabil|fiscale|fattur|commercialist|scadenz|tribut|bilancio/.test(p)) return "finance";
  if (/crm|pipeline|lead|commerciale|vendite|prospect/.test(p)) return "crm";
  if (/e-commerce|ecommerce|negozio|prodotto|carrello|ordine|spedizione/.test(p)) return "ecommerce";
  return "generic";
}

function domainInstructions(domain) {
  switch (domain) {
    case "medical": return "Gestisce processi amministrativi e clinici. NON dare diagnosi o consigli medici. Include: pazienti, appuntamenti, preventivi, pagamenti.";
    case "finance": return "Gestisce dati contabili e fiscali. Includi: scadenziari, report export, fatture/ricevute, clienti, IVA e F24.";
    case "crm": return "Gestisce pipeline commerciale, contatti, attivita e report. Includi: stati lead, filtri commerciale, preventivi, storico comunicazioni.";
    case "ecommerce": return "Gestisce catalogo, ordini, clienti e spedizioni. Includi: dashboard vendite, magazzino, stato ordini, listino prezzi.";
    default: return "";
  }
}

function buildInitialSpecsPrompt(initialPrompt) {
  const domain = detectDomain(initialPrompt);
  const domainHint = domainInstructions(domain);

  return [
    "Richiesta iniziale utente:",
    initialPrompt,
    "",
    "FASE 1/3 - Specifiche SDD.",
    "Genera solo documenti di progetto e piano operativo. Non generare ancora codice applicativo.",
    ...(domainHint ? ["", `Contesto di dominio (${domain}): ${domainHint}`] : []),
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
    "REQUISITI STRUTTURA: .lc/spec/tasks.md deve avere tra 12 e 20 task [ ] divisi in 3-4 sezioni.",
    "Formato OBBLIGATORIO per i task — usa numerazione gerarchica senza prefissi T/Task:",
    "## Fase 1 - Setup e Configurazione",
    "- [ ] 1.1 Descrizione del task",
    "- [ ] 1.2 Descrizione del task",
    "## Fase 2 - Backend e Database",
    "- [ ] 2.1 Descrizione del task",
    "...",
    "NON usare: T1/T2/T19, Task-1, #1, bullet senza numero. Solo numerazione 1.1/1.2/2.1/2.2 etc.",
    "- .lc/spec/sdd.md: 1) Descrizione progetto, 2) Utenti e ruoli, 3) Funzionalita principali, 4) Vincoli tecnici, 5) Flusso principale utente.",
    "- .lc/spec/architecture.md: tabelle SQLite con colonne e tipi, endpoint FastAPI con metodo/path/payload, componenti React principali.",
    "Il piano deve includere: link finale dell'app, chiave di avvio iniziale, flusso abbonamento mensile, gestione scadenza chiave.",
    "Se servono API esterne, pianifica una schermata Impostazioni per inserire le chiavi. Senza chiave l'app mostra dati di esempio funzionanti.",
    "Marca completati solo i task di specifica realmente coperti in questa fase.",

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
    "backend/app/main.py deve includere FastAPI con CORS (allow_origins=['*']), endpoint GET / health check, modelli Pydantic completi, inizializzazione SQLite con tabelle e dati di esempio realistici precaricati al primo avvio, e API CRUD complete coerenti con il progetto.",
    "deploy/lococode.json deve descrivere nome servizio, porta suggerita, comando backend, comando build frontend, percorso SQLite, credenziali di prova, chiave provvisoria, chiave di attivazione mensile e API esterne richieste.",
    "Il backend deve gestire una chiave di attivazione iniziale precaricata e predisporre una chiave definitiva con scadenza mensile per l'abbonamento.",
    "Se sono necessarie API esterne, crea endpoint SQLite per salvare le chiavi. Se mancano, restituisci dati di esempio e messaggi chiari, non errori bloccanti.",
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
    "FASE 3/3 - Frontend React e interfaccia utente.",
    "Usa la memoria SDD qui sotto e genera il frontend MVP completo.",
    "",
    "Memoria progetto:",
    projectMemory,
    "",
    "File obbligatori da restituire:",
    "- frontend/package.json",
    "- frontend/index.html",
    "- frontend/tailwind.config.js",
    "- frontend/postcss.config.js",
    "- frontend/src/App.jsx",
    "- frontend/src/index.css (con @tailwind base/components/utilities + @import Inter + variabili CSS)",
    "- preview/index.html (fallback, non sostituisce il frontend reale)",
    "- .lc/spec/tasks.md",
    "- .lc/memory/project_context.md",
    "",
    "Il frontend deve essere in italiano, gestionale, responsive, navigabile e con dati di prova realistici ma fittizi.",
    "L'utente deve poter provare l'MVP come prodotto: pagine principali, pulsanti, form e routing devono funzionare nella preview reale.",
    "Il frontend deve mostrare un'area 'Attivazione' o 'Abbonamento' con lo stato della licenza corrente e un pulsante per abbonarsi o attivare la chiave definitiva.",
    "Se l'app usa API esterne, il frontend deve avere una schermata Impostazioni/Chiavi API dove inserire la chiave; senza chiave mostra dati di esempio funzionanti, non si ferma.",
    "FONDAMENTALE - Chiamate API: usa SEMPRE const API = import.meta.env.VITE_API_URL || ''; poi chiama fetch(API + '/endpoint'). Non scrivere mai localhost, 127.0.0.1 o porte hardcoded. VITE_API_URL viene iniettato da LocoCode al build e punta al backend reale.",
    "preview/index.html serve solo da fallback statico se il frontend vero non e ancora pronto.",
    "",
    "QUALITA' VISIVA OBBLIGATORIA — il frontend DEVE avere un design professionale e curato, stile Vercel/Linear/Notion. Un utente DEVE volerla usare subito senza modifiche.",
    "USA TAILWIND CSS con classi utilitarie direttamente nei JSX. Ogni componente deve avere classi Tailwind complete e dettagliate.",
    "STRUTTURA VISIVA OBBLIGATORIA:",
    "- Sfondo pagina: bg-slate-50 o bg-gray-50. Card contenuto: bg-white rounded-xl shadow-sm border border-slate-200 p-6.",
    "- Layout: flex con sidebar sinistra fissa (w-56 o w-64) bg-white border-r border-slate-200, contenuto principale flex-1 overflow-auto p-6.",
    "- Sidebar: logo + nome app in alto (font-bold text-indigo-600), voci menu con icone lucide-react, active state bg-indigo-50 text-indigo-700 font-medium, hover:bg-slate-50.",
    "- Tipografia: font-family Inter via @import in index.css. Titoli text-xl font-bold text-slate-900. Sottotitoli text-sm text-slate-500. Corpo text-sm text-slate-700.",
    "- Pulsanti primari: bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-4 py-2 rounded-lg transition-colors. Secondari: border border-slate-300 hover:bg-slate-50.",
    "- Input/select: w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent.",
    "- Tabelle: thead bg-slate-50 testo text-xs font-semibold text-slate-500 uppercase tracking-wider. Righe hover:bg-slate-50. Bordi divide-y divide-slate-200.",
    "- Badge: inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold. Verde: bg-green-100 text-green-800. Rosso: bg-red-100 text-red-800. Giallo: bg-yellow-100 text-yellow-800. Grigio: bg-slate-100 text-slate-600.",
    "- KPI dashboard: grid grid-cols-2 md:grid-cols-4 gap-4. Ogni card: bg-white rounded-xl p-4 border border-slate-200. Numero: text-2xl font-bold text-indigo-600. Label: text-xs text-slate-500 uppercase.",
    "- Almeno 5 sezioni navigabili con dati fittizi realistici, non placeholder generici.",
    "- Microinterazioni: transition-colors su tutti i pulsanti/link, cursor-pointer, ring su focus, hover su righe tabella.",
    "- Importa font Inter in index.css: @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap'); body { font-family: 'Inter', system-ui, sans-serif; }",
    "",
    "DIPENDENZE OBBLIGATORIE - frontend/package.json deve contenere ESATTAMENTE queste dipendenze e nient'altro:",
    "  dependencies: { \"react\": \"^18\", \"react-dom\": \"^18\", \"lucide-react\": \"^0.400.0\" }",
    "  devDependencies: { \"@vitejs/plugin-react\": \"^4\", \"vite\": \"^5\", \"tailwindcss\": \"^3\", \"autoprefixer\": \"^10\", \"postcss\": \"^8\" }",
    "DEVI SEMPRE includere tailwind.config.js, postcss.config.js e @tailwind base/components/utilities in src/index.css.",
    "LIBRERIE VIETATE — non aggiungere mai a dependencies: @heroicons/react, @headlessui/react, @radix-ui/*, framer-motion, react-router-dom, react-router, recharts, chart.js, date-fns, moment, lodash, axios, react-query, @tanstack/*, zustand, jotai, redux.",
    "ICONE: usa SOLO lucide-react. NON importare @heroicons/react o qualsiasi altro pacchetto icone. lucide-react e gia installato e disponibile.",
    "PER LA NAVIGAZIONE: usa React useState per mostrare/nascondere sezioni (es. setPage('clienti')), non react-router.",
    "PER LE DATE: usa new Date().toLocaleDateString('it-IT') nativo, non date-fns.",
    "PER I GRAFICI: usa SVG inline o barre CSS pure, non recharts o chart.js.",
    "PER LE CHIAMATE API: usa fetch() nativo del browser, non axios.",
    "lucide-react e gia disponibile come alias del server e puo essere importato normalmente.",
    "Aggiorna il piano dei task completati in questa fase.",
    "Restituisci solo blocchi file.",
  ].join("\n");
}

function groupFilesByPrefix(files) {
  const groups = {};
  for (const f of files) {
    const parts = f.split("/");
    const prefix = parts.length > 1 ? parts[0] : "(root)";
    (groups[prefix] = groups[prefix] || []).push(f);
  }
  return Object.entries(groups)
    .map(([prefix, list]) => "  " + prefix + "/\n" + list.map((f) => "    " + f).join("\n"))
    .join("\n");
}

function buildFollowupOrchestratorPrompt({ userPrompt, projectMemory, nextTask, mode, completedCount, totalCount, files }) {
  const taskSection =
    mode === "continue"
      ? "## Task corrente\n" + (nextTask || "completa il prossimo passo tecnico utile dal piano tasks.md")
      : "## Richiesta utente\n" + userPrompt;

  const avanzamentoSection =
    mode === "continue" && typeof completedCount === "number" && typeof totalCount === "number"
      ? `\n\n## Avanzamento\n${completedCount} completati su ${totalCount} — ${totalCount - completedCount} rimanenti`
      : "";

  const fileSection =
    files && files.length
      ? `\n\n## File già presenti nel progetto (non ricreare, modifica se necessario)\n${groupFilesByPrefix(files)}`
      : "";

  return [
    taskSection + avanzamentoSection + fileSection,
    "",
    "## Contesto del progetto",
    projectMemory,
    "",
    "## Istruzioni",
    "- Completa SOLO il task corrente indicato sopra. Non anticipare task futuri.",
    "- Aggiorna .lc/spec/tasks.md: marca [x] SOLO il task corrente, NON i task futuri.",
    "- Aggiorna sempre .lc/memory/project_context.md con una nota breve su cosa hai fatto.",
    "- Non ripartire da zero. Modifica solo i file necessari.",
    "- Se il task richiede backend, aggiorna backend/app/main.py e requirements.txt.",
    "- Se il task cambia la UI, aggiorna frontend/src/ e i file coinvolti.",
    "- Aggiorna preview/index.html solo come fallback statico se il frontend reale non e ancora pronto.",
    "- QUALITA' VISIVA: se il task riguarda la UI o il frontend, mantieni il design professionale gia stabilito (Tailwind CSS, card bg-white rounded-xl shadow-sm, sidebar con voci menu e icone lucide-react, badge colorati, tabelle con thead stilizzato, KPI card con numeri grandi). Non degradare mai il livello visivo. USA classi Tailwind complete nei JSX.",
    "- LIBRERIE VIETATE: non aggiungere mai @heroicons/react, @headlessui/react, @radix-ui/*, recharts, chart.js, react-router-dom, date-fns, axios, lodash. Usa SOLO lucide-react per le icone.",
    "- Mantieni sempre funzionante il link finale: se una chiave API esterna manca, usa dati di prova, non errori.",
    "- Mantieni il flusso attivazione -> abbonamento mensile.",
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
  const hasWireframe = files.includes("preview/index.html");

  // Preserva buildVersion. Se il wireframe esiste ma il client non l'ha mai visto
  // (buildVersion === 0), porta automaticamente a 1: il polling rileverà il cambio
  // e ricaricherà l'iframe mostrando il wireframe — funziona anche per progetti già in corso.
  const existingVersion = target.preview?.buildVersion || 0;
  const buildVersion = existingVersion === 0 && (hasWireframe || hasLiveBuild) ? 1 : existingVersion;

  return {
    mode: hasLiveBuild ? "frontend" : "fallback",
    hasFrontend,
    hasLiveBuild,
    url: `/api/apps/${target.id}/live-preview/`,
    fallbackUrl: `/api/apps/${target.id}/preview`,
    updatedAt: hasLiveBuild ? await fileMtimeIso(frontendDistIndex) : "",
    buildVersion,
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
      appendOperationalLog(target, "Interfaccia in costruzione. LocoCode la aggiornera appena il frontend sara completo.");
      return false;
    })
    .finally(() => {
      frontendBuilds.delete(key);
    });

  frontendBuilds.set(key, buildJob);
  return buildJob;
}

/**
 * Schedula una build incrementale della preview (debounced).
 * Ogni volta che file frontend vengono scritti durante l'autopilot, questa
 * funzione viene chiamata: aspetta delayMs dopo l'ultimo file scritto e poi
 * lancia la build in background. Quando finisce incrementa preview.buildVersion
 * cosi il client rileva il cambiamento e ricarica l'iframe.
 */
function schedulePreviewBuild(target, apps, user, delayMs = 4000) {
  const key = target.id;
  if (previewBuildTimers.has(key)) clearTimeout(previewBuildTimers.get(key));
  const timer = setTimeout(async () => {
    previewBuildTimers.delete(key);
    try {
      const built = await ensureFrontendPreviewBuild(target);
      if (built) {
        const newPreview = await resolvePreviewState(target, target.files || []);
        newPreview.buildVersion = (target.preview?.buildVersion || 0) + 1;
        target.preview = newPreview;
        await saveApps(apps, user);
        console.log(`[preview] Build incrementale v${newPreview.buildVersion} pronta per ${target.id}`);
      }
    } catch (err) {
      console.warn(`[preview] Build incrementale fallita per ${target.id}: ${err instanceof Error ? err.message : err}`);
    }
  }, delayMs);
  previewBuildTimers.set(key, timer);
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
    define: {
      "import.meta.env.VITE_API_URL": JSON.stringify(
        `/apps/${target.id}/${target.appToken || target.demoToken || ""}/api`
      ),
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

  // --- Patch file di configurazione mancanti (sempre, anche se npm install e gia aggiornato) ---

  // Auto-crea postcss.config.js se mancante (necessario per Tailwind nel build Vite in-process)
  const postcssConfigPath = path.join(frontendDirPath, "postcss.config.js");
  if (!(await exists(postcssConfigPath))) {
    await fs.writeFile(
      postcssConfigPath,
      `module.exports = {\n  plugins: {\n    tailwindcss: {},\n    autoprefixer: {},\n  },\n};\n`,
      "utf8",
    );
    console.log(`[build] Auto-creato postcss.config.js per ${path.basename(frontendDirPath)}`);
  }

  // Auto-crea tailwind.config.js se mancante
  const tailwindConfigPath = path.join(frontendDirPath, "tailwind.config.js");
  if (!(await exists(tailwindConfigPath))) {
    await fs.writeFile(
      tailwindConfigPath,
      `/** @type {import('tailwindcss').Config} */\nmodule.exports = {\n  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],\n  theme: { extend: {} },\n  plugins: [],\n};\n`,
      "utf8",
    );
    console.log(`[build] Auto-creato tailwind.config.js per ${path.basename(frontendDirPath)}`);
  }

  // Assicura che src/index.css abbia le direttive @tailwind
  const indexCssPath = path.join(frontendDirPath, "src", "index.css");
  try {
    const cssContent = await fs.readFile(indexCssPath, "utf8").catch(() => "");
    if (!cssContent.includes("@tailwind")) {
      const tailwindDirectives = "@tailwind base;\n@tailwind components;\n@tailwind utilities;\n\n";
      await fs.writeFile(indexCssPath, tailwindDirectives + cssContent, "utf8");
      console.log(`[build] Auto-aggiunte direttive @tailwind a src/index.css per ${path.basename(frontendDirPath)}`);
    }
  } catch {}

  // --- Patch package.json (sempre, prima di decidere se reinstallare) ---

  // Auto-inject dipendenze essenziali mancanti nel package.json (tailwind ecc.)
  let pkgPatched = false;
  try {
    const pkgRaw = await fs.readFile(packageJsonPath, "utf8");
    const pkg = JSON.parse(pkgRaw);
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    const required = { tailwindcss: "^3.4.0", autoprefixer: "^10.4.0", postcss: "^8.4.0" };
    for (const [name, version] of Object.entries(required)) {
      if (!allDeps[name]) {
        pkg.devDependencies = pkg.devDependencies || {};
        pkg.devDependencies[name] = version;
        pkgPatched = true;
      }
    }

    // Auto-rileva import di pacchetti mancanti (es. @heroicons/react) e aggiungili prima dell'install
    const srcDir = path.join(frontendDirPath, "src");
    const safeAutoInstall = {
      "@heroicons/react": "^2.1.0",
      "react-hot-toast": "^2.4.1",
      "clsx": "^2.1.0",
    };
    const srcFiles = await fs.readdir(srcDir).catch(() => []);
    for (const file of srcFiles) {
      if (!/\.(jsx?|tsx?)$/.test(file)) continue;
      const content = await fs.readFile(path.join(srcDir, file), "utf8").catch(() => "");
      const updatedDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      for (const [pkgName, pkgVersion] of Object.entries(safeAutoInstall)) {
        if (!updatedDeps[pkgName] && (content.includes(`"${pkgName}"`) || content.includes(`'${pkgName}'`))) {
          pkg.dependencies = pkg.dependencies || {};
          pkg.dependencies[pkgName] = pkgVersion;
          updatedDeps[pkgName] = pkgVersion;
          pkgPatched = true;
          console.log(`[build] Auto-aggiunto ${pkgName} (trovato negli import) per ${path.basename(frontendDirPath)}`);
        }
      }
    }

    if (pkgPatched) {
      await fs.writeFile(packageJsonPath, JSON.stringify(pkg, null, 2), "utf8");
      console.log(`[build] package.json aggiornato con dipendenze auto-rilevate per ${path.basename(frontendDirPath)}`);
    }
  } catch {}

  // --- Controllo se npm install e necessario ---
  // Ricalcola packageMtime dopo eventuali patch (pkgPatched invalida il marker)
  const packageMtime = await fileMtimeMs(packageJsonPath);
  const marker = await readJson(markerPath);
  // Verifica anche che tailwindcss sia davvero installato (il marker potrebbe essere stale)
  const tailwindInstalled = await exists(path.join(nodeModulesPath, "tailwindcss", "lib", "index.js"));
  const needsInstall =
    pkgPatched ||
    !(await exists(nodeModulesPath)) ||
    marker?.packageMtime !== packageMtime ||
    !tailwindInstalled;

  if (!needsInstall) return;

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
  await fs.writeFile(markerPath, JSON.stringify({ packageMtime: await fileMtimeMs(packageJsonPath), installedAt: new Date().toISOString() }, null, 2), "utf8");
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

  const budgets = [
    { path: ".lc/spec/sdd.md",              max: 4000 },
    { path: ".lc/spec/requirements.md",      max: 4000 },
    { path: ".lc/spec/architecture.md",      max: 6000 },
    { path: ".lc/memory/project_context.md", max: 4000, tail: true },
    { path: ".lc/spec/tasks.md",             max: 5000, tasksOnly: true },
    { path: "README.md",                     max: 2000 },
  ];

  const chunks = [];
  for (const entry of budgets) {
    let fileContent = await readProjectFile(target, entry.path);
    if (!fileContent.trim()) continue;

    if (entry.tasksOnly) {
      const lines = fileContent.split(/\r?\n/);
      const pending = lines.filter((l) => /^\s*-\s*\[\s*\]/.test(l));
      const done = lines.filter((l) => /^\s*-\s*\[[xX]\]/.test(l));
      const headings = lines.filter((l) => /^\s*#+/.test(l));
      fileContent = [...headings, "### Task completati (ultimi 3)", ...done.slice(-3), "### Task da completare", ...pending].join("\n");
    } else if (entry.tail) {
      if (fileContent.length > entry.max) fileContent = fileContent.slice(-entry.max);
    }

    chunks.push("--- FILE: " + entry.path + " ---\n" + truncate(fileContent, entry.max));
  }

  const fileListStr = files.join("\n") || "Nessun file ancora.";
  chunks.push("--- FILE LIST (non ricreare, modifica se necessario) ---\n" + truncate(fileListStr, 2000));

  return truncate(chunks.join("\n\n"), 30000);
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

async function callOpenRouterOnce({
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
        temperature: 0.45,
      }),
    });

    const httpStatus = response.status;
    const raw = await response.text();
    if (!response.ok) {
      const err = new Error(`HTTP ${httpStatus}: ${raw.slice(0, 600)}`);
      err.httpStatus = httpStatus;
      throw err;
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

async function callOpenRouter(params) {
  const maxAttempts = 3;
  let lastErr;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      const delayMs = Math.pow(2, attempt) * 4000; // 8s, 16s
      console.warn(`[server] callOpenRouter retry ${attempt}/${maxAttempts - 1} dopo ${delayMs / 1000}s (${lastErr?.message?.slice(0, 80)})`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    try {
      return await callOpenRouterOnce(params);
    } catch (err) {
      if (err?.name === "AbortError") throw err; // timeout — no retry
      if (err?.httpStatus && err.httpStatus < 429) throw err; // 400/401/403 — no retry
      lastErr = err;
    }
  }
  throw lastErr;
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
    trialExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    subscribed: false,
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

async function findPublicApp(appId, token) {
  const cleanId = String(appId || "").trim();
  const cleanToken = String(token || "").trim();
  if (!cleanId || !cleanToken) return null;

  const store = await loadUsersStore();
  for (const user of store.users || []) {
    const apps = await loadApps(user);
    const target = apps.find((item) => item.id === cleanId && (item.appToken || item.demoToken) === cleanToken);
    if (target) return { user, apps, target };
  }

  return null;
}

async function findPublicAppBySlug(slug) {
  const cleanSlug = String(slug || "").trim().toLowerCase();
  if (!cleanSlug) return null;

  const store = await loadUsersStore();
  for (const user of store.users || []) {
    const apps = await loadApps(user);
    const target = apps.find((item) => {
      // Controlla publicSlug salvato o lo ricalcola al volo
      const itemSlug = item.publicSlug || appPublicSlug(item);
      return itemSlug === cleanSlug;
    });
    if (target) return { user, apps, target };
  }

  return null;
}

async function publicAppSlugRequest(req, res) {
  const { slug } = req.params;
  const found = await findPublicAppBySlug(slug);
  if (!found) {
    res.status(404).type("html").send(previewPendingHtml("App non trovata", "Il link dell'app non è valido o l'app non esiste più."));
    return;
  }

  const { user, apps, target } = found;
  await refreshProjectState(target);

  if (target.trialExpiresAt && target.lifecycle !== "active" && new Date(target.trialExpiresAt) < new Date()) {
    res.type("html").send(trialExpiredHtml(target.name));
    return;
  }

  const builtFrontend = await ensureFrontendPreviewBuild(target);
  if (builtFrontend) target.preview = await resolvePreviewState(target, target.files || []);
  await saveApps(apps, user);

  const staticPath = previewStaticPath(req.params.splat);
  const served = await serveFrontendBuildFile(target, staticPath, res);
  if (served) return;

  const html = await readPreviewHtml(target);
  if (!html) {
    res.type("html").send(previewPendingHtml(target.name || "App in costruzione", "L'app è in costruzione. L'anteprima sarà disponibile a breve."));
    return;
  }
  res.type("html").send(html);
}

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

function publicApp(appData) {
  const appToken = appData.appToken || appData.demoToken || "";
  const appUrl = appUrlForApp({ ...appData, appToken });
  const safe = {
    ...appData,
    appToken,
  };
  delete safe.ownerId;
  delete safe.demoToken;
  delete safe.appToken;

  const trialExpiresAt = appData.trialExpiresAt || null;
  const isActive = appData.lifecycle === "active";
  const trialDaysLeft = trialExpiresAt && !isActive
    ? Math.max(0, Math.ceil((new Date(trialExpiresAt) - new Date()) / 86400000))
    : null;

  return {
    ...safe,
    lifecycle: appData.lifecycle || "trial",
    trialExpiresAt,
    trialDaysLeft,
    licenseRequested: appData.licenseRequested || false,
    appUrl,
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

function slugifyAppName(name) {
  return String(name || "app")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")  // rimuove diacritici (à→a, è→e ecc.)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "app";
}

function appPublicSlug(appData) {
  if (appData.publicSlug) return appData.publicSlug;
  const token = appData.appToken || appData.demoToken || "";
  const shortCode = token.replace(/-/g, "").slice(0, 6);
  if (!shortCode) return "";
  return `${slugifyAppName(appData.name)}-${shortCode}`;
}

function appUrlForApp(appData) {
  const slug = appPublicSlug(appData);
  return slug ? `${publicBaseUrl}/app/${slug}` : "";
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
  title = "App in costruzione",
  message = "LocoCode sta generando backend, database e interfaccia.",
) {
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><style>*{box-sizing:border-box;margin:0;padding:0}body{min-height:100vh;display:grid;place-items:center;font-family:Inter,system-ui,sans-serif;background:#f8f9fb;color:#1e293b}.card{background:#fff;border:1px solid #e8eaf0;border-radius:16px;padding:32px 28px;text-align:center;max-width:320px;box-shadow:0 2px 16px rgba(15,23,42,.07)}.icon{width:48px;height:48px;background:linear-gradient(135deg,#6366f1,#8b5cf6);border-radius:12px;display:grid;place-items:center;margin:0 auto 18px}.icon svg{width:24px;height:24px;fill:none;stroke:#fff;stroke-width:2;stroke-linecap:round}h1{font-size:17px;font-weight:700;margin-bottom:8px;color:#0f172a}p{font-size:13px;color:#64748b;line-height:1.6;margin-bottom:20px}.dots{display:inline-flex;gap:6px}.dots span{width:7px;height:7px;border-radius:50%;background:#6366f1;animation:p 1.2s ease-in-out infinite}.dots span:nth-child(2){animation-delay:.2s}.dots span:nth-child(3){animation-delay:.4s}@keyframes p{0%,80%,100%{opacity:.2;transform:scale(.8)}40%{opacity:1;transform:scale(1)}}</style></head><body><div class="card"><div class="icon"><svg viewBox="0 0 24 24"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg></div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><div class="dots"><span></span><span></span><span></span></div></div></body></html>`;
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
