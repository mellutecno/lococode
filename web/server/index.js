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
import { getDesignSystemFiles, DESIGN_SYSTEM_PROMPT_SECTION } from "./designSystem.js";

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
const openRouterTimeoutMs = Number(process.env.OPENROUTER_TIMEOUT_MS || 0); // 0 = nessun timeout
const usersPath = path.join(dataDir, "users.json");
const authSecret = process.env.LOCOCODE_AUTH_SECRET || "lococode-local-auth-secret";
const loginTokenTtlMs = Number(process.env.LOCOCODE_LOGIN_TOKEN_TTL_MS || 24 * 60 * 60 * 1000);
const sessionTtlMs = Number(process.env.LOCOCODE_SESSION_TTL_MS || 30 * 24 * 60 * 60 * 1000);
const heartbeatTimeoutMs = Number(process.env.LOCOCODE_HEARTBEAT_TIMEOUT_MS || 2 * 60 * 1000);
const publicBaseUrl = String(process.env.LOCOCODE_PUBLIC_URL || "https://lococode.mellutecno.it").replace(/\/$/, "");
const sharedOpenRouterKey = String(process.env.LOCOCODE_OPENROUTER_KEY || "").trim();
// Trial PER-APP (dopo pagamento €1.99 l'utente puo' usare l'app per N giorni;
// scaduto deve abbonarsi o acquistare). Default 1 giorno, configurabile via env.
// Trial PER-UTENTE (account-level, accesso a chiavi condivise) resta 30gg.
const appTrialDays = Number(process.env.LOCOCODE_APP_TRIAL_DAYS || 1);
const appTrialMs = appTrialDays * 24 * 60 * 60 * 1000;

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

// Modelli OpenRouter curati — i piu' famosi e affidabili, ordinati per
// rapporto qualita/prezzo. Per l'admin sono tutti selezionabili; gli utenti
// normali ricevono i modelli associati al loro tier di generazione.
const commonModels = [
  // TIER PREMIUM (top design + code)
  "anthropic/claude-sonnet-4.5",
  "openai/gpt-5",
  "google/gemini-2.5-pro",
  // TIER PRO (veloce + buona qualita)
  "anthropic/claude-haiku-4.5",
  "openai/gpt-5-mini",
  "x-ai/grok-4-fast",
  // TIER MEDIA (economico ma decente)
  "moonshotai/kimi-k2.6",
  "google/gemini-2.5-flash",
  "mistralai/mistral-large-2",
  // TIER BASE (economico, coding focus)
  "deepseek/deepseek-v4-pro",
  "qwen/qwen3-coder",
  "meta-llama/llama-4-maverick",
];

// Mapping tier di generazione ↔ modelli per fase.
// Il tier viene scelto dall'utente al momento della creazione dell'app.
// L'orchestratore usa il modello giusto per la fase giusta.
const GENERATION_TIERS = {
  starter: {
    label: "Starter",
    description: "App completa con frontend curato (Kimi K2.6) e backend solido",
    color: "#3b82f6",
    feeEur: 4.99,
    estCost: { min: 0.30, max: 0.70 },
    models: {
      sdd: "deepseek/deepseek-v4-pro",
      backend: "deepseek/deepseek-v4-pro",
      frontend: "moonshotai/kimi-k2.6",
      review: null,
    },
  },
  pro: {
    label: "Pro",
    description: "Frontend + revisione design con Claude Sonnet 4.5 (gusto top)",
    color: "#8b5cf6",
    feeEur: 9.99,
    estCost: { min: 0.70, max: 1.50 },
    models: {
      sdd: "deepseek/deepseek-v4-pro",
      backend: "deepseek/deepseek-v4-pro",
      frontend: "anthropic/claude-haiku-4.5",
      // Reviewer upgrade: Sonnet 4.5 ha gusto estetico molto piu' marcato di
      // Haiku. Pro deve essere VISIBILMENTE migliore di Media.
      review: "anthropic/claude-sonnet-4.5",
    },
  },
  premium: {
    label: "Premium",
    description: "Tutto Claude Sonnet 4.5 + review GPT-5",
    color: "#f59e0b",
    feeEur: 19.99,
    estCost: { min: 1.50, max: 3.50 },
    models: {
      sdd: "anthropic/claude-sonnet-4.5",
      backend: "anthropic/claude-sonnet-4.5",
      frontend: "anthropic/claude-sonnet-4.5",
      review: "openai/gpt-5",
    },
  },
};

// Calcolo prezzo finale dell'app basato sul SDD generato (complessita' reale).
// Usato dopo la prima fase (SDD) per mostrare all'utente un preventivo PRIMA
// di addebitare. Heuristiche:
//   - numero di task totali
//   - presenza di backend (auth/db)
//   - numero di entita'/tabelle (rileva da architecture.md)
//   - presenza di pagamenti/integrations esterne
// Output: { complexityScore (0-100), suggestedTier, priceEur }
// PRICING v4 (2026-05-17 evening): tutte le app sono GENERATE COI MIGLIORI
// MOTORI (tier "premium": Claude Sonnet 4.5 + GPT-5 review). L'utente NON
// sceglie. Il prezzo viene assegnato dal sistema in base ai TOKEN SDD REALI
// consumati dall'AI durante l'analisi (proxy onesto di complessita' che NON
// dipende da keyword fallaci nei task generati).
//
// Soglie calibrate sui costi reali misurati 2026-05-17:
//   - App semplice (es. todo personale)     -> ~€1.20-1.40 costo -> €1.99
//   - App media (es. gestionale assistenza) -> ~€1.70-1.80 costo -> €2.99
//   - App complessa (multi-modulo, CRM)     -> ~€2.20-3.00 costo -> €4.99
const ALWAYS_TIER = "premium";
const PRICE_TIERS = [
  { maxSddTokens: 5000,  priceEur: 1.99, label: "essenziale" },
  { maxSddTokens: 12000, priceEur: 2.99, label: "media" },
  { maxSddTokens: Infinity, priceEur: 4.99, label: "complessa" },
];

function priceFromSddTokens(sddTokens) {
  for (const t of PRICE_TIERS) {
    if (sddTokens <= t.maxSddTokens) return t;
  }
  return PRICE_TIERS[PRICE_TIERS.length - 1];
}

function computePriceFromSdd(target) {
  const steps = target.sdd?.steps || [];
  const taskCount = steps.length;
  const filesPlanned = (target.fileCount || 0) || taskCount * 2;
  const isWebsite = target.kind === "website";
  const sddTokens =
    (target.tokenUsage?.sdd?.promptTokens || 0) +
    (target.tokenUsage?.sdd?.completionTokens || 0);
  const pricePoint = priceFromSddTokens(sddTokens);
  return {
    complexityScore: null,
    suggestedTier: ALWAYS_TIER,
    priceEur: pricePoint.priceEur,
    complexityLabel: pricePoint.label, // "essenziale" | "media" | "complessa"
    breakdown: { taskCount, filesPlanned: Math.round(filesPlanned), sddTokens, isWebsite },
  };
}

// Implementazione precedente (scoring v2) tenuta come riferimento storico:
function _legacyComputePriceFromSdd(target) {
  const steps = target.sdd?.steps || [];
  const taskCount = steps.length;
  const filesPlanned = (target.fileCount || 0) || taskCount * 2;
  const isWebsite = target.kind === "website";

  // FILOSOFIA SCORING v2:
  // 1) Le FEATURE si rilevano SOLO dal prompt dell'utente, non dai task
  //    generati: l'orchestrator gonfia i task con boilerplate (vedi caso
  //    "todo list" che otteneva hasAdminPanel + hasIntegrations false-positive
  //    da parole tipo "dashboard" e "api" che esistono in ogni codebase).
  // 2) Il volume (task/file) pesa poco: non vogliamo che l'utente paghi
  //    di piu' solo perche' l'AI scrive piu' codice del necessario.
  // 3) Aggiungiamo un segnale REALE: i token consumati nella fase SDD.
  //    Una idea complessa fa scrivere all'AI molti piu' token di specifiche.
  const promptBlob = String(target.prompt || "").toLowerCase();
  const taskBlob = steps.map((s) => `${s.label || ""} ${s.phase || ""}`).join(" ").toLowerCase();
  // Feature flags: regex stretti, ancorati al prompt (con fallback su task
  // solo per segnali che il prompt potrebbe omettere ma sono evidenti).
  // Login + DB ammettono fallback (utente puo' dire "condivisa" senza dire
  // "login"): se l'app e' multi-utente serve quasi sempre login/db.
  const hasMultiUser  = /\b(multi.?utente|condivis[oa]|tra utenti|fra utenti|team|workspace|collaborativ|ruoli?\b|permess)/i.test(promptBlob);
  const hasAuthExplicit = /\b(login|registrazion|account utent|profil)/i.test(promptBlob);
  const hasAuth       = hasAuthExplicit || hasMultiUser; // multi-utente implica auth
  const hasDbExplicit = /\b(database|tabell|sqlite|postgres|persistent|salv(a|are) dat)/i.test(promptBlob);
  const hasDb         = hasDbExplicit || hasAuth; // se c'e' auth serve anche DB
  const hasUpload     = /\b(upload|carica(re)? (foto|immagin|file|allegat)|allegat|galleri[ae] foto)/i.test(promptBlob);
  const hasPayments   = /\b(paypal|stripe|checkout|carrello|pagament[oi] (online|reali)|fatturazione|sottoscrivere|pay\s?wall)/i.test(promptBlob);
  const hasAdminPanel = /\b(backoffice|pannello (di )?admin|pannello (di )?amministrazione|gestione utenti|approva(zione|re) utent)/i.test(promptBlob);
  const hasIntegrations = /\b(stripe|twilio|sendgrid|openai|claude|google maps|whatsapp|telegram|slack|webhook|webhooks|api esterna|api esterne|servizio esterno)/i.test(promptBlob);
  const hasRealtime   = /\b(tempo reale|real.?time|websocket|live update|notifiche push|chat (tra|fra) utent)/i.test(promptBlob);

  // ===== SCORING =====
  let score = 10; // base: ogni app parte da 10 (sotto Starter cap)

  // Volume: contributo basso. Il volume di task/file e' un PROXY rumoroso
  // (orchestrator gonfia anche app semplici), quindi pesa poco.
  // taskCount: 1 punto per task oltre i primi 5, cap 10 totali
  score += Math.min(Math.max(0, taskCount - 5) * 1, 10);
  // filesPlanned: 0.5 punti oltre i primi 6, cap 5
  score += Math.min(Math.max(0, filesPlanned - 6) * 0.5, 5);

  // Token SDD: segnale piu' affidabile di complessita' reale.
  const sddTokens =
    (target.tokenUsage?.sdd?.promptTokens || 0) +
    (target.tokenUsage?.sdd?.completionTokens || 0);
  let sddTokenBonus = 0;
  if (sddTokens > 12000) sddTokenBonus = 10;
  else if (sddTokens > 8000) sddTokenBonus = 7;
  else if (sddTokens > 5000) sddTokenBonus = 4;
  score += sddTokenBonus;

  // Feature dichiarate dall'utente nel prompt
  if (hasAuth) score += 8;
  if (hasDb) score += 5;
  if (hasMultiUser) score += 12;
  if (hasUpload) score += 8;
  if (hasPayments) score += 15;
  if (hasAdminPanel) score += 8;
  if (hasIntegrations) score += 10;
  if (hasRealtime) score += 12;

  score = Math.min(Math.round(score), 100);

  if (isWebsite) {
    return {
      complexityScore: score,
      suggestedTier: "starter",
      priceEur: 4.99,
      breakdown: { taskCount, hasBackend: false, signals: { isWebsite: true } },
    };
  }

  // Soglie tier. Esempi calibrati su pesi attuali:
  //   "todo personale localStorage"           -> ~15  -> Starter
  //   "todo condivisa fra utenti"             -> ~50  -> Starter
  //   "gestionale studio medico"              -> ~65  -> Pro
  //   "CRM commerciale multi-utente con doc"  -> ~75  -> Pro
  //   "marketplace pagamenti chat realtime"   -> ~95  -> Premium
  let suggestedTier, priceEur;
  if (score <= 55) { suggestedTier = "starter"; priceEur = 4.99; }
  else if (score <= 80) { suggestedTier = "pro"; priceEur = 9.99; }
  else { suggestedTier = "premium"; priceEur = 19.99; }

  return {
    complexityScore: score,
    suggestedTier,
    priceEur,
    breakdown: {
      taskCount,
      filesPlanned: Math.round(filesPlanned),
      sddTokens,
      sddTokenBonus,
      hasAuth, hasDb, hasPayments, hasUpload, hasAdminPanel, hasMultiUser, hasIntegrations, hasRealtime,
    },
  };
}

// Determina se per questa app serve il flusso pricing (estimate -> pay -> resume).
// Sito vetrina e admin sono esclusi: pipeline fila tutta come prima.
function requiresPaymentFlow(target, user) {
  if (target.kind === "website") return false;       // siti hanno gia' prezzo fisso semplice
  if (isAdminUser(user)) return false;               // admin bypass per test
  if (target.pricing?.status === "free") return false;
  if (target.pricing?.status === "paid") return false;
  return true;
}

// Backward compat: app vecchie hanno generationTier "base" o "media".
// Le mappiamo a "starter" che le ingloba (modelli di media: deepseek + kimi).
function normalizeTier(tier) {
  const t = String(tier || "starter").toLowerCase();
  if (t === "base" || t === "media") return "starter";
  return t;
}
function getTierModels(tier) {
  const t = normalizeTier(tier);
  return GENERATION_TIERS[t] ? GENERATION_TIERS[t].models : GENERATION_TIERS.starter.models;
}

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

  // Gate sul cambio API key: solo admin o chi ha almeno un'app sul piano
  // "hosted_user_api" puo' impostare la propria chiave. Gli altri utenti
  // usano le chiavi condivise LocoCode finche' non scelgono un piano.
  const wantsToSetApiKey = String(req.body.openrouterApiKey || "").trim().length > 0;
  if (wantsToSetApiKey) {
    const apps = await loadApps(stored);
    const hasUserApiPlan = apps.some((a) => normalizeLifecycle(a.lifecycle) === "hosted_user_api");
    if (!isAdminUser(stored) && !hasUserApiPlan) {
      res.status(403).json({
        error: "Per inserire le tue chiavi AI personali devi prima sottoscrivere il piano \"Hosting + chiavi tue\" su almeno un'app.",
      });
      return;
    }
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

// Endpoint pubblico: ritorna i tier di generazione disponibili con i loro
// metadati (label, descrizione, costo stimato, colore). Niente API key,
// niente segreti. L'UI lo usa per popolare il selettore tier alla creazione
// di una nuova app.
app.get("/api/generation-tiers", (req, res) => {
  const out = {};
  for (const [key, t] of Object.entries(GENERATION_TIERS)) {
    out[key] = {
      key,
      label: t.label,
      description: t.description,
      color: t.color,
      estCost: t.estCost,
      feeEur: t.feeEur,
      hasReview: !!t.models.review,
    };
  }
  res.json({ tiers: out });
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

  // GATE: il contenuto del codice sorgente e sbloccato SOLO se l'utente ha
  // pagato il pacchetto Export (lifecycle === "exported"). Altrimenti
  // ritorniamo solo i metadata (path + size) per dare trasparenza sulla
  // dimensione, ma non il contenuto.
  const canSeeSource = isAppExported(target);

  // I file di "spec" e "memoria" (.lc/spec/, .lc/memory/) restano sempre
  // visibili: sono il piano/documenti dell'app, non codice sorgente di valore.
  const isMetaFile = (p) => p.startsWith(".lc/") || p === "README.md";

  const payload = [];
  for (const relPath of files) {
    if (canSeeSource || isMetaFile(relPath)) {
      payload.push({
        path: relPath,
        content: await readProjectFile(target, relPath),
        locked: false,
      });
    } else {
      // Solo metadata. Stima dimensione senza leggere tutto in memoria.
      let size = 0;
      try {
        const stat = await fs.stat(path.join(root, relPath));
        size = stat.size;
      } catch {}
      payload.push({
        path: relPath,
        content: null,
        locked: true,
        size,
      });
    }
  }

  res.json({
    files: payload,
    sourceLocked: !canSeeSource,
    pricing: computeAppPricing(target),
  });
});

// Endpoint export: genera ZIP del codice sorgente. Disponibile SOLO per app
// in lifecycle "exported". Risponde con uno stream zip in-memory.
app.get("/api/apps/:id/export", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const apps = await loadApps(user);
  const target = apps.find((item) => item.id === req.params.id);
  if (!target) {
    res.status(404).json({ error: "App non trovata." });
    return;
  }
  if (!isAppExported(target)) {
    res.status(402).json({ error: "Per scaricare il codice serve il pacchetto Export. Acquistalo dal pannello." });
    return;
  }

  const root = projectRoot(target);
  const files = await listProjectFiles(root);
  // Costruiamo uno ZIP semplice senza dipendenze esterne usando il modulo
  // built-in node:zlib + un format ZIP minimale.
  // Per evitare di aggiungere nuove dipendenze, generiamo un .tar.gz al volo.
  const fileName = `${slugifyAppName(target.name)}-export.tar.gz`;
  res.setHeader("Content-Type", "application/gzip");
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);

  const { spawn } = await import("node:child_process");
  const tar = spawn("tar", ["-czf", "-", "-C", root, ...files], { stdio: ["ignore", "pipe", "pipe"] });
  tar.stdout.pipe(res);
  tar.on("error", (err) => {
    console.warn("[export] tar errore:", err.message);
    if (!res.headersSent) res.status(500).json({ error: "Errore creazione archivio." });
  });
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
        ? "Il tuo trial di 30 giorni è scaduto. Abbonati per continuare a usare le chiavi condivise, oppure inserisci la tua API key nelle impostazioni."
        : "API key non disponibile. Inseriscila nelle impostazioni o riprova più tardi.",
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

  // Limite anti-spam: un utente non-admin puo' avere SOLO un'app "in corso"
  // alla volta. In corso = autopilot attivo, oppure flusso pricing non
  // concluso (estimate_pending o awaiting_payment). Quando la prima e'
  // completata, pagata o cancellata, puo' partirne un'altra. L'admin bypassa.
  if (isNewApp && !isAdminUser(user)) {
    const blocking = apps.find((a) => {
      if (a.autopilot?.running) return true;
      const ps = a.pricing?.status;
      return ps === "estimate_pending" || ps === "awaiting_payment";
    });
    if (blocking) {
      res.status(409).json({
        error: `Hai gia' un progetto in corso: "${blocking.name}". Completalo, pagalo o cancellalo prima di crearne un altro.`,
        app: publicApp(blocking),
        reason: "another_in_progress",
      });
      return;
    }
  }

  // PRICING v3: tier sempre "premium" per tutti (utente e admin). Non c'e'
  // piu' scelta: l'utente paga €1.99 e ottiene sempre i migliori modelli AI.
  const effectiveTier = ALWAYS_TIER;

  // Kind: webapp (default, flusso completo con backend) oppure website (sito
  // vetrina statico, niente backend). Influenza prompt e pipeline.
  const requestedKind = String(req.body.kind || "webapp").trim().toLowerCase();
  const appKind = requestedKind === "website" ? "website" : "webapp";

  // Email opt-in: l'utente puo' richiedere di essere avvisato quando il
  // preventivo e' pronto e/o quando l'app e' pronta. L'opt-in per "app
  // pronta" e' settabile sia qui (HomeView) sia in EstimateView prima
  // del pagamento (per non-admin). L'admin salta EstimateView quindi
  // l'unica chance di opt-in per lui e' qui.
  const notifyOnEstimate = req.body.notifyEmailOnEstimate === true;
  const notifyOnReady = req.body.notifyEmailOnReady === true;

  if (!target) {
    target = {
      id: `app-${Date.now()}`,
      appToken: crypto.randomUUID(),
      lifecycle: "trial",
      trialExpiresAt: new Date(Date.now() + appTrialMs).toISOString(),
      notifyEmailOnEstimate: notifyOnEstimate,
      notifyEmailOnReady: notifyOnReady,
      ownerEmail: user.email || "",
      ownerId: user.id,
      name: requestedProjectName,
      createdAt: now,
      updatedAt: now,
      model,
      generationTier: effectiveTier,
      kind: appKind,
      // Flusso pricing: utenti normali partono in "estimate_pending" -> dopo SDD
      // diventa "awaiting_payment". Admin/siti bypassano: status "free".
      pricing: {
        status: (appKind === "website" || isAdminUser(user)) ? "free" : "estimate_pending",
        chosenTier: effectiveTier,
        createdAt: now,
      },
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
  } else if (effectiveTier !== "base" && !target.generationTier) {
    // App esistente: aggiorna il tier se l'admin lo cambia
    target.generationTier = effectiveTier;
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

// Conferma pagamento del preventivo (al momento sandbox: trust del click utente,
// in futuro verifichera' un PayPal order_id). Sposta pricing.status -> "paid",
// resetta lo stato autopilot e ri-avvia il job in mode initial: la pipeline
// vedra' pricing.status==="paid" e saltera' la fase SDD, proseguendo con
// backend + frontend + review fino al deploy.
app.post("/api/apps/:id/confirm-payment", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  const apps = await loadApps(user);
  const target = apps.find((item) => item.id === req.params.id);
  if (!target) { res.status(404).json({ error: "App non trovata." }); return; }
  if (target.pricing?.status !== "awaiting_payment") {
    res.status(409).json({ error: "L'app non e' in attesa di pagamento.", currentStatus: target.pricing?.status });
    return;
  }

  // TODO: quando PAYPAL_CLIENT_ID/SECRET sono configurati, verificare req.body.orderId
  // con PayPal Orders API v2 prima di marcare paid. Per ora trust del click.
  const paymentMethod = String(req.body.paymentMethod || "sandbox").trim();
  const paymentRef = String(req.body.orderId || `sandbox-${Date.now()}`);

  // Opt-in mail "app pronta": l'utente decide a questo punto (post-preventivo,
  // pre-generazione) se essere avvisato per email quando l'app e' deployata.
  if (typeof req.body.notifyEmailOnReady === "boolean") {
    target.notifyEmailOnReady = req.body.notifyEmailOnReady;
  }
  if (user.email && !target.ownerEmail) target.ownerEmail = user.email;

  const now = new Date().toISOString();
  target.pricing = {
    ...(target.pricing || {}),
    status: "paid",
    paidAt: now,
    paymentMethod,
    paymentRef,
  };
  target.status = "building";
  target.updatedAt = now;
  appendOperationalLog(target, `✓ Pagamento confermato (€${target.pricing.priceEur?.toFixed(2) || "?"} via ${paymentMethod}). Riprendo generazione...`);
  await saveApps(apps, user);

  const settings = await loadSettings(user);
  const apiKey = resolveApiKey(user, settings.openrouterApiKey);
  if (!apiKey) { res.status(500).json({ error: "API key non disponibile per riprendere." }); return; }

  startAutopilotJob({
    userId: user.id,
    appId: target.id,
    apiKey,
    model: target.model || settings.defaultModel || commonModels[0],
    userPrompt: target.prompt || "",
    mode: "initial",
  });

  res.json({ app: publicApp(target), resumed: true });
});

// Annulla il preventivo = CANCELLA L'APP COMPLETAMENTE. Nessun mezzo-stato:
// l'utente che annulla vuole liberarsi dell'app, non vederla nel workspace
// con un fantomatico "Riprendi". Riusiamo il flusso DELETE per essere
// coerenti (stop autopilot, rimuovi entry, kill backend, cancella cartella).
app.post("/api/apps/:id/cancel-estimate", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  const apps = await loadApps(user);
  const target = apps.find((item) => item.id === req.params.id);
  if (!target) { res.status(404).json({ error: "App non trovata." }); return; }

  const result = await deleteAppCompletely({ user, apps, target, reason: "cancel-estimate" });
  res.json({ deleted: true, cancelled: true, id: result.id, name: result.name });
});

// Helper condiviso: cancella un'app in tutti i suoi pezzi (stato, cartella,
// backend, runtime). Chiamato sia dal DELETE che dal cancel-estimate.
async function deleteAppCompletely({ user, apps, target, reason = "delete" }) {
  const appId = target.id;
  const appName = target.name || appId;
  console.log(`[${reason}] Avvio eliminazione app "${appName}" (${appId})`);

  if (target.autopilot) {
    target.autopilot.stopRequested = true;
    target.autopilot.running = false;
  }
  const runningKey = jobKey(user.id, appId);
  if (runningJobs.has(runningKey)) {
    runningJobs.delete(runningKey);
    console.log(`[${reason}] Rimosso job in-memory per ${appId}`);
  }

  const updatedApps = apps.filter((item) => item.id !== appId);
  await saveApps(updatedApps, user);

  await stopBackend(appId).catch((e) => console.warn(`[${reason}] stopBackend ${appId}:`, e.message));

  const root = projectRoot(target);
  try {
    await fs.rm(root, { recursive: true, force: true });
    console.log(`[${reason}] Cartella progetto rimossa: ${root}`);
  } catch (err) {
    console.warn(`[${reason}] Errore eliminando cartella ${root}:`, err.message);
  }

  console.log(`[${reason}] Eliminazione completata per "${appName}"`);
  return { id: appId, name: appName };
}

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
  if (!target) { res.status(404).json({ error: "App non trovata." }); return; }
  const result = await deleteAppCompletely({ user, apps, target, reason: "delete" });
  res.json({ deleted: true, id: result.id, name: result.name });
});

// ─── Acquisto / PayPal (sandbox/mock) ─────────────────────────────
// Tier validi:
//   "hosted_lococode_api" — abbonamento A: hosted + nostre API key
//   "hosted_user_api"     — abbonamento B: hosted + chiavi utente
//   "exported"            — pacchetto C: one-shot, sblocca codice sorgente
//
// Per ora il flusso e MOCK: ritorna un approval_url che punta a una pagina
// di conferma interna (/api/apps/:id/purchase/confirm). Quando integri
// PayPal vero, basta sostituire la creazione ordine con la chiamata REST.
const PAYPAL_LIVE = String(process.env.LOCOCODE_PAYPAL_LIVE || "").toLowerCase() === "true";

app.post("/api/apps/:id/purchase", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const tier = String(req.body.tier || "").trim();
  if (!["hosted_lococode_api", "hosted_user_api", "exported"].includes(tier)) {
    res.status(400).json({ error: "Tier non valido." });
    return;
  }

  const apps = await loadApps(user);
  const target = apps.find((item) => item.id === req.params.id);
  if (!target) {
    res.status(404).json({ error: "App non trovata." });
    return;
  }

  const pricing = computeAppPricing(target);
  const plan = pricing.plans[tier];
  if (!plan) {
    res.status(400).json({ error: "Piano non disponibile." });
    return;
  }
  const amount = plan.oneShotEur || plan.monthlyEur;

  // Genera order ID. In sandbox mock e una stringa locale; in produzione
  // sara l'ID restituito da PayPal Orders API v2.
  const orderId = `mock-${crypto.randomBytes(12).toString("hex")}`;
  target.pendingOrder = {
    orderId,
    tier,
    amountEur: amount,
    createdAt: new Date().toISOString(),
    provider: PAYPAL_LIVE ? "paypal" : "mock",
  };
  await saveApps(apps, user);

  // In modalita LIVE, qui chiameremmo l'API PayPal /v2/checkout/orders e
  // ritorneremmo l'approval_url di PayPal. Per ora ritorniamo un URL locale
  // di conferma (utile in sandbox per test E2E).
  const approvalUrl = PAYPAL_LIVE
    ? null // TODO: sostituire con response.links[].rel === "approve"
    : `${publicBaseUrl}/api/apps/${target.id}/purchase/confirm?order=${orderId}`;

  res.json({
    orderId,
    tier,
    amountEur: amount,
    approvalUrl,
    sandbox: !PAYPAL_LIVE,
  });
});

// Conferma ordine — in sandbox/mock viene visitata direttamente dall'utente
// (simula il ritorno da PayPal dopo approvazione). In LIVE diventa il webhook
// che PayPal chiama dopo PAYMENT.CAPTURE.COMPLETED.
app.get("/api/apps/:id/purchase/confirm", async (req, res) => {
  const orderId = String(req.query.order || "").trim();
  if (!orderId) {
    res.status(400).send("Ordine mancante.");
    return;
  }

  // Trova app + utente proprietario dall'orderId memorizzato
  const store = await loadUsersStore();
  let foundUser = null;
  let foundApp = null;
  let foundApps = null;
  for (const u of store.users || []) {
    const apps = await loadApps(u);
    const t = apps.find((a) => a.id === req.params.id && a.pendingOrder?.orderId === orderId);
    if (t) {
      foundUser = u;
      foundApp = t;
      foundApps = apps;
      break;
    }
  }
  if (!foundApp) {
    res.status(404).send("Ordine non trovato o gia confermato.");
    return;
  }

  const tier = foundApp.pendingOrder.tier;
  const amount = foundApp.pendingOrder.amountEur;
  foundApp.lifecycle = tier; // "hosted_lococode_api" | "hosted_user_api" | "exported"
  foundApp.lastPurchaseAt = new Date().toISOString();
  foundApp.lastPurchaseEur = amount;
  // In mock mode rimuoviamo trialExpiresAt per non bloccare
  if (tier !== "exported") {
    // abbonamenti: rinnoviamo trial-like a 30 giorni dal pagamento
    foundApp.trialExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  } else {
    foundApp.trialExpiresAt = null;
  }
  delete foundApp.pendingOrder;
  foundApp.licenseRequested = false;
  await saveApps(foundApps, foundUser);

  console.log(`[purchase] App ${foundApp.id} attivata su tier "${tier}" per ${amount} EUR (utente ${foundUser.email})`);

  // Risposta HTML user-friendly (simula la landing di ritorno PayPal)
  res.type("html").send(`<!doctype html><html lang="it"><head><meta charset="utf-8"><title>Acquisto confermato</title><style>body{font-family:system-ui,sans-serif;background:#f4f6ff;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}.card{background:#fff;padding:40px 48px;border-radius:16px;box-shadow:0 8px 32px rgba(91,62,232,0.15);text-align:center;max-width:440px}h1{color:#059669;margin:0 0 12px}p{color:#475569;line-height:1.6}.btn{display:inline-block;margin-top:20px;background:linear-gradient(135deg,#5b3ee8,#7c5af0);color:#fff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600}</style></head><body><div class="card"><h1>&check; Acquisto confermato</h1><p>Hai attivato <strong>${foundApp.name}</strong> sul piano <strong>${tier}</strong> per <strong>€${amount.toFixed(2)}</strong>.</p><p style="font-size:13px;color:#94a3b8">Modalita: ${PAYPAL_LIVE ? "PayPal Live" : "Sandbox / Mock"}</p><a href="${publicBaseUrl}" class="btn">Torna al pannello LocoCode</a></div></body></html>`);
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
        ? "Il tuo trial è scaduto. Abbonati per continuare a usare le chiavi condivise, oppure inserisci la tua API key."
        : "API key non disponibile. Inseriscila nelle impostazioni.",
    });
    return;
  }

  // Stessa regola "1 progetto in corso per utente" del POST /api/generate:
  // se l'utente non-admin sta gia' lavorando su un'altra app, blocca il
  // resume di questa. Idempotente: se il check "alreadyRunning" sotto
  // restituisce true per QUESTO target, ovviamente non blocchiamo se stessi.
  if (!isAdminUser(user)) {
    const blocking = (await loadApps(user)).find((a) => {
      if (a.id === target.id) return false;
      if (a.autopilot?.running) return true;
      const ps = a.pricing?.status;
      return ps === "estimate_pending" || ps === "awaiting_payment";
    });
    if (blocking) {
      res.status(409).json({
        error: `Hai gia' un progetto in corso: "${blocking.name}". Completalo, pagalo o cancellalo prima di riprendere questo.`,
        app: publicApp(blocking),
        reason: "another_in_progress",
      });
      return;
    }
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
// Proxy API per app pubblica: /app/{slug}/api/* viene inoltrato al backend
// FastAPI dell'app sulla sua porta dedicata (127.0.0.1:appData.backendPort).
// Va PRIMA delle rotte generiche /app/:slug per matchare per primo.
app.all("/app/:slug/api/*splat", proxyAppApiRequest);
app.all("/app/:slug/api", proxyAppApiRequest);

// URL pubblica leggibile: /apps/nome-app-a8f756 o /apps/nome-app-a8f756/*
app.get("/app/:slug", publicAppSlugRequest);
app.get("/app/:slug/*splat", publicAppSlugRequest);

async function proxyAppApiRequest(req, res) {
  const slug = String(req.params.slug || "").trim().toLowerCase();
  const found = await findPublicAppBySlug(slug);
  if (!found) {
    res.status(404).json({ error: "App non trovata." });
    return;
  }
  const port = found.target.backendPort;
  if (!port) {
    res.status(503).json({ error: "Backend dell'app non ancora avviato." });
    return;
  }
  // Calcola il path da girare al backend: tutto cio' che viene dopo /app/{slug}/api
  // Es: /app/foo-123/api/auth/login -> /api/auth/login (il backend monta /api/*)
  const subPath = req.url.replace(/^\/app\/[^/]+\/api/, "/api") || "/api";
  const target = `http://127.0.0.1:${port}${subPath}`;

  try {
    const headers = { ...req.headers };
    delete headers["host"];
    delete headers["content-length"];
    const body = ["GET", "HEAD"].includes(req.method)
      ? undefined
      : JSON.stringify(req.body || {});
    const upstream = await fetch(target, {
      method: req.method,
      headers: { ...headers, "content-type": "application/json" },
      body,
    });
    res.status(upstream.status);
    upstream.headers.forEach((value, key) => {
      if (!["content-length", "transfer-encoding", "connection"].includes(key.toLowerCase())) {
        res.setHeader(key, value);
      }
    });
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.send(buf);
  } catch (err) {
    console.warn(`[proxy] errore ${target}:`, err.message);
    res.status(502).json({ error: "Backend non raggiungibile." });
  }
}

// Endpoint pubblico: l'app generata interroga qui lo stato del trial.
// Risponde JSON con { lifecycle, trialDaysLeft, expired, name }. Nessun auth.
app.get("/api/public/app-status/:slug", async (req, res) => {
  const slug = String(req.params.slug || "").trim().toLowerCase();
  if (!slug) {
    res.status(400).json({ error: "Slug mancante." });
    return;
  }
  const found = await findPublicAppBySlug(slug);
  if (!found) {
    res.status(404).json({ error: "App non trovata." });
    return;
  }
  const appData = found.target;
  const now = new Date();
  const expiresAt = appData.trialExpiresAt ? new Date(appData.trialExpiresAt) : null;
  const lifecycle = normalizeLifecycle(appData.lifecycle);
  const isActive = isAppActive(appData);
  const expired = !isActive && expiresAt && expiresAt < now;
  const trialDaysLeft =
    isActive || !expiresAt ? null : Math.max(0, Math.ceil((expiresAt - now) / 86400000));
  const pricing = computeAppPricing(appData);
  res.set("Cache-Control", "no-store");
  res.json({
    name: appData.name || "",
    lifecycle,
    isActive,
    expired: !!expired,
    trialDaysLeft,
    trialExpiresAt: appData.trialExpiresAt || null,
    pricing,
  });
});

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
  if (target.trialExpiresAt && !isAppActive(target) && new Date(target.trialExpiresAt) < new Date()) {
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

  // Tier wins: il "model" passato e' quello dei settings dell'utente
  // (per i nuovi utenti = "anthropic/claude-sonnet-4.5" che e' commonModels[0]).
  // Le fasi principali (sdd/backend/frontend/review) hanno gia' modelFor(phase)
  // che pesca da tierModels, MA le chiamate "fuori-fase" (wireframe, followup,
  // recovery, retry) usano direttamente questa variabile -> spenderebbero Sonnet
  // anche su tier "base". Forza qui all'SDD-model del tier dell'app, cosi' chi
  // ha pagato il base usa SOLO DeepSeek per ogni chiamata. Admin con tier
  // premium continua a usare Sonnet, etc.
  const tierModels = getTierModels(target.generationTier);
  if (tierModels?.sdd) {
    model = tierModels.sdd;
  }

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
      // CHECKPOINT PAGAMENTO: la pipeline si e' fermata dopo il SDD per attendere
      // conferma utente. Salviamo lo stato "awaiting_payment" e usciamo dal job
      // senza chiamare finishAutopilot. L'endpoint /confirm-payment riavviera'.
      if (result.awaitingPayment) {
        target.status = "awaiting_payment";
        target.autopilot = {
          ...(target.autopilot || {}),
          running: false,
          stopRequested: false,
          updatedAt: new Date().toISOString(),
          lastMessage: `Preventivo pronto: €${result.estimate.priceEur.toFixed(2)}. In attesa di conferma utente.`,
          error: null,
        };
        await saveApps(apps, user);
        pushAssistantMessage(
          target,
          `Ho analizzato la tua idea. La complessita' rilevata e' ${result.estimate.complexityScore}/100 (categoria ${result.estimate.suggestedTier}). Costo per la creazione: €${result.estimate.priceEur.toFixed(2)}. Conferma per proseguire — verra' scalato dal tuo abbonamento o licenza futura.`,
        );
        await saveApps(apps, user);
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

    while (target.sdd?.currentStep) {
      const stopReasonBefore = await shouldStopAutopilot(user, appId);
      if (stopReasonBefore) {
        await pauseAutopilot(target, apps, user, stopReasonBefore);
        return;
      }

      const beforeTask = getNextTaskLabel(target);

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

      if (result.touched?.some(f => f.startsWith("frontend/"))) {
        schedulePreviewBuild(target, apps, user, 4000);
      }

      const stopReasonAfter = await shouldStopAutopilot(user, appId);
      if (stopReasonAfter) {
        await pauseAutopilot(target, apps, user, stopReasonAfter);
        return;
      }
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
  const slug = appPublicSlug(target);
  const lines = [
    `# App: ${target.name} (${target.id})`,
    // Path vecchio (retro-compat)
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
  // Path nuovo: /app/{slug}/api/* mantiene il prefisso /api/ verso il backend
  if (slug) {
    lines.push(
      ``,
      `location /app/${slug}/api/ {`,
      `    proxy_pass http://127.0.0.1:${port}/api/;`,
      `    proxy_http_version 1.1;`,
      `    proxy_read_timeout 120s;`,
      `    proxy_set_header Host $host;`,
      `    proxy_set_header X-Real-IP $remote_addr;`,
      `    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`,
      `    proxy_set_header X-Forwarded-Proto $scheme;`,
      `}`,
    );
  }
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

// Mapping import Python -> nome pacchetto pip. DeepSeek tende a importare
// moduli senza aggiungere il pacchetto a requirements.txt. Questi sono i
// "soliti" che spesso mancano.
const PYTHON_IMPORT_TO_PIP = {
  jwt: "PyJWT==2.8.0",
  jose: "python-jose[cryptography]==3.3.0",
  dotenv: "python-dotenv==1.0.0",
  email_validator: "email-validator==2.1.0",
  bcrypt: "bcrypt==4.0.1",
  passlib: "passlib[bcrypt]==1.7.4",
  itsdangerous: "itsdangerous==2.1.2",
  httpx: "httpx==0.25.2",
  multipart: "python-multipart==0.0.6",
  aiosqlite: "aiosqlite==0.19.0",
};

// Pattern Python "impliciti": tipi/classi usate nel codice che richiedono
// pacchetti extra non sempre ovvi dall'import. Es: pydantic.EmailStr richiede
// email-validator come dipendenza transitiva, ma "email_validator" non appare
// in nessun import diretto -> backend crasha all'avvio.
const PYTHON_IMPLICIT_DEPS = [
  { pattern: /\bEmailStr\b/, pkg: "email-validator>=2.0" },
  { pattern: /\bHttpUrl\b|\bAnyUrl\b|\bPostgresDsn\b/, pkg: "email-validator>=2.0" },
];

async function scanMissingPythonImports(backendPath) {
  const found = new Set();
  const implicit = new Set();
  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (e.name === "venv" || e.name === "__pycache__" || e.name.startsWith(".")) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.name.endsWith(".py")) {
        const txt = await fs.readFile(full, "utf8").catch(() => "");
        for (const m of txt.matchAll(/^\s*(?:from|import)\s+([a-zA-Z_][\w]*)/gm)) {
          found.add(m[1]);
        }
        for (const { pattern, pkg } of PYTHON_IMPLICIT_DEPS) {
          if (pattern.test(txt)) implicit.add(pkg);
        }
      }
    }
  }
  await walk(backendPath);
  return { imports: [...found], implicitPackages: [...implicit] };
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
  const venvPython = path.join(venvPath, "bin", "python");
  const pipBin = path.join(venvPath, "bin", "pip");
  const uvicornBin = path.join(venvPath, "bin", "uvicorn");
  const pm2Name = `lococode-app-${target.id}`;

  console.log(`[deploy] Build backend ${target.id} porta ${port}`);

  // 1) venv + requirements.txt
  await execFileAsync("python3", ["-m", "venv", venvPath]);
  await execFileAsync(pipBin, ["install", "--quiet", "--no-cache-dir", "-r", reqFile]);

  // 2) Scan import + pattern impliciti, installa moduli mancanti
  const { imports, implicitPackages } = await scanMissingPythonImports(backendPath);
  const extra = [];
  for (const imp of imports) {
    if (PYTHON_IMPORT_TO_PIP[imp]) extra.push(PYTHON_IMPORT_TO_PIP[imp]);
  }
  for (const pkg of implicitPackages) extra.push(pkg);
  if (extra.length) {
    console.log(`[deploy] Installo moduli auto-rilevati per ${target.id}: ${extra.join(", ")}`);
    await execFileAsync(pipBin, ["install", "--quiet", "--no-cache-dir", ...extra]).catch((e) => {
      console.warn(`[deploy] auto-install fallito (continuo): ${e.message}`);
    });
  }

  // 3) Avvio PM2 con interpreter del venv (altrimenti uvicorn non trova i pacchetti)
  await execFileAsync("pm2", ["delete", pm2Name]).catch(() => {});
  await execFileAsync("pm2", [
    "start", uvicornBin,
    "--name", pm2Name,
    "--interpreter", venvPython,
    "--",
    "app.main:app",
    "--host", "127.0.0.1",
    "--port", String(port),
  ], { cwd: backendPath });
  await execFileAsync("pm2", ["save"]);

  // 4) Salva la porta sull'app (necessario al proxy /app/{slug}/api/*)
  target.backendPort = port;

  // 5) Nginx (compatibilita' col vecchio path)
  await writeAppNginxConf(target, port).catch((e) => console.warn(`[deploy] nginx: ${e.message}`));
  await reloadNginx().catch((e) => console.warn(`[deploy] nginx reload: ${e.message}`));

  // 6) Smoke test: aspetta che il backend risponda
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 600));
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`);
      if (res.status < 500) break;
    } catch {}
  }

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
  // Salva publicSlug calcolato cosi' non rischia di cambiare se ricalcoliamo
  if (!target.publicSlug) target.publicSlug = appPublicSlug(target);
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

  // Avvia post-processing in background quando tutti i task sono completati
  // (status === "ready"). Ora gestito da una pipeline SEQUENZIALE che fa:
  // 1. Build frontend (Vite)
  // 2. Deploy backend (venv + uvicorn + nginx)
  // 3. Smoke test (curl)
  // 4. Email all'utente con risultato
  if (!target.sdd?.currentStep && target.status === "ready") {
    runPostGenerationPipeline(target, apps, user).catch((err) => {
      console.error(`[finish] pipeline fallita per ${target.id}:`, err);
    });
  }
}

async function runPostGenerationPipeline(target, apps, user) {
  const appId = target.id;
  const startedAt = Date.now();
  appendOperationalLog(target, "Avvio pipeline finale: build frontend + deploy backend + smoke test...");
  await saveApps(apps, user).catch(() => {});

  // 1) Build frontend
  let frontendOk = false;
  try {
    const built = await ensureFrontendPreviewBuild(target);
    if (built) {
      target.preview = await resolvePreviewState(target, target.files || []);
      frontendOk = true;
      appendOperationalLog(target, "✓ Frontend buildato e pronto.");
    } else {
      appendOperationalLog(target, "⚠ Frontend non buildato (file mancanti).");
    }
    await saveApps(apps, user).catch(() => {});
  } catch (err) {
    console.warn(`[finish] frontend build ${appId}:`, err.message);
    appendOperationalLog(target, `⚠ Errore build frontend: ${err.message.slice(0, 150)}`);
    await saveApps(apps, user).catch(() => {});
  }

  // 2) Deploy backend
  let backendPort = null;
  try {
    const port = await deployBackend(target);
    if (port) {
      target.backendPort = port;
      backendPort = port;
      appendOperationalLog(target, `✓ Backend Python attivo (porta ${port}).`);
    } else {
      appendOperationalLog(target, "⚠ Backend non deployato (file mancanti).");
    }
    await saveApps(apps, user).catch(() => {});
  } catch (err) {
    console.error(`[finish] backend deploy ${appId}:`, err.message);
    appendOperationalLog(target, `⚠ Errore deploy backend: ${err.message.slice(0, 200)}`);
    await saveApps(apps, user).catch(() => {});
  }

  // 3) Smoke test: chiama un endpoint pubblico per verificare che TUTTO
  // funzioni. Inoltre verifica che il processo PM2 del backend non sia
  // in crash loop (capita spesso con bug python tipo bcrypt/passlib).
  let smokeOk = false;
  let backendCrashLoop = false;
  if (backendPort) {
    // Check crash loop: leggi pm2 jlist e cerca quante volte il process
    // si e' riavviato nell'ultimo minuto. > 5 restart = crash loop.
    try {
      const pmName = `lococode-app-${target.id}`;
      const { execSync } = await import("node:child_process");
      const pmJson = execSync("pm2 jlist", { encoding: "utf8", timeout: 5000 });
      const list = JSON.parse(pmJson);
      const proc = list.find((p) => p.name === pmName);
      if (proc) {
        const restarts = proc.pm2_env?.restart_time || 0;
        const uptimeMs = Date.now() - (proc.pm2_env?.pm_uptime || Date.now());
        // Restarts > 5 totali e uptime corrente < 30s = sta ancora crashando
        if (restarts > 5 && uptimeMs < 30000) {
          backendCrashLoop = true;
          appendOperationalLog(target, `⚠⚠ Backend in crash loop (${restarts} restart, uptime ${Math.round(uptimeMs/1000)}s). Controlla i log: pm2 logs ${pmName} --err`);
        }
      }
    } catch (err) {
      // non bloccante - il check pm2 e' best-effort
      console.warn(`[smoke] pm2 check fallito per ${target.id}: ${err.message}`);
    }

    const slug = target.publicSlug || appPublicSlug(target);
    const smokeUrl = `${publicBaseUrl}/app/${slug}`;
    const apiSmokeUrl = `${publicBaseUrl}/app/${slug}/api/`;
    try {
      const res = await fetch(smokeUrl);
      const apiRes = await fetch(apiSmokeUrl).catch(() => ({ status: 0 }));
      const backendRes = await fetch(`http://127.0.0.1:${backendPort}/`).catch(() => ({ status: 0 }));
      const frontendStatus = res.status;
      const apiStatus = apiRes.status;
      const backendStatus = backendRes.status;
      // Accettiamo qualsiasi status < 500 sul frontend, e backend che almeno risponda
      // Ma se e' in crash loop, smokeOk e' SEMPRE false (anche se in quell'istante risponde).
      smokeOk = !backendCrashLoop && frontendStatus < 500 && backendStatus > 0 && backendStatus < 500;
      appendOperationalLog(
        target,
        `${smokeOk ? "✓" : "⚠"} Smoke test: frontend HTTP ${frontendStatus} · API HTTP ${apiStatus} · backend HTTP ${backendStatus}${backendCrashLoop ? " · BACKEND IN CRASH LOOP" : ""}`,
      );
      await saveApps(apps, user).catch(() => {});
    } catch (err) {
      appendOperationalLog(target, `⚠ Smoke test fallito: ${err.message.slice(0, 150)}`);
      await saveApps(apps, user).catch(() => {});
    }
  }

  // 3b) Auth smoke test: se la app ha endpoint di auth, prova register+login
  //     end-to-end con credenziali fittizie. Se fallisce -> bug nel codice
  //     generato (es. condizione if(!token || view==='login') che blocca
  //     register, o frontend che chiama path sbagliati).
  let authOk = null; // null = non applicabile (no auth), true = ok, false = rotto
  let authReport = null;
  if (backendPort && target.kind !== "website") {
    try {
      authOk = await runAuthSmokeTest(target, backendPort);
      authReport = authOk ? "register+login OK" : "auth endpoints non rispondono come atteso";
      appendOperationalLog(target, `${authOk ? "✓" : "⚠"} Auth smoke test: ${authReport}`);
    } catch (err) {
      authOk = false;
      authReport = err.message.slice(0, 200);
      appendOperationalLog(target, `⚠ Auth smoke test fallito: ${authReport}`);
    }
    target.authSmokeTest = { ok: authOk, report: authReport, testedAt: new Date().toISOString() };
    await saveApps(apps, user).catch(() => {});
  }

  // 4) Email utente con risultato finale
  const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
  await notifyUserAppReady(user, target, { frontendOk, backendPort, smokeOk, authOk, authReport, elapsedSec, backendCrashLoop }).catch((err) =>
    console.warn(`[notify] email ${appId}:`, err.message),
  );
}

// Auth smoke test: tenta register di un utente fittizio, poi login con le
// stesse credenziali. Cerca di adattarsi a piccole varianti di schema
// (display_name opzionale, name vs username vs full_name).
async function runAuthSmokeTest(target, backendPort) {
  // Verifica che gli endpoint esistano nell'openapi
  let openapi;
  try {
    const r = await fetch(`http://127.0.0.1:${backendPort}/openapi.json`);
    if (!r.ok) return null; // nessun openapi -> non FastAPI standard, skip
    openapi = await r.json();
  } catch {
    return null;
  }
  const paths = Object.keys(openapi.paths || {});
  const registerPath = paths.find((p) => /\/auth\/register/i.test(p));
  const loginPath = paths.find((p) => /\/auth\/(login|sign[-_]?in|token)/i.test(p));
  if (!registerPath || !loginPath) return null; // app senza auth -> skip

  const ts = Date.now();
  const testEmail = `smoke_${ts}@lococode.test`;
  const testPassword = "SmokeTest123!";

  // Scopri quali campi vuole il register dal suo schema
  const registerOp = openapi.paths[registerPath].post;
  const schemaRef = registerOp?.requestBody?.content?.["application/json"]?.schema?.$ref;
  const schemaName = schemaRef ? schemaRef.split("/").pop() : null;
  const schema = schemaName ? openapi.components?.schemas?.[schemaName] : null;
  const fields = schema?.properties ? Object.keys(schema.properties) : ["email", "password"];

  // Costruisci payload con i nomi dei campi visti nello schema
  const payload = {};
  for (const f of fields) {
    const lower = f.toLowerCase();
    if (/email/.test(lower)) payload[f] = testEmail;
    else if (/password|pwd/.test(lower)) payload[f] = testPassword;
    else if (/name|nick|user/.test(lower)) payload[f] = "SmokeTester";
    else if (/phone/.test(lower)) payload[f] = "+39 333 1234567";
    else payload[f] = "test";
  }

  // 1) Register
  const regRes = await fetch(`http://127.0.0.1:${backendPort}${registerPath}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!regRes.ok && regRes.status !== 409) { // 409 = già esistente, accettabile
    const txt = await regRes.text().catch(() => "");
    throw new Error(`register HTTP ${regRes.status}: ${txt.slice(0, 200)}`);
  }

  // 2) Login con le stesse credenziali
  // (alcuni endpoint usano username invece di email)
  const loginPayloads = [
    { email: testEmail, password: testPassword },
    { username: testEmail, password: testPassword },
  ];
  let loginOk = false;
  for (const lp of loginPayloads) {
    const r = await fetch(`http://127.0.0.1:${backendPort}${loginPath}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(lp),
    });
    if (r.ok) { loginOk = true; break; }
  }
  if (!loginOk) throw new Error("login fallito con tutte le varianti di payload");
  return true;
}

// Manda email all'utente quando l'app e' pronta (o quasi).
async function notifyUserAppReady(user, target, status) {
  // Opt-in: l'utente riceve la mail di fine lavoro SOLO se ha messo la
  // spunta nella EstimateView prima di pagare (campo notifyEmailOnReady).
  // Cosi' chi vuole stare incollato al browser non e' spammato.
  if (target?.notifyEmailOnReady !== true) {
    console.log(`[notify] App ${target?.id} pronta — opt-in mail non richiesto, skip.`);
    return;
  }
  const userEmail = user?.email;
  if (!userEmail) return;
  const adminEmail = (process.env.LOCOCODE_ADMIN_EMAIL || "mellucciantonio@gmail.com").trim();
  const smtpHost = process.env.SMTP_HOST;
  if (!smtpHost) {
    console.log(`[notify] SMTP non configurato, skip email a ${userEmail}`);
    return;
  }
  const portValue = Number(process.env.SMTP_PORT || 587);
  const smtpUser = process.env.SMTP_USER || "";
  const smtpPass = process.env.SMTP_PASS || "";
  const from = process.env.SMTP_FROM || smtpUser || "noreply@lococode.local";

  const slug = target.publicSlug || appPublicSlug(target);
  const appUrl = appUrlForApp(target);
  // authOk: true=passed, false=failed, null=not applicable (no auth or website)
  const authPassed = status.authOk !== false; // null o true = ok
  const allOk = status.frontendOk && status.backendPort && status.smokeOk && authPassed && !status.backendCrashLoop;
  const subject = status.backendCrashLoop
    ? `🚨 App "${target.name}" generata ma il backend non parte`
    : allOk
      ? `✓ La tua app "${target.name}" è online!`
      : `⚠ App "${target.name}" generata con avvisi`;

  const minutes = Math.floor(status.elapsedSec / 60);
  const seconds = status.elapsedSec % 60;
  const elapsedText = minutes > 0 ? `${minutes} min ${seconds} sec` : `${seconds} sec`;

  // Se l'app ha auth (authOk true o false != null), mostra le credenziali
  // admin/admin che il backend prompt obbliga a creare al primo avvio.
  // Cosi' l'utente non deve "indovinare" come testare la sua app.
  const hasAuth = status.authOk === true || status.authOk === false;
  const adminCredsBlock = hasAuth
    ? `<div style="margin:24px 0;padding:18px 22px;background:#fef3c7;border-left:4px solid #f59e0b;border-radius:8px">
         <div style="font-size:13px;font-weight:700;color:#92400e;margin-bottom:6px;letter-spacing:0.04em;text-transform:uppercase">CREDENZIALI PER IL PRIMO ACCESSO</div>
         <div style="font-size:14px;color:#451a03;line-height:1.6">
           Email: <code style="background:#fff;padding:2px 8px;border-radius:4px;font-weight:600">admin@admin.it</code><br>
           Password: <code style="background:#fff;padding:2px 8px;border-radius:4px;font-weight:600">admin</code>
         </div>
         <div style="font-size:12px;color:#78350f;margin-top:8px;font-style:italic">Cambiale subito dopo il primo login dal pannello utenti dell'app.</div>
       </div>`
    : "";

  const html = allOk
    ? `<!doctype html><html><body style="font-family:Inter,Arial,sans-serif;background:#f4f6fb;padding:40px 20px;margin:0">
       <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;padding:36px 32px;box-shadow:0 4px 24px rgba(15,23,42,0.08)">
         <div style="text-align:center;margin-bottom:24px">
           <div style="display:inline-block;width:64px;height:64px;border-radius:50%;background:linear-gradient(135deg,#10b981,#059669);line-height:64px;font-size:32px">✓</div>
         </div>
         <h1 style="font-size:24px;margin:0 0 12px;color:#0b1020;text-align:center;letter-spacing:-0.02em">La tua app è online</h1>
         <p style="font-size:15px;color:#475569;line-height:1.65;text-align:center;margin:0 0 28px">
           <strong style="color:#0b1020">${escapeHtml(target.name)}</strong> è stata generata e deployata con successo. Puoi usarla subito.
         </p>
         <div style="text-align:center;margin:32px 0">
           <a href="${appUrl}" style="display:inline-block;background:linear-gradient(135deg,#5b3ee8,#7c5af0);color:#fff;text-decoration:none;padding:14px 32px;border-radius:10px;font-size:15px;font-weight:600">Apri la tua app →</a>
         </div>
         ${adminCredsBlock}
         <div style="border-top:1px solid #e5e7eb;padding-top:20px;margin-top:24px;color:#64748b;font-size:13px;line-height:1.7">
           <div><strong style="color:#0b1020">URL:</strong> ${appUrl}</div>
           <div><strong style="color:#0b1020">Tempo totale:</strong> ${elapsedText}</div>
         </div>
       </div>
       <p style="text-align:center;font-size:12px;color:#94a3b8;margin-top:24px">LocoCode · Generato il ${new Date().toLocaleString("it-IT")}</p>
       </body></html>`
    : `<!doctype html><html><body style="font-family:Inter,Arial,sans-serif;background:#f4f6fb;padding:40px 20px;margin:0">
       <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;padding:36px 32px;box-shadow:0 4px 24px rgba(15,23,42,0.08)">
         <h1 style="font-size:22px;margin:0 0 12px;color:#0b1020;letter-spacing:-0.02em">App generata con avvisi</h1>
         <p style="font-size:15px;color:#475569;line-height:1.65;margin:0 0 24px">
           <strong>${escapeHtml(target.name)}</strong> è stata generata ma alcuni controlli post-generazione hanno mostrato avvisi.
         </p>
         <ul style="font-size:14px;color:#475569;line-height:1.8;padding-left:20px">
           <li>Frontend: ${status.frontendOk ? "✓ OK" : "⚠ problema build"}</li>
           <li>Backend: ${status.backendPort ? `✓ porta ${status.backendPort}` : "⚠ non deployato"}</li>
           <li>Smoke test: ${status.smokeOk ? "✓ OK" : "⚠ controllo fallito"}</li>
           ${status.authOk === false ? `<li style="color:#b45309">⚠ Auth: ${escapeHtml(status.authReport || "register/login non funziona")}</li>` : status.authOk === true ? `<li>Auth: ✓ register+login verificati</li>` : ""}
         </ul>
         ${adminCredsBlock}
         <p style="margin-top:20px"><a href="${appUrl}">${appUrl}</a></p>
       </div>
       </body></html>`;
  // Versione testuale (fallback per client mail vecchi).
  const adminCredsText = hasAuth
    ? `\n\nCREDENZIALI PRIMO ACCESSO:\n  Email: admin@admin.it\n  Password: admin\nCambiale dal pannello utenti dopo il primo login.\n`
    : "";
  const text = `${allOk ? "La tua app e' online!" : "App generata con avvisi"}\n\n${target.name}\nURL: ${appUrl}${adminCredsText}\n\nLocoCode - ${new Date().toLocaleString("it-IT")}`;

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: portValue,
    secure: String(process.env.SMTP_SECURE || "").toLowerCase() === "true" || portValue === 465,
    auth: smtpUser && smtpPass ? { user: smtpUser, pass: smtpPass } : undefined,
  });
  await transporter.sendMail({ from, to: userEmail, subject, html, text });
  console.log(`[notify] Email inviata a ${userEmail} per app ${target.id} (allOk=${allOk})`);
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

    const wireframeStart = Date.now();
    const aiResult = await callOpenRouter({
      apiKey,
      model,
      systemPrompt: "Sei un designer UI. Genera solo il blocco file richiesto, senza spiegazioni.",
      userPrompt: wireframePrompt,
      maxTokens: 2500,
      timeoutMs: openRouterTimeoutMs,
      returnUsage: true,
    });
    const aiText = aiResult.text;
    if (aiResult.usage) {
      target.tokenUsage = target.tokenUsage || {};
      target.tokenUsage.wireframe = {
        model,
        promptTokens: aiResult.usage.prompt_tokens || 0,
        completionTokens: aiResult.usage.completion_tokens || 0,
        totalTokens: aiResult.usage.total_tokens || 0,
        durationMs: Date.now() - wireframeStart,
        at: new Date().toISOString(),
      };
    }

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

  const followupStart = Date.now();
  const aiResult = await callOpenRouter({
    apiKey,
    model,
    systemPrompt,
    userPrompt: prompt,
    maxTokens: 60000,
    timeoutMs: openRouterTimeoutMs,
    returnUsage: true,
  });
  const aiText = aiResult.text;
  const aiUsage = aiResult.usage;
  // Accumula i token di ogni follow-up sotto la chiave "followup"
  if (aiUsage) {
    target.tokenUsage = target.tokenUsage || {};
    const prev = target.tokenUsage.followup || { model, promptTokens: 0, completionTokens: 0, totalTokens: 0, durationMs: 0, calls: 0 };
    target.tokenUsage.followup = {
      model,
      promptTokens: prev.promptTokens + (aiUsage.prompt_tokens || 0),
      completionTokens: prev.completionTokens + (aiUsage.completion_tokens || 0),
      totalTokens: prev.totalTokens + (aiUsage.total_tokens || 0),
      durationMs: prev.durationMs + (Date.now() - followupStart),
      calls: prev.calls + 1,
      at: new Date().toISOString(),
    };
  }
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
  // Modelli per fase basati sul tier scelto dall'utente. Fallback al modello
  // globale (admin override) se il tier non specifica nulla.
  const tier = target.generationTier || "base";
  const isWebsite = target.kind === "website";

  // Web search per siti vetrina: chiamiamo un modello "online" (Perplexity
  // Sonar) per cercare info reali sull'attivita': telefono, indirizzo, orari,
  // link foto reali. Questo arricchimento e' usato come contesto extra per la
  // generazione. Costa ~€0.01 ma evita info inventate.
  let webEnrichment = "";
  if (isWebsite) {
    try {
      onProgress?.({ phase: "web-search", message: "Ricerca info reali sull'attivita' sul web..." });
      webEnrichment = await searchBusinessInfo(userPrompt, apiKey);
      if (webEnrichment) {
        appendOperationalLog(target, "✓ Info reali trovate sul web.");
      }
    } catch (err) {
      console.warn(`[web-search] fallita per ${target.id}: ${err.message}`);
      appendOperationalLog(target, `⚠ Web search fallita (continuo con info utente): ${err.message.slice(0, 120)}`);
    }
  }

  // In modalita' "sito web vetrina" il prompt viene arricchito con istruzioni
  // tassative: niente backend, niente database, solo frontend statico. Il
  // backend phase viene saltato del tutto piu' sotto.
  const websitePreamble = isWebsite
    ? [
        "═══ MODALITA' SITO WEB VETRINA ═══",
        "Questo NON e' una web app gestionale. E' un sito web statico di presenza online per un'attivita' commerciale.",
        "VINCOLI ASSOLUTI:",
        "- NIENTE backend, NIENTE database, NIENTE login, NIENTE registrazione, NIENTE area utente.",
        "- NESSUN file in backend/. Niente FastAPI, niente Python, niente API.",
        "- Solo frontend React+Vite (gia' fornito) + componenti UI del design system.",
        "- Dati 'finti' realistici hardcoded direttamente nei componenti (orari, menu, contatti, mappa).",
        "- Sezioni obbligatorie: <Hero> grande con CTA, <ChiSiamo>, <MenuServizi>, <Galleria>, <Contatti> con telefono cliccabile (tel: link) + email + mappa Google embed via <iframe src='https://www.google.com/maps?q=...&output=embed'>, <Footer> con orari.",
        "- L'app deve essere SINGLE-PAGE con scroll fluido tra sezioni (anchor link). Non multi-page.",
        "- USA SEMPRE i componenti del design system (Button, Card, ecc.) ma costruisci il contenuto vetrina dentro <PageLayout>... oppure direttamente in App.jsx con sezioni stilizzate glassmorphism.",
        "- Foto: placeholder Unsplash con query coerente (es. https://source.unsplash.com/featured/?pizza,restaurant). NON Lorem Picsum.",
        "═══════════════════════════════════════",
        "",
        ...(webEnrichment ? [
          "═══ INFO REALI TROVATE SUL WEB (USA QUESTE — NON INVENTARE) ═══",
          "Le seguenti informazioni sull'attivita' sono state recuperate da una ricerca web reale e dallo scraping del sito ufficiale.",
          "REGOLE TASSATIVE:",
          "- TELEFONO/INDIRIZZO/ORARI: USA ESATTAMENTE quelli qui sotto. NIENTE numeri inventati.",
          "- TITOLARE/DESCRIZIONE: USA quelli reali, non frasi generiche tipo 'tradizione di famiglia'.",
          "- MENU/PIATTI: USA le voci REALI con i loro nomi specifici e prezzi se presenti.",
          "- FOTO: USA gli URL elencati sotto 'FOTO ESTRATTE DAL SITO UFFICIALE' DIRETTAMENTE in <img src=\"URL_QUI\" />. Sono URL verificati che esistono davvero. NON usare Unsplash o source.unsplash se hai foto reali disponibili.",
          "- LINK SOCIAL (Facebook/Instagram): metti i link nei contatti come <a href> reali.",
          "Solo se un dato manca completamente dalle info qui sotto, usa quello che ha fornito il titolare nel suo prompt.",
          "",
          webEnrichment,
          "═══════════════════════════════════════",
          "",
        ] : []),
        "Richiesta titolare:",
      ].join("\n") + "\n"
    : "";
  const effectivePrompt = websitePreamble + userPrompt;
  const tierModels = getTierModels(tier);
  const modelFor = (phaseKey) => tierModels[phaseKey] || model;

  // Inizializza tracking costi per fase
  target.tokenUsage = target.tokenUsage || {};
  target.generationTier = tier;

  const phases = [
    {
      label: "specifiche progetto",
      phaseNum: 1,
      key: "sdd",
      maxTokens: 60000, // limite alto: lascia che il modello generi tutto senza troncamenti
      model: modelFor("sdd"),
      getPrompt: async () => buildInitialSpecsPrompt(effectivePrompt),
      expectedFiles: isWebsite
        ? [".lc/spec/sdd.md", ".lc/spec/tasks.md", "README.md"]
        : [".lc/spec/sdd.md", ".lc/spec/architecture.md", ".lc/spec/tasks.md", "README.md"],
    },
    // Backend phase: SALTATA quando kind=website (sito vetrina, no server).
    ...(isWebsite ? [] : [{
      label: "parte server",
      phaseNum: 2,
      key: "backend",
      maxTokens: 60000,
      model: modelFor("backend"),
      getPrompt: async () => buildInitialBackendPrompt(effectivePrompt, await loadProjectMemory(target)),
      expectedFiles: ["backend/app/main.py", "backend/requirements.txt", "backend/.env.example"],
    }]),
    {
      label: isWebsite ? "sito vetrina" : "interfaccia utente",
      phaseNum: isWebsite ? 2 : 3,
      key: "frontend",
      maxTokens: 60000, // limite alto: lascia che il modello generi tutto senza troncamenti
      model: modelFor("frontend"),
      getPrompt: async () => buildInitialFrontendPrompt(effectivePrompt, await loadProjectMemory(target)),
      expectedFiles: ["frontend/src/App.jsx", "frontend/package.json", "preview/index.html"],
    },
  ];

  // Tier Pro/Premium: aggiungi una fase finale di Design Review.
  // Un modello diverso (con gusto estetico) rilegge i file frontend, individua
  // problemi visivi (contrasti, layout, leggibilita') e propone correzioni.
  const reviewModel = modelFor("review");
  if (reviewModel) {
    phases.push({
      label: "design review",
      phaseNum: 4,
      key: "review",
      maxTokens: 60000,
      model: reviewModel,
      isReview: true,
      getPrompt: async () => buildDesignReviewPrompt(target),
      expectedFiles: [],
    });
  }

  const touched = [];

  for (const phase of phases) {
    // RESUME: se l'utente ha gia' pagato, le fasi gia' completate vanno saltate.
    // Il SDD viene saltato sempre dopo pagamento. Le altre fasi: solo se i loro
    // expectedFiles esistono gia' (significa che precedente run le aveva fatte).
    if (target.pricing?.status === "paid" && phase.key === "sdd") {
      appendOperationalLog(target, "✓ SDD gia' fatto (skippo, riprendo dopo pagamento).");
      continue;
    }

    const stopReasonBefore = await shouldStop?.();
    if (stopReasonBefore) {
      return {
        summary: stopReasonBefore,
        touched: [...new Set(touched)],
        changedFiles: new Set(touched).size,
        stopped: true,
      };
    }

    const phaseStart = Date.now();
    const aiResult = await callOpenRouter({
      apiKey,
      model: phase.model || model,
      systemPrompt,
      userPrompt: await phase.getPrompt(),
      maxTokens: phase.maxTokens,
      timeoutMs: openRouterTimeoutMs,
      returnUsage: true,
    });
    const aiText = typeof aiResult === "string" ? aiResult : aiResult.text;
    const usage = typeof aiResult === "object" ? aiResult.usage : null;

    // Salva tracking costi della fase (token + ms + modello)
    target.tokenUsage[phase.key] = {
      model: phase.model || model,
      promptTokens: usage?.prompt_tokens || 0,
      completionTokens: usage?.completion_tokens || 0,
      totalTokens: usage?.total_tokens || 0,
      durationMs: Date.now() - phaseStart,
      at: new Date().toISOString(),
    };

    const operations = parseOperations(aiText);
    if (!operations.length) {
      // Per la fase di design review, accettiamo che non ci siano modifiche
      // (significa che il design e' gia' OK secondo il reviewer).
      if (phase.isReview) {
        appendOperationalLog(target, `Design review (${phase.model}): nessuna modifica suggerita, design accettato.`);
        await onProgress?.(phase.label);
        continue;
      }
      throw new Error(
        enrichedErrorMessage(`Fase ${phase.phaseNum} (${phase.label})`, aiText, phase.expectedFiles),
      );
    }

    const result = await applyOperations(target, operations);
    if (result.errors.length) {
      throw new Error(`Fase ${phase.phaseNum} (${phase.label}): operazioni file non valide: ${result.errors.join("; ")}`);
    }

    touched.push(...result.created, ...result.updated);
    if (phase.isReview && result.updated.length > 0) {
      appendOperationalLog(target, `Design review applicato: ${result.updated.length} file frontend migliorati.`);
    }
    await refreshProjectState(target);
    target.updatedAt = new Date().toISOString();
    await onProgress?.(phase.label);

    // Genera wireframe visivo dopo la fase 1 (SDD)
    if (phase.phaseNum === 1) {
      appendOperationalLog(target, "Genero anteprima visiva dell'app...");
      try { await generateWireframePreview({ target, apiKey, model, userPrompt }); } catch {}
      await refreshProjectState(target);
      target.preview = { ...target.preview, buildVersion: (target.preview?.buildVersion || 0) + 1 };
      await onProgress?.(phase.label);

      // ═══ CHECKPOINT PAGAMENTO ═══
      // Se l'utente deve pagare prima di proseguire (flusso normale per utenti
      // non-admin con webapp), qui ci fermiamo: calcoliamo il preventivo dal
      // SDD appena generato, lo salviamo, e ritorniamo segnalando awaitingPayment.
      // L'utente confermera' via UI -> endpoint /confirm-payment ri-avviera' il job
      // che, vedendo pricing.status==="paid", saltera' la fase SDD e proseguira'.
      if (target.pricing?.status === "estimate_pending") {
        const estimate = computePriceFromSdd(target);
        // ASSEGNA il tier dal sistema (non lo sceglie piu' l'utente):
        // suggestedTier diventa il generationTier finale dell'app, cosi' dopo
        // il pagamento le fasi backend/frontend useranno i modelli del tier
        // assegnato (es. Premium = Sonnet 4.5).
        target.generationTier = normalizeTier(estimate.suggestedTier);
        target.pricing = {
          ...(target.pricing || {}),
          ...estimate,
          chosenTier: target.generationTier,
          status: "awaiting_payment",
          estimatedAt: new Date().toISOString(),
        };
        appendOperationalLog(
          target,
          `✓ Analisi pronta. Preventivo €${estimate.priceEur.toFixed(2)} (tier ${estimate.suggestedTier} assegnato, complessita' ${estimate.complexityScore}/100). In attesa di conferma utente.`,
        );

        // Notifica email all'utente se ha richiesto avviso quando preventivo
        // pronto. Asincrono, non blocca la pipeline se SMTP fallisce.
        if (target.notifyEmailOnEstimate && target.ownerEmail) {
          const reviewUrl = `${publicBaseUrl}/`;
          sendUserNotification({
            to: target.ownerEmail,
            subject: `LocoCode: preventivo pronto per "${target.name}"`,
            text: `Ciao,\n\nIl preventivo per la tua app "${target.name}" e' pronto.\nPrezzo: €${estimate.priceEur.toFixed(2)}\n\nApri LocoCode per confermare o annullare:\n${reviewUrl}\n\nNessun addebito senza la tua conferma.`,
            html: `<p>Ciao,</p><p>Il preventivo per la tua app <strong>${target.name}</strong> e' pronto.</p><p><strong>Prezzo: €${estimate.priceEur.toFixed(2)}</strong></p><p><a href="${reviewUrl}" style="display:inline-block;background:#5b3ee8;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Apri LocoCode</a></p><p style="color:#666;font-size:13px">Nessun addebito senza la tua conferma.</p>`,
          }).catch(() => {});
        }

        return {
          summary: `Analisi completata. Preventivo €${estimate.priceEur.toFixed(2)} in attesa di conferma.`,
          touched: [...new Set(touched)],
          changedFiles: new Set(touched).size,
          awaitingPayment: true,
          estimate,
        };
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
  // Mostra i 3 file piu' importanti (preferendo .py/.jsx significativi)
  const isImportant = (f) =>
    f.endsWith("main.py") ||
    f.endsWith("App.jsx") ||
    f.endsWith("main.jsx") ||
    f.includes("/routes/") ||
    f.includes("/components/") ||
    f.includes("/pages/") ||
    f.includes("/models/") ||
    f.includes("/api/");
  const ranked = [...list].sort((a, b) => Number(isImportant(b)) - Number(isImportant(a)));
  const preview = ranked.slice(0, 3).map((f) => f.split("/").pop()).join(", ");
  if (list.length === 0) return "Nessun file modificato";
  if (list.length === 1) return `File modificato: ${preview}`;
  if (list.length <= 3) return `File modificati: ${preview}`;
  return `${list.length} file salvati (incluso ${preview})`;
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
    "- IMPORTANTE: NON inserire MAI flussi di licenza, trial, attivazione, abbonamento, chiavi precaricate o scadenze nell'app generata. Trial, pagamento e abbonamento sono gestiti dal sistema LocoCode (esterno) a monte: l'app deve essere SOLO il prodotto richiesto dall'utente, niente schermate 'Attivazione' o 'Abbonati' o banner trial.",
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
    "ORDINE OBBLIGATORIO DI OUTPUT (scrivi i file in QUESTO ordine — se ti sta finendo lo spazio, taglia gli ULTIMI, mai i primi):",
    "1. .lc/spec/tasks.md          — il piano operativo, FILE PIU CRITICO",
    "2. .lc/spec/architecture.md   — tabelle DB + endpoint API, FILE CRITICO",
    "3. .lc/memory/project_context.md",
    "4. .lc/spec/sdd.md            — puo essere conciso (max 400 parole)",
    "5. .lc/spec/requirements.md   — puo essere conciso (max 200 parole)",
    "6. README.md                  — molto conciso (max 100 parole)",
    "7. deploy/lococode.json",
    "",
    "REGOLA D'ORO: tasks.md e architecture.md DEVONO essere completi anche a costo di tagliare gli altri file. NIENTE FILE VUOTI.",
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
    "- .lc/spec/sdd.md: 5 sezioni brevi: 1) Descrizione progetto (50 parole), 2) Utenti e ruoli (50 parole), 3) Funzionalita principali (bullet list di 6-8 voci), 4) Vincoli tecnici (bullet list), 5) Flusso principale (3-4 step). NIENTE PROSA VERBOSA.",
    "- .lc/spec/architecture.md: tabelle SQLite con colonne e tipi (in markdown table), endpoint FastAPI con metodo/path/payload (lista compatta), componenti React principali (lista nomi). NO descrizioni romanzate.",
    "Il piano deve includere SOLO le funzionalita' richieste dall'utente. NIENTE task su attivazione, licenze, chiavi mensili o abbonamenti: lo gestisce LocoCode esternamente.",
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
    "ORDINE OBBLIGATORIO DI OUTPUT (scrivi i file in QUESTO ordine — se ti sta finendo lo spazio, taglia gli ULTIMI, mai i primi):",
    "1. backend/app/main.py        — IL FILE PIU CRITICO (server FastAPI completo)",
    "2. backend/requirements.txt   — dipendenze, file critico",
    "3. backend/app/__init__.py    — solo riga vuota o version",
    "4. backend/.env.example       — esempio variabili",
    "5. deploy/lococode.json       — config deploy",
    "6. .lc/spec/tasks.md          — aggiornato con task completati",
    "7. .lc/memory/project_context.md",
    "",
    "REGOLA D'ORO: main.py DEVE essere completo e funzionante anche se devi tagliare gli altri. NIENTE FILE VUOTI.",
    "",
    "backend/app/main.py deve includere FastAPI con CORS (allow_origins=['*']), endpoint GET / health check, modelli Pydantic completi, inizializzazione SQLite con tabelle e dati di esempio realistici precaricati al primo avvio, e API CRUD complete coerenti con il progetto.",
    "",
    "UTENTE ADMIN OBBLIGATORIO — Se l'app ha autenticazione utenti, AL PRIMO AVVIO (dentro la funzione che inizializza il DB) crea sempre un utente con:",
    "  email = 'admin@admin.it'   password = 'admin'   role = 'admin' (o equivalente)",
    "Lo aggiungi solo se la tabella users e' vuota (idempotente). Documenta queste credenziali nel README e nel campo 'credentialsHint' di deploy/lococode.json cosi' il proprietario dell'app puo' fare login subito per testarla.",
    "",
    "ROUTE PREFIX OBBLIGATORIO: tutti gli endpoint API DEVONO essere sotto il prefisso /api/. Esempi: POST /api/auth/login, GET /api/lists, POST /api/items. MAI mettere endpoint a /auth/login o /lists. Il backend e' montato dietro un proxy /app/{slug}/api/* quindi DEVE rispondere su /api/*.",
    "",
    "REQUIREMENTS.TXT — REGOLA FERREA: ogni 'import X' nel codice Python DEVE avere il pacchetto giusto in requirements.txt. Mapping tipici da rispettare:",
    "  import jwt          -> PyJWT==2.8.0",
    "  import jose / from jose -> python-jose[cryptography]==3.3.0",
    "  from dotenv import -> python-dotenv==1.0.0",
    "  from email_validator -> email-validator==2.1.0",
    "  import bcrypt       -> bcrypt==4.0.1",
    "  from passlib       -> passlib[bcrypt]==1.7.4 + bcrypt==4.0.1 SEMPRE INSIEME (vedi sotto: bcrypt>=4.1 crasha passlib)",
    "BCRYPT 4.1+ ROMPE PASSLIB 1.7.4 (errore: 'password cannot be longer than 72 bytes' al boot). Se metti passlib[bcrypt] DEVI anche pinnare bcrypt==4.0.1 esplicitamente nello stesso requirements.txt. ALTERNATIVA RACCOMANDATA: usa direttamente la libreria 'bcrypt' (senza passlib) con pattern:\n  import bcrypt\n  def hash_pw(p): return bcrypt.hashpw(p.encode('utf-8')[:72], bcrypt.gensalt()).decode('utf-8')\n  def verify_pw(p, h): return bcrypt.checkpw(p.encode('utf-8')[:72], h.encode('utf-8'))\nNiente passlib, niente CryptContext, zero problemi.",
    "  from sqlalchemy    -> sqlalchemy==2.0.23",
    "  import aiosqlite   -> aiosqlite==0.19.0",
    "  from fastapi       -> fastapi==0.104.1 + uvicorn==0.24.0",
    "  from pydantic      -> pydantic==2.5.2",
    "  from itsdangerous  -> itsdangerous==2.1.2",
    "  import httpx       -> httpx==0.25.2",
    "  import requests    -> requests==2.31.0",
    "ATTENZIONE: PyJWT e python-jose sono DIVERSI. Se importi 'jwt' metti PyJWT. Se importi 'jose' metti python-jose.",
    "Includi SEMPRE in requirements.txt anche python-dotenv anche se non lo importi direttamente — molti template lo aspettano.",
    "",
    "deploy/lococode.json deve descrivere nome servizio, porta suggerita, comando backend, comando build frontend, percorso SQLite, credenziali di prova e API esterne richieste.",
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
    DESIGN_SYSTEM_PROMPT_SECTION,
    "",
    "Memoria progetto:",
    projectMemory,
    "",
    "ORDINE OBBLIGATORIO DI OUTPUT (scrivi i file in QUESTO ordine — se ti sta finendo lo spazio, taglia gli ULTIMI, mai i primi):",
    "1. frontend/src/App.jsx                    — IL FILE PIU CRITICO (root del React app)",
    "2. frontend/src/main.jsx                   — entry point, critico",
    "3. frontend/package.json                   — dipendenze, critico",
    "4. frontend/src/index.css                  — Tailwind directives, critico",
    "5. frontend/tailwind.config.js             — config Tailwind",
    "6. frontend/postcss.config.js              — config PostCSS",
    "7. frontend/index.html                     — entry HTML Vite",
    "8. Altri componenti/pagine (se servono)",
    "9. preview/index.html                      — fallback statico (opzionale)",
    "10. .lc/spec/tasks.md",
    "11. .lc/memory/project_context.md",
    "",
    "REGOLA D'ORO: App.jsx + main.jsx + package.json + index.css DEVONO essere completi e funzionanti. Se devi tagliare, taglia preview/index.html e i task md. NIENTE FILE VUOTI O TRONCATI A META.",
    "",
    "Il frontend deve essere in italiano, gestionale, responsive, navigabile e con dati di prova realistici ma fittizi.",
    "L'utente deve poter provare l'MVP come prodotto: pagine principali, pulsanti, form e routing devono funzionare nella preview reale.",
    "Se l'app usa API esterne, il frontend deve avere una schermata Impostazioni/Chiavi API dove inserire la chiave; senza chiave mostra dati di esempio funzionanti, non si ferma.",
    "FONDAMENTALE - Chiamate API: usa SEMPRE const API = import.meta.env.VITE_API_URL || ''; poi chiama fetch(API + '/endpoint'). Non scrivere mai localhost, 127.0.0.1 o porte hardcoded. VITE_API_URL viene iniettato da LocoCode al build e punta al backend reale.",
    "FONDAMENTALE - Gestione risposte fetch ROBUSTA: ogni helper fetch DEVE controllare il Content-Type prima di chiamare res.json(). Se il backend non e attivo, nginx serve l'index.html invece dell'API e res.json() crasherebbe con 'Unexpected token <'. Pattern obbligatorio: const ct = (res.headers.get('content-type')||'').toLowerCase(); if (!ct.includes('application/json')) throw new Error('Servizio temporaneamente non disponibile.'); Poi try/catch su res.json(). Non mostrare MAI all'utente messaggi tecnici come 'Unexpected token' o 'is not valid JSON' — sempre messaggi friendly italiani.",
    "preview/index.html serve solo da fallback statico se il frontend vero non e ancora pronto.",
    "",
    "★★★ QUALITA' VISIVA = METRICA PRIMARIA DI SUCCESSO ★★★",
    "L'utente paga €1.99-4.99 per generare l'app, e DECIDERA' se abbonarsi (€/mese) o acquistare (€una-tantum) BASANDOSI SULLA BELLEZZA. Se l'app generata sembra fatta nel 2010, lui non si abbona e LocoCode perde il cliente. Se sembra Linear/Stripe/Vercel/Notion/Raycast/Arc Browser, lui si abbona. Non c'e' via di mezzo.",
    "REGOLE DI BELLEZZA NON NEGOZIABILI:",
    " - SEMPRE dark theme coerente con lc-theme.css (body scuro, card semi-trasparenti glass).",
    " - SEMPRE micro-animazioni: hover transition, fade-in al mount (animate-fade-in), scale 105% sui tile cliccabili.",
    " - SEMPRE spaziatura generosa: padding p-6/p-8 sulle card, py-12/16 sulle sezioni, gap-6 nelle grid.",
    " - SEMPRE ombre e bordi sottili: shadow-xl o ring-1 ring-white/10 sulle card, MAI card a fondo piatto.",
    " - SEMPRE gradient nei CTA: bg-gradient-to-r from-indigo-600 to-purple-600, hover:from-indigo-500 to-purple-500.",
    " - SEMPRE icone lucide-react (Sparkles, Activity, TrendingUp, Users, BarChart3, etc.) accanto ai titoli/KPI, mai testi nudi.",
    " - SEMPRE KPI in evidenza: dashboard con 3-4 numeri grandi (text-4xl font-bold) in card colorate. Anche se l'app non e' un gestionale, una mini-dashboard di overview rende SUBITO l'idea di valore.",
    " - SEMPRE empty state curato: quando una lista e' vuota, mostra icona grande + frase invitante + CTA, MAI 'nessun risultato' nudo.",
    " - SEMPRE loading state skeleton (non spinner): usa <div className='animate-pulse bg-slate-800 rounded h-10' /> mentre carichi.",
    " - SEMPRE responsive: mobile su un colonna, desktop su 2-3 colonne. Usa md:grid-cols-2 lg:grid-cols-3.",
    " - VIETATO: testi text-white su bg chiari, testi text-slate-300/400 su bianco, card senza bordo/ombra, layout a tabella nuda, font diversi da Inter.",
    "Se hai dubbi, copia il pattern: header sticky con backdrop-blur + sidebar dark glass + main con cards animate. Vedi App.jsx del design system come riferimento.",
    "",
    "QUALITA' VISIVA OBBLIGATORIA — il frontend DEVE essere bellissimo, moderno e curato come Linear, Stripe Dashboard, Vercel, Notion, Raycast, Arc Browser. Un utente DEVE volerla usare subito e dire 'wow, e bella'. Niente stile bootstrap anni 2010, niente sfondi pure white piatti, niente layout banali.",
    "USA TAILWIND CSS con classi utilitarie direttamente nei JSX. Ogni componente deve avere classi Tailwind complete e dettagliate.",
    "REGOLE ANTI-PASTROCCHIO (violazione = lavoro da rifare):",
    "1. CONTRASTO TESTO: ogni testo DEVE avere contrasto sufficiente sullo sfondo. MAI text-white su bg-white/bg-gray-50/bg-slate-50. MAI text-gray-300/400 su bg-white. Pattern sicuri: text-slate-900 su bg-white, text-slate-100 su bg-slate-900. Per testi secondari: text-slate-600 (non andare oltre text-slate-500 per il body, mai text-slate-300 sul bianco).",
    "2. SFONDO PAGINA: usa SEMPRE bg-slate-50 o bg-gray-50 sul wrapper piu esterno, MAI bg-white piatto. Le card vanno bg-white DENTRO uno sfondo bg-slate-50 cosi staccano. Per landing/hero: bg-gradient-to-br from-slate-50 to-indigo-50 oppure from-indigo-50 via-white to-purple-50.",
    "2bis. COPERTURA VIEWPORT FULL — REGOLA FERREA per evitare bordi bianchi: OGNI return JSX root (root del componente principale e di OGNI page/view) DEVE iniziare con `<div className=\"min-h-screen w-full bg-...\">...</div>`. Il bg DEVE essere applicato sul wrapper piu' esterno con `min-h-screen` E `w-full` per garantire che riempia TUTTA la viewport senza buchi. MAI scrivere `<div>...</div>` come root senza bg+min-h-screen — l'iframe della preview LocoCode si vedrebbe il fondo dark intorno e l'app risulta 'galleggiante'. Esempio CORRETTO root login page: `<div className=\"min-h-screen w-full flex items-center justify-center bg-gradient-to-br from-indigo-900 via-purple-900 to-slate-900 p-4\">...</div>` — qui min-h-screen+w-full garantiscono full coverage. Esempio CORRETTO dashboard: `<div className=\"min-h-screen w-full bg-slate-50\"><Sidebar/><Main/></div>`. Per il file index.css aggiungi anche: `html, body, #root { min-height: 100vh; }` cosi' anche se React monta vuoto il body riempie.",
    "3. INPUT/FORM: input DEVE avere background bianco bg-white E border border-slate-300, mai bg-transparent senza border. Placeholder text-slate-400. Focus: focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500.",
    "4. PULSANTI: primario bg-indigo-600 text-white (mai gradient appena visibili). Secondario bg-white border border-slate-300 text-slate-700. Disabled disabled:opacity-50.",
    "5. NUMERI BIG: testi grandi tipo KPI usano text-3xl/4xl font-bold text-indigo-600 (o slate-900). MAI text-gray-200/300 perche scompaiono.",
    "6. BORDI: ogni card DEVE avere o border border-slate-200 oppure shadow-sm. Mai card senza bordo E senza shadow su fondo chiaro: scompare.",
    "7. STATI HOVER: sempre hover:bg-slate-50 sulle card cliccabili, hover:bg-indigo-700 sui CTA. Senza hover l'app sembra morta.",
    "8. SPACING: padding generoso (p-6/p-8 sulle card, py-12/16 sulle sezioni hero). Niente compatto.",
    "",
    "ISPIRAZIONE VISIVA OBBLIGATORIA — copia questi pattern che funzionano:",
    "- Backgrounds: NIENTE bg-white piatto. Usa bg-gradient-to-br from-slate-50 to-slate-100, o bg-slate-50 con sezioni in bg-white card. Per hero/landing: gradient pastello indigo-50 -> purple-50 -> white.",
    "- Accent gradients: per pulsanti primari, badge importanti, hero text: bg-gradient-to-r from-indigo-600 to-purple-600 (testo: bg-clip-text text-transparent quando usato su testo).",
    "- Ombre sofisticate: shadow-sm su card normali, shadow-lg con hover:shadow-xl per card interattive. Aggiungi sempre ring-1 ring-slate-200 per definire i bordi senza essere aggressivi.",
    "- Microinterazioni: transition-all duration-200 su tutti gli elementi interattivi, hover:scale-[1.02] sulle card, hover:-translate-y-0.5 sui pulsanti primari.",
    "- Spaziatura generosa: padding p-6/p-8 nelle card, gap-6 nelle grid, mb-8 tra sezioni. Non risparmiare spazio.",
    "- Typography raffinata: font-bold tracking-tight per i titoli (text-2xl o text-3xl), text-slate-900 sui titoli, text-slate-600 sui paragrafi, text-sm text-slate-500 sui meta-text.",
    "- Stati vuoti curati: icone grandi (size 48 o 64) in cerchi con bg-slate-100, titolo bold, paragrafo che spiega cosa fare, pulsante d'azione primario.",
    "- Loading states: spinner colorato indigo-600 al centro con messaggio, mai schermate vuote.",
    "- Empty data: dati di esempio realistici e variati, non 'Lorem ipsum' o 'Test 1, Test 2'. Per un app gestionale: clienti realistici (Mario Rossi, Pizzeria da Luigi, Edilizia Verdi srl), date variate, statistiche credibili.",
    "",
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
    "PER LA NAVIGAZIONE: usa React useState per mostrare/nascondere pagine (es. setPage('login')), non react-router. L'app viene servita dentro /app/{slug}/ quindi MAI navigare a path assoluti tipo '/login' o '/dashboard': cambieresti URL al dominio principale e finiresti fuori dall'app. Resta sempre in-page con state.",
    "PER LE DATE: usa new Date().toLocaleDateString('it-IT') nativo, non date-fns.",
    "PER I GRAFICI: usa SVG inline o barre CSS pure, non recharts o chart.js.",
    "PER LE CHIAMATE API — FONDAMENTALE: usa SEMPRE const API = import.meta.env.VITE_API_URL; poi fetch(`${API}/api/auth/login`, ...). MAI fetch('/api/auth/login', ...) — questo finirebbe sul dominio principale LocoCode, non sul tuo backend. VITE_API_URL viene iniettato da LocoCode al build e punta esattamente al tuo backend.",
    "VIETATO assolutamente il fallback || 'http://localhost:8000' o simili — in produzione VITE_API_URL e' SEMPRE settato. Se proprio vuoi un fallback per dev locale usa || '' (stringa vuota), MAI URL hardcoded che farebbero crashare l'app in produzione.",
    "BUG STORICO DA EVITARE: NON usare React Context per passare API_URL. I componenti LoginPage/RegisterPage vengono spesso renderizzati FUORI dal Provider (utente non loggato = no context) -> useContext ritorna null -> API_URL='' -> fetch a path relativo -> chiamata al dominio LocoCode invece che al backend dell'app. SOLUZIONE: in OGNI componente che fa fetch, leggi direttamente `const API_URL = import.meta.env.VITE_API_URL || '';` come variabile locale. NIENTE Context per le URL API.",
    "",
    "BUG STORICO #2 — ROUTING LOGIN/REGISTER:",
    "Quando hai un single-component App con stato `view` (login/register/dashboard) e l'utente non e' loggato, e' VIETATA questa condizione:",
    "  if (!token || view === 'login') { /* mostra login */ }   <-- SBAGLIATO",
    "Motivo: l'utente clicca 'Registrati' -> setView('register'), ma `!token` e' ancora true (non si e' registrato) -> la condizione resta TRUE -> resta bloccato sulla login.",
    "REGOLA: tratta SEMPRE i view come switch espliciti, e il `!token` come redirect SOLO quando view non e' una vista pubblica:",
    "  if (view === 'register') return <RegisterForm/>;",
    "  if (view === 'activation') return <ActivationForm/>;",
    "  if (!token || view === 'login') return <LoginForm/>;",
    "Nota l'ordine: register/activation PRIMA del fallback login. Le vista pubbliche (register/activation/reset-password) DEVONO essere sempre raggiungibili anche senza token.",
    "ANCORA MEGLIO: usa il componente AuthLayout fornito dal design system (`./components/ui`) — gestisce gia' login/register/forgot in modo corretto con uno stato `mode` interno. Esempio:",
    "  import { AuthLayout, Input, Button } from './components/ui';",
    "  function LoginPage({ onLogin }) { return <AuthLayout title='Bentornato' subtitle='Accedi'>...</AuthLayout>; }",
    "  function RegisterPage({ onRegister }) { return <AuthLayout title='Crea account' subtitle='Iniziamo'>...</AuthLayout>; }",
    "E nello switch usa: {view === 'login' && <LoginPage .../>} {view === 'register' && <RegisterPage .../>}",
    "Cosi' eviti il bug della condizione doppia che blocca register.",
    "",
    "BUG STORICO #3 — DOPO LOGIN/REGISTER OK DEVI CAMBIARE VIEW:",
    "Negli handler handleLogin/handleRegister DOPO setToken/setUser DEVI fare ANCHE setView('dashboard') (o qualunque sia la view post-login). Se non lo fai:",
    "  - view resta 'login' anche dopo aver ottenuto il token",
    "  - il prossimo render risbatte sulla login form -> utente vede 'sfarfallio' e resta sulla login",
    "Pattern OBBLIGATORIO:",
    "  const handleLogin = async (e) => {",
    "    ...",
    "    localStorage.setItem('token', data.token);",
    "    setToken(data.token);",
    "    setUser(...);",
    "    setView('dashboard');  // <-- INDISPENSABILE, non saltarlo",
    "    fetchActivationStatus();",
    "  };",
    "Stesso identico pattern per handleRegister.",
    "",
    "BUG STORICO #4 — RENDER LOGIN BASATO SU !token NON SU view==='login':",
    "Il render della form di login DEVE essere: `if (!token && view !== 'register' && view !== 'activation') return <Login/>;`",
    "MAI usare `if (!token || view === 'login')` (vedi Bug #2).",
    "MAI usare `if (view === 'login')` da solo (perderebbe il redirect dopo logout se non resetti il view).",
    "",
    "lucide-react e gia disponibile come alias del server e puo essere importato normalmente.",
    "",
    "VIETATO BANNER TRIAL — NON creare TrialBanner.jsx o qualsiasi componente che mostri scadenze, attivazioni, licenze, abbonamenti. Trial e' gestito esternamente da LocoCode, l'app generata NON deve sapere niente di trial.",
    "",
    "VIETATO MODIFICARE body IN index.css — il file lc-theme.css (iniettato e importato DOPO index.css) imposta il body con tema dark navy + aurora. Se in index.css tu metti `body { @apply bg-gradient-to-br from-slate-50... }` il body diventa CHIARO e contraddice il tema dark di LocoCode, generando 'testi chiari su sfondi chiari'. REGOLA: in index.css NIENTE selettore body (o se serve, SOLO font-family senza background/color). Tutto il resto del body lo gestisce lc-theme.css.",
    "",
    "Aggiorna il piano dei task completati in questa fase.",
    "Restituisci solo blocchi file.",
  ].join("\n");
}

// Prompt per la fase di Design Review (tier Pro/Premium).
// Il reviewer riceve TUTTI i file frontend gia' generati e deve trovare
// problemi visivi e correggerli, senza riprogettare da zero.
async function buildDesignReviewPrompt(target) {
  const root = projectRoot(target);
  const allFiles = await listProjectFiles(root);
  const frontendFiles = allFiles.filter(
    (f) =>
      f.startsWith("frontend/src/") ||
      f === "frontend/tailwind.config.js" ||
      f === "frontend/index.html",
  );

  let bundle = "";
  for (const relPath of frontendFiles) {
    const content = await readProjectFile(target, relPath);
    if (!content) continue;
    bundle += `### FILE: ${relPath}\n\`\`\`\n${content}\n\`\`\`\n\n`;
  }

  return [
    "Sei il PRINCIPAL DESIGNER di Stripe. Hai appena ricevuto questo frontend appena generato. Il tuo lavoro NON e' un piccolo polishing: e' un REDESIGN COMPLETO secondo il tuo gusto.",
    "",
    "L'app deve uscire dall'esecuzione con un look BELLISSIMO, professionale, premium. L'utente paga per questo. Se restituisci una pagina con 'Email/Password' centrata su sfondo bianco con bordi grigi 1px, hai fallito.",
    "",
    "STILE OBBLIGATORIO — NON E' UNA PROPOSTA, E' UN VINCOLO:",
    "",
    "## Hero / Landing / Login pages",
    "- Sfondo: `bg-gradient-to-br from-slate-50 via-white to-indigo-50` minimo, oppure `bg-[#0a0e27]` per dark hero",
    "- Almeno UN elemento decorativo: gradient orb sfumato in alto a destra OR pattern dot sottile OR shape blob astratto sull'angolo",
    "- Titolo principale: text-4xl md:text-5xl font-bold tracking-tight, con UNA parola chiave in gradient text (`bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent`)",
    "- Sottotitolo: text-lg text-slate-600 max-w-md",
    "- CTA principale: gradient button con shadow-xl, hover:shadow-2xl, transition-all duration-200, NON un blu piatto",
    "",
    "## Card / Container",
    "- MAI bg-white piatto su pagine pulite. Usa bg-white/70 backdrop-blur-xl border border-white/60 shadow-xl",
    "- Border radius: rounded-2xl (16px), MAI rounded-md su card grandi",
    "- Inset highlight tramite ring-1 ring-white/40 inset, OR ::before con linear-gradient bianco trasparente",
    "",
    "## Input fields",
    "- bg-white/80 backdrop-blur, border border-slate-200, rounded-xl, py-3 px-4, focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all",
    "- Icona dentro l'input a sinistra (lucide-react) con text-slate-400, focus-within:text-indigo-500",
    "- Placeholder con text-slate-400 italic se vuoi (es. 'esempio@email.com')",
    "",
    "## Buttons",
    "- Primario: bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-semibold rounded-xl shadow-lg shadow-indigo-500/30 hover:shadow-xl hover:shadow-indigo-500/40 transition-all hover:-translate-y-0.5",
    "- Secondario: bg-white/70 backdrop-blur border border-slate-200 text-slate-700 hover:bg-white",
    "",
    "## Dashboard / Liste interne",
    "- Sidebar: bg-slate-900 dark con accent indigo, items con hover:bg-white/5",
    "- Cards: glassmorphism (bg-white/60 backdrop-blur-xl shadow-xl ring-1 ring-slate-200/60)",
    "- KPI numbers: text-4xl font-bold con bg-gradient sui numeri, sotto label uppercase text-xs text-slate-500 tracking-wider",
    "",
    "## Dati di esempio realistici",
    "Se vedi dati tipo 'Test 1', 'Lorem', 'Item A' SOSTITUISCILI con dati credibili italiani al contesto dell'app: nomi (Mario Rossi, Giulia Bianchi), date variate, prezzi realistici, categorie sensate.",
    "",
    "## Animations & microinteractions",
    "- transition-all duration-200 su TUTTI gli elementi cliccabili",
    "- hover:scale-[1.02] sulle card",
    "- Fade-in subtle (opacity + translate-y) sui contenuti che appaiono",
    "",
    "## Color palette indigo + purple come base, ma:",
    "- Stati success: emerald non green-500",
    "- Stati error: rose-500 non red-500",
    "- Stati warning: amber-500 non yellow",
    "- Neutrals: slate non gray",
    "",
    "DESIGN SYSTEM GIA' DISPONIBILE — USALO:",
    "Il progetto ha gia' in frontend/src/components/ui/ i componenti pronti: Button, Card, CardHeader, Input, Textarea, Select, Badge, Empty, Stat, Modal, AuthLayout, PageLayout, SidebarBrand, SidebarItem, SidebarNav, PageHeader.",
    "Quando redesigni una pagina, SOSTITUISCI gli elementi raw con questi componenti:",
    "  - <button className=...> -> <Button variant='primary|secondary|ghost|danger|success' icon={IconLucide}>",
    "  - <input/> standalone -> <Input label=... icon={IconLucide} />",
    "  - <div className='rounded-lg bg-white shadow...'> -> <Card variant='glass'>",
    "  - liste vuote -> <Empty icon={...} title=... description=... />",
    "  - KPI dashboard -> <Stat label=... value=... tone=... icon={...} delta={...} />",
    "  - Pagina login/register -> <AuthLayout title=... subtitle=...>...</AuthLayout>",
    "  - Pagina con sidebar -> <PageLayout sidebar={<><SidebarBrand .../> <SidebarNav>...</SidebarNav></>} header={<PageHeader title=... action={...} />}>",
    "Import path: from './components/ui' (oppure '../components/ui' / '../../components/ui' a seconda della profondita').",
    "",
    "REGOLE OPERATIVE:",
    "- Restituisci TUTTI i file frontend riscritti col nuovo design (App.jsx, ogni page, ogni component). Questa NON e' una review, e' un redesign.",
    "- MAI cambiare la LOGICA (state, useEffect, fetch, props): rimangono identici. Cambia SOLO il JSX (sostituisci raw HTML con componenti UI), classi Tailwind, struttura visuale, palette, tipografia.",
    "- MAI cambiare package.json o vite.config.js.",
    "- MAI riscrivere o creare file in frontend/src/components/ui/ (sono gestiti da LocoCode).",
    "- MAI introdurre librerie nuove (resta su tailwindcss + lucide-react).",
    "- Tutti i contrasti devono essere AA almeno (text-slate-700 sopra bg-white, text-white sopra bg-slate-900, ecc).",
    "- Restituisci ALMENO 5 file riscritti se hai trovato un design banale, sotto forma di blocchi file.",
    "",
    "Ecco tutti i file frontend correnti che devi REDESIGNARE:",
    "",
    bundle,
    "",
    "Adesso fai il tuo lavoro da Principal Designer. L'utente paga per la differenza tra Pro e Base — questo redesign DEVE essere visibilmente piu bello.",
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
    "- DESIGN SYSTEM PREINSTALLATO: il progetto ha gia' i componenti UI 'Liquid Glass' in frontend/src/components/ui/ (Button, Card, CardHeader, Input, Textarea, Select, Badge, Empty, Stat, Modal, AuthLayout, PageLayout, SidebarBrand, SidebarItem, SidebarNav, PageHeader). USA SEMPRE questi componenti importandoli da './components/ui' (o '../components/ui'). NON ricrearli con div+className, NON usare <button>/<input> grezzi. Se il task richiede UI, importa e componi.",
    "- QUALITA' VISIVA: mantieni lo stile premium del design system (gradient indigo->purple, glassmorphism, font Inter). Non degradare mai il livello visivo.",
    "- LIBRERIE VIETATE: non aggiungere mai @heroicons/react, @headlessui/react, @radix-ui/*, recharts, chart.js, react-router-dom, date-fns, axios, lodash. Usa SOLO lucide-react per le icone.",
    "- Mantieni sempre funzionante il link finale: se una chiave API esterna manca, usa dati di prova, non errori.",
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

  // Base assoluto: l'app e servita su /app/{slug}/, quindi gli asset DEVONO usare
  // path assoluti, altrimenti senza slash finale nell'URL il browser cerca /app/assets/...
  const slug = appPublicSlug(target);
  const base = slug ? `/app/${slug}/` : "./";
  // VITE_API_URL = la BASE dell'app, SENZA /api finale. I codici delle app
  // generate dai vari modelli AI scrivono fetch(API + '/api/auth/login')
  // mettendo loro stessi /api/ nell'endpoint. Quindi qui passiamo solo lo
  // slug, il proxy /app/:slug/api/* matcha la rotta e inoltra al backend.
  const apiUrl = slug
    ? `/app/${slug}`
    : `/apps/${target.id}/${target.appToken || target.demoToken || ""}`;

  // Build come SUBPROCESS dalla cartella del frontend: cosi CWD e corretta e
  // PostCSS/Tailwind risolvono i config e i content path senza ambiguita.
  // Il build in-process falliva perche girava dalla CWD del server LocoCode.
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  await execFileAsync(
    npmCommand,
    ["exec", "--no", "--", "vite", "build", "--base", base, "--outDir", outDir, "--emptyOutDir", "--logLevel", "warn"],
    {
      cwd: frontendDirPath,
      env: { ...process.env, VITE_API_URL: apiUrl },
      maxBuffer: 1024 * 1024 * 32,
    },
  );

  return exists(distIndex);
}

// Cerca pattern problematici nei sorgenti React generati dall'AI e li sanifica.
// Es: 'http://localhost:8000' fallback -> '' (stringa vuota: niente piu mixed
// content, e in prod VITE_API_URL e' sempre iniettato).
async function sanitizeFrontendSources(srcDir) {
  if (!(await exists(srcDir))) return;
  const stack = [srcDir];
  const patterns = [
    // fallback || 'http://localhost:PORT' -> || ''
    {
      re: /\|\|\s*['"`]https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?['"`]/g,
      to: "|| ''",
    },
    // : 'http://localhost:PORT'  (es. const x = { API_URL: 'http://localhost:8000' })
    {
      re: /['"`]https?:\/\/(localhost|127\.0\.0\.1):\d+['"`]/g,
      to: "''",
    },
  ];
  while (stack.length) {
    const dir = stack.pop();
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        stack.push(full);
      } else if (/\.(jsx?|tsx?|mjs|cjs)$/.test(e.name)) {
        const content = await fs.readFile(full, "utf8").catch(() => "");
        if (!content) continue;
        let next = content;
        for (const p of patterns) next = next.replace(p.re, p.to);
        if (next !== content) {
          await fs.writeFile(full, next, "utf8");
        }
      }
    }
  }
}

// Iniezione del design system "Liquid Glass" preinstallato.
// Scrive (sovrascrive sempre) i componenti UI pronti in frontend/src/components/ui,
// piu' lc-theme.css e tailwind.config.js custom. Questo garantisce che ogni app
// generata abbia un set di componenti belli a disposizione, indipendentemente
// dall'AI usata. Inoltre auto-importa './lc-theme.css' in src/main.jsx se manca.
async function injectDesignSystem(frontendDirPath) {
  const files = getDesignSystemFiles(frontendDirPath, path);
  // tailwind.config.js viene gestito qui: sempre sovrascritto con la versione
  // brand. (Il fallback piu' avanti nel codice resta come safety net.)
  for (const [rel, content] of Object.entries(files)) {
    const target = path.join(frontendDirPath, rel);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, "utf8");
  }

  // Assicura import './lc-theme.css' in src/main.jsx
  const mainPath = path.join(frontendDirPath, "src", "main.jsx");
  const mainExists = await exists(mainPath);
  if (mainExists) {
    const original = await fs.readFile(mainPath, "utf8").catch(() => "");
    if (original && !/['"`]\.\/lc-theme\.css['"`]/.test(original)) {
      // Inserisci subito dopo l'ultimo import esistente
      const lines = original.split("\n");
      let lastImport = -1;
      for (let i = 0; i < lines.length; i++) {
        if (/^\s*import\b/.test(lines[i])) lastImport = i;
      }
      const themeLine = "import './lc-theme.css';";
      if (lastImport >= 0) {
        lines.splice(lastImport + 1, 0, themeLine);
      } else {
        lines.unshift(themeLine);
      }
      await fs.writeFile(mainPath, lines.join("\n"), "utf8");
      console.log(`[ds] Auto-inserito import lc-theme.css in main.jsx per ${path.basename(frontendDirPath)}`);
    }
  }
}

async function ensureFrontendDependencies(frontendDirPath) {
  const packageJsonPath = path.join(frontendDirPath, "package.json");
  const nodeModulesPath = path.join(frontendDirPath, "node_modules");
  const markerPath = path.join(nodeModulesPath, ".lococode-install.json");

  // --- Iniezione design system preinstallato (sempre, prima della sanitizzazione) ---
  // Scrive frontend/src/components/ui/*.jsx, lc-theme.css e tailwind.config.js brand.
  // L'AI ha l'ordine di importare da './components/ui'. Anche se sgarra, sanitizeFrontendSources
  // ripulisce i pattern problematici.
  await injectDesignSystem(frontendDirPath);

  // --- Sanitize sorgenti: rimuovi fallback localhost hardcoded ---
  // L'AI genera spesso `import.meta.env.VITE_API_URL || 'http://localhost:8000'`.
  // In produzione il fallback finisce comunque nel bundle (anche se NON usato a
  // runtime), e se per qualche motivo il browser legge il bundle vecchio in
  // cache la chiamata HTTPS->HTTP viene bloccata da mixed-content => "Failed to fetch".
  // Sostituisco il fallback con stringa vuota: in produzione VITE_API_URL e' SEMPRE
  // iniettato dal build di LocoCode, quindi il fallback non serve.
  await sanitizeFrontendSources(path.join(frontendDirPath, "src"));

  // --- Patch file di configurazione build (sempre, anche se npm install e gia aggiornato) ---

  // vite.config.js: SEMPRE sovrascritto. Kimi/DeepSeek a volte lo lasciano
  // vuoto o senza plugin react, e senza il plugin React JSX compila a
  // React.createElement (sintassi vecchia) che richiede React globale
  // -> errore "React is not defined" all'esecuzione.
  const viteConfigPath = path.join(frontendDirPath, "vite.config.js");
  await fs.writeFile(
    viteConfigPath,
    `import { defineConfig } from 'vite'\nimport react from '@vitejs/plugin-react'\n\nexport default defineConfig({\n  plugins: [react()],\n  server: { host: '127.0.0.1', port: 5174 }\n})\n`,
    "utf8",
  );

  // postcss.config.js: SEMPRE sovrascritto con formato ESM (i package.json generati
  // sono "type": "module", quindi module.exports causerebbe un crash). E pura
  // infrastruttura di build, non contiene personalizzazioni da preservare.
  const postcssConfigPath = path.join(frontendDirPath, "postcss.config.js");
  await fs.writeFile(
    postcssConfigPath,
    `export default {\n  plugins: {\n    tailwindcss: {},\n    autoprefixer: {},\n  },\n};\n`,
    "utf8",
  );
  // Rimuove eventuali varianti .cjs/.mjs che confonderebbero la risoluzione
  await fs.rm(path.join(frontendDirPath, "postcss.config.cjs"), { force: true }).catch(() => {});
  await fs.rm(path.join(frontendDirPath, "postcss.config.mjs"), { force: true }).catch(() => {});

  // tailwind.config.js: se mancante lo creiamo con content path ASSOLUTI (robusti
  // a qualunque CWD). Se esiste gia (generato dall'AI con il suo tema), lo lasciamo:
  // il build gira come subprocess dalla cartella frontend, quindi i path relativi
  // come './src/**/*' si risolvono correttamente.
  const tailwindConfigPath = path.join(frontendDirPath, "tailwind.config.js");
  if (!(await exists(tailwindConfigPath))) {
    const absHtml = JSON.stringify(path.join(frontendDirPath, "index.html"));
    const absSrc = JSON.stringify(path.join(frontendDirPath, "src/**/*.{js,jsx,ts,tsx}"));
    await fs.writeFile(
      tailwindConfigPath,
      `/** @type {import('tailwindcss').Config} */\nexport default {\n  content: [${absHtml}, ${absSrc}],\n  darkMode: 'class',\n  theme: { extend: {} },\n  plugins: [],\n};\n`,
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

// Scraping HTML del sito ufficiale per estrarre URL diretti delle immagini.
// L'AI poi le usera' come <img src="..."> nel sito vetrina. Filtriamo loghi,
// icone, sprite per tenere solo foto reali del locale/cibo/persone.
async function scrapeWebsiteImages(siteUrl) {
  if (!siteUrl) return [];
  try {
    const ac = new AbortController();
    const timeoutId = setTimeout(() => ac.abort(), 8000);
    const r = await fetch(siteUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; LocoCodeBot/1.0)" },
      signal: ac.signal,
    });
    clearTimeout(timeoutId);
    if (!r.ok) return [];
    const html = await r.text();
    const base = new URL(siteUrl);
    const found = new Set();

    // 1) Tag <img src="...">
    for (const m of html.matchAll(/<img[^>]+(?:src|data-src|data-lazy-src)=["']([^"']+)["']/gi)) {
      try { found.add(new URL(m[1], base).href); } catch {}
    }
    // 2) srcset (prendi la prima URL)
    for (const m of html.matchAll(/srcset=["']([^"']+)["']/gi)) {
      const first = m[1].split(",")[0]?.trim().split(/\s+/)[0];
      if (first) {
        try { found.add(new URL(first, base).href); } catch {}
      }
    }
    // 3) og:image / twitter:image
    for (const m of html.matchAll(/<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)["'][^>]+content=["']([^"']+)["']/gi)) {
      try { found.add(new URL(m[1], base).href); } catch {}
    }
    // 4) background-image: url(...) inline style
    for (const m of html.matchAll(/background-image:\s*url\(['"]?([^'")]+)['"]?\)/gi)) {
      try { found.add(new URL(m[1], base).href); } catch {}
    }

    // Filtra le immagini "vere" (foto del locale/menu/persone)
    const SKIP_KEYWORDS = /(^|[_\-\.\/])(logo|favicon|icon|sprite|placeholder|spacer|loader|spinner|arrow|chevron|bullet|divider|separator|badge|stamp|seal|button|btn|thumb-)([_\-\.\d]|$)/i;
    const photos = [...found].filter((url) => {
      const lower = url.toLowerCase();
      const fileName = lower.split("/").pop() || "";
      // Esclude pattern noti di non-foto (loghi/icone/sprite)
      if (SKIP_KEYWORDS.test(fileName)) return false;
      if (SKIP_KEYWORDS.test(lower)) return false;
      // Esclude micro dimensioni embed in URL/path (es. /16x16/, /32x32/)
      if (/\/\d{1,3}x\d{1,3}\//.test(lower)) return false;
      // Esclude social widgets / pubblicita' / tracker
      if (/google.*tag|googleadservices|doubleclick|facebook\.com\/tr|fbcdn.*\/ad|analytics|gtm/.test(lower)) return false;
      // Accetta solo estensioni foto vere
      if (!/\.(jpe?g|png|webp|avif)(\?|#|$)/i.test(lower)) return false;
      return true;
    });

    // Limita a 8 immagini "diverse" (deduplicazione semplice per nome file)
    const dedupedByName = [];
    const seenNames = new Set();
    for (const url of photos) {
      const fname = url.split("/").pop()?.split("?")[0] || url;
      if (seenNames.has(fname)) continue;
      seenNames.add(fname);
      dedupedByName.push(url);
      if (dedupedByName.length >= 8) break;
    }
    return dedupedByName;
  } catch (err) {
    console.warn(`[scrape] ${siteUrl}: ${err.message}`);
    return [];
  }
}

// Estrae URL del "sito ufficiale" da una risposta perplexity. Cerca prima
// nelle annotations (citazioni), poi nel testo. Preferisce domini che hanno
// il nome del business nel dominio (es. pizzeriabrandi.com) oppure il primo
// non social/non aggregator.
function pickOfficialSiteUrl(perplexityData, businessHint = "") {
  const annotations = perplexityData?.choices?.[0]?.message?.annotations || [];
  const citationUrls = annotations
    .map((a) => a?.url_citation?.url)
    .filter(Boolean);
  const textContent = perplexityData?.choices?.[0]?.message?.content || "";
  const urlsInText = [...textContent.matchAll(/https?:\/\/[^\s\)\]\"<>]+/g)].map((m) => m[0]);
  const allUrls = [...new Set([...citationUrls, ...urlsInText])];

  // Pattern aggregator/social da escludere come "sito ufficiale"
  const AGGREGATOR_PATTERNS = [
    /yelp\.com/i, /tripadvisor\./i, /thefork\./i, /thefork\b/i, /50toppizza\./i,
    /facebook\.com/i, /instagram\.com/i, /tiktok\.com/i, /twitter\.com/i, /x\.com/i,
    /youtube\.com/i, /linkedin\.com/i, /google\.[a-z]+\/maps/i,
    /paginegialle\./i, /paginebianche\./i, /misterimprese\./i, /opentable\./i,
    /thefork\./i, /restaurant.*guru/i, /booking\.com/i, /\.wikipedia\./i,
  ];

  // Normalizza hint (nome business) per matching
  const hintWords = String(businessHint).toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4);

  // Scoring: + match nome business nel dominio, - se aggregator
  const scored = allUrls.map((url) => {
    let score = 0;
    if (AGGREGATOR_PATTERNS.some((p) => p.test(url))) score -= 100;
    try {
      const u = new URL(url);
      const host = u.hostname.toLowerCase();
      // bonus per nome business nel dominio
      for (const w of hintWords) {
        if (host.includes(w)) score += 10;
      }
      // homepage o radice = preferita
      if (u.pathname === "/" || u.pathname === "" || u.pathname.length < 10) score += 3;
    } catch { score -= 50; }
    return { url, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const best = scored.find((s) => s.score > -50);
  return best?.url || "";
}

// Ricerca info reali su un'attivita' usando un modello "online" di OpenRouter
// che ha accesso al web (Perplexity Sonar). Estrae: telefono, indirizzo, orari,
// menu/servizi, foto link reali. Costo ~€0.005 per query. Tempo ~5-10s.
// Inoltre se trova un sito ufficiale fa scraping HTML per estrarre URL foto
// reali del locale (gallery, hero, og:image, ecc.).
// Ritorna stringa formattata pronta per essere inclusa nel prompt, oppure ""
// se non e' riuscito a trovare info.
async function searchBusinessInfo(userPrompt, apiKey) {
  if (!apiKey) return "";
  const systemPrompt = "Sei un assistente di ricerca web. Cerca su Google/Maps informazioni reali e verificabili sull'attivita' commerciale descritta. Ritorna SOLO i dati strutturati che trovi davvero — niente inventato. Se non trovi un dato, ometti la riga corrispondente.";
  const askPrompt = `Trovami le informazioni reali su questa attivita' commerciale (cerca su Google, Google Maps, Pagine Gialle, sito ufficiale, Facebook, Instagram, Tripadvisor):

${userPrompt}

Rispondi ESATTAMENTE in questo formato (ometti le righe che non trovi, NON inventare):

NOME UFFICIALE: ...
INDIRIZZO: ... (via, numero civico, citta', CAP)
TELEFONO: ...
ORARI: ... (giorni e fasce orarie)
SITO UFFICIALE: ... (URL homepage del sito proprio, NON aggregatori tipo Yelp)
PAGINA FACEBOOK: ... (URL pagina FB pubblica se esiste)
PAGINA INSTAGRAM: ... (URL profilo IG pubblico se esiste)
TITOLARE: ... (nome del titolare o chef se presente nelle info pubbliche)
DESCRIZIONE: ... (2-3 frasi dalla loro presentazione reale)
MENU/SERVIZI TIPICI: ... (5-8 voci REALI con prezzi se trovati, una per riga con trattino iniziale)
FOTO REALI: ... (URL DIRETTI a immagini .jpg/.png che hai trovato — dal sito ufficiale, Tripadvisor uploaded photos, Instagram posts — una per riga, fino a 6)
RECENSIONI: ... (rating medio e 2 frasi di review reali tra virgolette)

Se non trovi NULLA di reale sull'attivita' (perche' troppo piccola o nuova) rispondi solo: NO_INFO_FOUND`;

  // Modello online di Perplexity via OpenRouter. Sonar-small e' il piu'
  // economico, fa search reale. Timeout 30s.
  const ac = new AbortController();
  const timeoutId = setTimeout(() => ac.abort(), 30000);
  let perplexityData = null;
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://lococode.mellutecno.it",
        "X-Title": "LocoCode website builder",
      },
      body: JSON.stringify({
        model: "perplexity/sonar",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: askPrompt },
        ],
        max_tokens: 1800,
        temperature: 0.2,
      }),
      signal: ac.signal,
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status}: ${t.slice(0, 200)}`);
    }
    perplexityData = await res.json();
  } finally {
    clearTimeout(timeoutId);
  }

  const content = String(perplexityData?.choices?.[0]?.message?.content || "").trim();
  if (!content || /^NO[_ ]INFO[_ ]FOUND/i.test(content)) return "";

  // Tentativo di scraping del sito ufficiale per estrarre foto vere
  const officialSiteUrl = pickOfficialSiteUrl(perplexityData, userPrompt);
  let scrapedPhotos = [];
  if (officialSiteUrl) {
    console.log(`[web-search] Sito ufficiale trovato: ${officialSiteUrl} — scraping foto...`);
    scrapedPhotos = await scrapeWebsiteImages(officialSiteUrl);
    if (scrapedPhotos.length > 0) {
      console.log(`[web-search] ${scrapedPhotos.length} foto estratte dal sito ufficiale.`);
    }
  }

  // Costruzione output finale: risposta perplexity + foto scrapate
  let output = content;
  if (scrapedPhotos.length > 0) {
    output += "\n\nFOTO ESTRATTE DAL SITO UFFICIALE (questi URL sono VERIFICATI, USA QUESTI in <img src='...'> nel sito vetrina):\n";
    output += scrapedPhotos.map((u) => `- ${u}`).join("\n");
  }
  return output;
}

async function callOpenRouterOnce({
  apiKey,
  model,
  systemPrompt,
  userPrompt,
  maxTokens = 60000,
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

    const text = data.choices?.[0]?.message?.content || "";
    const usage = data.usage || null;
    return { text, usage };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function callOpenRouter(params) {
  const maxAttempts = 4; // retry max 3 volte oltre il primo tentativo
  let lastErr;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      const delayMs = Math.min(30000, Math.pow(2, attempt) * 2000); // 4s, 8s, 16s, max 30s
      console.warn(`[server] callOpenRouter retry ${attempt}/${maxAttempts - 1} dopo ${delayMs / 1000}s (${lastErr?.message?.slice(0, 100)})`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    try {
      const result = await callOpenRouterOnce(params);
      // RISPOSTE VUOTE: se il modello ha risposto con 0 caratteri (glitch rete
      // o rate limit silenzioso), retry come fosse un errore.
      if (!result.text || result.text.trim().length === 0) {
        lastErr = new Error(`Risposta vuota dal modello (tentativo ${attempt + 1}/${maxAttempts})`);
        continue;
      }
      return params.returnUsage ? result : result.text;
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
  const data = await readJsonWithBackup(usersPath, "users");
  return { users: Array.isArray(data?.users) ? data.users : [] };
}

// Legge un JSON. Se mancante/corrotto/vuoto sulla chiave richiesta, prova
// il backup .bak. Cosi' se atomicWriteJson e' stato interrotto, recuperiamo.
async function readJsonWithBackup(filePath, expectedKey) {
  const data = await readJson(filePath);
  if (Array.isArray(data?.[expectedKey])) return data;
  // Main file vuoto/corrotto, prova backup
  const bakPath = `${filePath}.bak`;
  const bak = await readJson(bakPath);
  if (Array.isArray(bak?.[expectedKey])) {
    console.warn(`[recovery] ${filePath} vuoto/corrotto — ripristino da ${bakPath} (${bak[expectedKey].length} item)`);
    // Ripristina il main dal backup
    try {
      await fs.copyFile(bakPath, filePath);
    } catch {}
    return bak;
  }
  return data || {};
}

async function saveUsersStore(store) {
  await atomicWriteJson(usersPath, { users: store.users || [] });
}

// Scrittura atomica: scrivi su .tmp, poi rename atomico al file finale.
// Cosi' se il processo viene killato a meta', il file originale resta intatto.
// Tiene anche un backup .bak del precedente per recovery in caso di disastro.
async function atomicWriteJson(targetPath, data) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const tmpPath = `${targetPath}.tmp.${process.pid}.${Date.now()}`;
  const bakPath = `${targetPath}.bak`;
  const content = JSON.stringify(data, null, 2);

  // Step 1: scrivi su file temporaneo (puo' essere troncato, non ci interessa)
  await fs.writeFile(tmpPath, content, "utf8");

  // Step 2: backup del file corrente (se esiste) prima di sovrascriverlo
  try {
    await fs.copyFile(targetPath, bakPath);
  } catch {} // ignore se non esiste

  // Step 3: rename atomico — su POSIX e' una singola syscall, mai parziale
  await fs.rename(tmpPath, targetPath);
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

function isAdminUser(user) {
  if (!user?.email) return false;
  const adminEmail = (process.env.LOCOCODE_ADMIN_EMAIL || "mellucciantonio@gmail.com").trim().toLowerCase();
  return user.email.trim().toLowerCase() === adminEmail;
}

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt || "",
    isAdmin: isAdminUser(user),
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

// Notifica generica all'utente via email. Usata per:
//   - "preventivo pronto" quando l'analisi SDD finisce
//   - "app pronta" quando la generazione completa termina con smoke OK
// Silenziosa se SMTP non configurato o se to e' vuoto (log warning, no throw).
async function sendUserNotification({ to, subject, text, html }) {
  if (!to) return { sent: false, reason: "no-recipient" };
  const host = process.env.SMTP_HOST;
  const from = process.env.SMTP_FROM || process.env.SMTP_USER || "noreply@lococode.local";
  if (!host) {
    console.warn(`[notify] SMTP non configurato, salto notifica a ${to}: ${subject}`);
    return { sent: false, reason: "no-smtp" };
  }
  try {
    const portValue = Number(process.env.SMTP_PORT || 587);
    const user = process.env.SMTP_USER || "";
    const pass = process.env.SMTP_PASS || "";
    const transporter = nodemailer.createTransport({
      host, port: portValue,
      secure: String(process.env.SMTP_SECURE || "").toLowerCase() === "true" || portValue === 465,
      auth: user && pass ? { user, pass } : undefined,
    });
    await transporter.sendMail({ from, to, subject, text, html: html || `<p>${text}</p>` });
    console.log(`[notify] Email inviata a ${to}: ${subject}`);
    return { sent: true };
  } catch (err) {
    console.warn(`[notify] Errore invio email a ${to}:`, err.message);
    return { sent: false, reason: "smtp-error", error: err.message };
  }
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
  const targetPath = user ? userAppsPath(user.id) : appsPath;
  const data = await readJsonWithBackup(targetPath, "apps");
  return Array.isArray(data?.apps) ? data.apps : [];
}

async function saveApps(apps, user = null) {
  const targetPath = user ? userAppsPath(user.id) : appsPath;
  await atomicWriteJson(targetPath, { apps });
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

  if (target.trialExpiresAt && !isAppActive(target) && new Date(target.trialExpiresAt) < new Date()) {
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

// ─── Pricing / scoring ────────────────────────────────────────────
// 4 stati per il ciclo di vita dell'app:
//   trial               — prova 30gg, codice sorgente locked
//   hosted_lococode_api — abbonamento A: app sul nostro server + nostre API key
//   hosted_user_api     — abbonamento B: app sul nostro server + chiavi utente
//   exported            — pagato one-shot C: utente puo scaricare ZIP completo
// "active" (vecchio nome) viene normalizzato a hosted_lococode_api per retro-compat.
const PAID_LIFECYCLES = new Set(["hosted_lococode_api", "hosted_user_api", "exported", "active"]);
const EXPORT_LIFECYCLES = new Set(["exported"]);

function normalizeLifecycle(value) {
  const v = String(value || "trial").toLowerCase();
  if (v === "active") return "hosted_lococode_api"; // retro-compat
  if (["trial", "hosted_lococode_api", "hosted_user_api", "exported"].includes(v)) return v;
  return "trial";
}

function isAppActive(appData) {
  return PAID_LIFECYCLES.has(String(appData.lifecycle || "").toLowerCase());
}

function isAppExported(appData) {
  return EXPORT_LIFECYCLES.has(String(appData.lifecycle || "").toLowerCase());
}

// Calcola score di complessita dell'app in base ai task completati e file generati.
// Usato per suggerire il tier di prezzo (Starter/Pro/Business/Enterprise).
function computeAppScore(appData) {
  const steps = Array.isArray(appData.sdd?.steps) ? appData.sdd.steps : [];
  const doneTasks = steps.filter((s) => s.done).length;
  const files = Array.isArray(appData.files) ? appData.files : [];
  const fileCount = files.length || appData.fileCount || 0;
  const hasBackend = files.some((f) => typeof f === "string" && f.startsWith("backend/"));
  // Conta integrazioni esterne note (heuristica: import o .env keys)
  const extApis = 0; // riservato per futuro
  const score = Math.round(doneTasks * 6 + fileCount * 1.2 + (hasBackend ? 25 : 0) + extApis * 8);
  return { score, doneTasks, fileCount, hasBackend, extApis };
}

// Prezzi creazione (in EUR) — pagamento UPFRONT per generare l'app.
// Questi prezzi vengono scalati come SCONTO dal primo mese di abbonamento
// o dal pagamento export una tantum. Aggiornati al pricing v4 (€1.99-€4.99
// in base a token SDD). Quando l'app non ha pricing.priceEur (es. admin
// bypass), usiamo €2.99 come stima media per non gonfiare lo sconto fittizio.
const GENERATION_FEES = {
  // Pricing v4: tutti gli utenti sono trattati come "premium" (tier unico),
  // il prezzo varia per app. La key "premium" qui e' il fallback medio.
  starter: 1.99,
  premium: 2.99,
  // Backward compat per app vecchie generate prima del v4:
  base:    1.99,
  media:   2.99,
  pro:     2.99,
};

// Tier post-creazione (Starter/Pro/Business/Enterprise) basato su score reale.
// Determina i prezzi degli abbonamenti hosting e dell'export.
function computeAppPricing(appData) {
  const { score, doneTasks, fileCount, hasBackend } = computeAppScore(appData);
  let tier = "Starter";
  let monthlyLococodeKeys = 9.99;
  let monthlyHostingOnly = 4.99;
  let exportOneShot = 49;
  if (score >= 280) {
    tier = "Enterprise";
    monthlyLococodeKeys = 79.99;
    monthlyHostingOnly = 29.99;
    exportOneShot = 399;
  } else if (score >= 130) {
    tier = "Business";
    monthlyLococodeKeys = 39.99;
    monthlyHostingOnly = 14.99;
    exportOneShot = 199;
  } else if (score >= 50) {
    tier = "Pro";
    monthlyLococodeKeys = 19.99;
    monthlyHostingOnly = 9.99;
    exportOneShot = 99;
  }

  // Prezzo EFFETTIVAMENTE pagato per la creazione: priorita' al nuovo flusso
  // pricing (dinamico, calcolato post-SDD sulla complessita' reale). Se manca
  // (es. app legacy generata prima del flusso pricing, o admin), usa il
  // prezzo statico del tier scelto.
  const genTier = String(appData.generationTier || "base").toLowerCase();
  const paidEur = Number(appData.pricing?.priceEur || 0);
  const isPaid = appData.pricing?.status === "paid" && paidEur > 0;
  const generationFeeEur = isPaid ? paidEur : (GENERATION_FEES[genTier] ?? GENERATION_FEES.base);

  // Sconto: il prezzo di creazione viene SCALATO dal primo mese di abbonamento
  // o dal pagamento export, MA solo se l'utente passa effettivamente al pagato.
  // Esempio: hai pagato 4,99 EUR per Media. Se ti abboni Hosting LocoCode a
  // 19,99/mese, il PRIMO mese costera' 19,99 - 4,99 = 15,00. Dal secondo mese
  // di nuovo 19,99 pieno.
  const firstMonthLococodeKeys = Math.max(0, Number((monthlyLococodeKeys - generationFeeEur).toFixed(2)));
  const firstMonthHostingOnly  = Math.max(0, Number((monthlyHostingOnly - generationFeeEur).toFixed(2)));
  const exportOneShotDiscounted = Math.max(0, Number((exportOneShot - generationFeeEur).toFixed(2)));

  return {
    score,
    tier,
    metrics: { doneTasks, fileCount, hasBackend },
    generationTier: genTier,
    generationFeeEur,
    plans: {
      hosted_lococode_api: {
        monthlyEur: monthlyLococodeKeys,
        firstMonthEur: firstMonthLococodeKeys,
        label: "Hosting + chiavi LocoCode",
      },
      hosted_user_api: {
        monthlyEur: monthlyHostingOnly,
        firstMonthEur: firstMonthHostingOnly,
        label: "Hosting + chiavi tue",
      },
      exported: {
        oneShotEur: exportOneShot,
        oneShotEurDiscounted: exportOneShotDiscounted,
        label: "Export self-host",
      },
    },
  };
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
  const lifecycle = normalizeLifecycle(appData.lifecycle);
  const isActive = isAppActive(appData);
  const trialDaysLeft = trialExpiresAt && !isActive
    ? Math.max(0, Math.ceil((new Date(trialExpiresAt) - new Date()) / 86400000))
    : null;
  const pricing = computeAppPricing(appData);

  // Calcolo costo totale generazione (stima EUR) dal tokenUsage salvato.
  // Tariffe in EUR per 1k token. Valori calibrati su misurazioni reali
  // OpenRouter (DeepSeek aggiornato dopo test del 15/05/2026).
  const TOKEN_PRICES_EUR_PER_K = {
    "anthropic/claude-sonnet-4.5": { in: 0.003, out: 0.015 },
    "anthropic/claude-haiku-4.5":  { in: 0.001, out: 0.005 },
    "openai/gpt-5":                { in: 0.003, out: 0.015 },
    "openai/gpt-5-mini":           { in: 0.0006, out: 0.003 },
    "google/gemini-2.5-pro":       { in: 0.002, out: 0.010 },
    "google/gemini-2.5-flash":     { in: 0.0003, out: 0.0015 },
    "deepseek/deepseek-v4-pro":    { in: 0.0005, out: 0.0035 }, // calibrato 15/05/2026
    "moonshotai/kimi-k2.6":        { in: 0.0006, out: 0.0025 },
    "qwen/qwen3-coder":            { in: 0.0004, out: 0.0014 },
    "x-ai/grok-4-fast":            { in: 0.0008, out: 0.0030 },
  };
  let totalCostEur = 0;
  const usage = appData.tokenUsage || {};
  for (const phaseKey of Object.keys(usage)) {
    const u = usage[phaseKey];
    const prices = TOKEN_PRICES_EUR_PER_K[u.model] || { in: 0.001, out: 0.003 };
    totalCostEur += (u.promptTokens / 1000) * prices.in + (u.completionTokens / 1000) * prices.out;
  }

  return {
    ...safe,
    lifecycle,
    trialExpiresAt,
    trialDaysLeft,
    pricing,
    sourceLocked: !isAppExported(appData),
    licenseRequested: appData.licenseRequested || false,
    generationTier: appData.generationTier || "base",
    tokenUsage: usage,
    generationCostEur: Number(totalCostEur.toFixed(4)),
    authSmokeTest: appData.authSmokeTest || null,
    paymentFlow: appData.pricing || null,
    backendPort: appData.backendPort || null,
    backendOnline: !!appData.backendPort,
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
