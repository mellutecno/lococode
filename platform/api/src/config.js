// Centralized env loader. Importato dovunque serva config (server, db, plugins).
// In dev .env e' opzionale; in production le var devono essere settate fuori.
import "dotenv/config";

const DEFAULT_OPENROUTER_MODEL = "openai/gpt-4o-mini";
// Default orchestrator (schema generation + revision chat): modello PREMIUM
// per dare app vere, non scarabocchi. Override possibile via env
// ORCHESTRATOR_MODEL. Smoke 2026-05-18: claude-sonnet-4 produce schemi
// notevolmente migliori (capisce dominio italiano, format giusti, enum
// sensati) rispetto a gpt-4o-mini. Costo ~$0.01-0.05/app vs $0.0006
// (sempre margine enorme rispetto a un prezzo €1.99+).
const DEFAULT_ORCHESTRATOR_MODEL = "anthropic/claude-sonnet-4";
const DEFAULT_FRONTEND_CODEGEN_MODEL = "anthropic/claude-opus-4";

function req(key, fallback) {
  const v = process.env[key] ?? fallback;
  if (v === undefined || v === "") {
    throw new Error(`Env var ${key} is required`);
  }
  return v;
}

function opt(key, fallback = "") {
  return process.env[key] ?? fallback;
}

export const config = {
  env: opt("NODE_ENV", "development"),
  port: Number(opt("PORT", "5000")),
  host: opt("HOST", "127.0.0.1"),

  databaseUrl: req("DATABASE_URL"),

  jwt: {
    secret: req("JWT_SECRET"),
    accessTtl: opt("JWT_ACCESS_TTL", "15m"),
    refreshTtl: opt("JWT_REFRESH_TTL", "30d"),
  },

  cors: {
    origins: opt("CORS_ORIGINS", "*").split(",").map(s => s.trim()).filter(Boolean),
  },

  admin: {
    emails: opt("ADMIN_EMAILS", "mellucciantonio@gmail.com")
      .split(",")
      .map(s => s.trim().toLowerCase())
      .filter(Boolean),
  },

  storage: {
    // STORAGE_DIR e' relativo o assoluto; resolveStoragePath() lo normalizza.
    // In dev: ./storage (gitignored). In prod: /opt/mellucode/storage.
    dir: opt("STORAGE_DIR", "./storage"),
    // Limite per singolo upload. 10 MB di default. Cambiabile via env.
    maxUploadBytes: Number(opt("UPLOAD_MAX_BYTES", "10485760")),
  },

  openrouter: {
    apiKey: opt("OPENROUTER_API_KEY"),
    baseUrl: opt("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"),
    transport: opt("OPENROUTER_TRANSPORT"),
    appUrl: opt("OPENROUTER_APP_URL", "https://mellucode.mellutecno.it"),
    appTitle: opt("OPENROUTER_APP_TITLE", "MelluCode"),
    defaultModel: opt("OPENROUTER_DEFAULT_MODEL", DEFAULT_OPENROUTER_MODEL),
    allowedModels: opt("OPENROUTER_ALLOWED_MODELS", "").split(",").map(s => s.trim()).filter(Boolean),
    timeoutMs: Number(opt("OPENROUTER_TIMEOUT_MS", "120000")),
    maxTokensDefault: Number(opt("AI_DEFAULT_MAX_TOKENS", "512")),
    maxTokensLimit: Number(opt("AI_MAX_TOKENS", "2048")),
    defaultMonthlyCredits: Number(opt("AI_DEFAULT_MONTHLY_CREDITS", "0")),
    reservePerRequestCredits: Number(opt("AI_RESERVE_PER_REQUEST_CREDITS", "0.05")),
    fallbackCostPer1kTokensCredits: Number(opt("AI_FALLBACK_COST_PER_1K_TOKENS_CREDITS", "0.01")),
  },

  smtp: {
    // Valori speciali per test/dev:
    // - json: Nodemailer non apre connessioni, produce solo un messaggio JSON.
    // - stream: Nodemailer produce un buffer RFC822 senza spedire davvero.
    transport: opt("SMTP_TRANSPORT"),
    host: opt("SMTP_HOST"),
    port: Number(opt("SMTP_PORT", "587")),
    secure: opt("SMTP_SECURE", "false") === "true",
    user: opt("SMTP_USER"),
    pass: opt("SMTP_PASS"),
    from: opt("SMTP_FROM", "noreply@mellucode.local"),
  },

  orchestrator: {
    model: opt("ORCHESTRATOR_MODEL", DEFAULT_ORCHESTRATOR_MODEL),
    // 0 = nessun cap MelluCode: non inviamo max_tokens a OpenRouter.
    // Il provider/modello conserva comunque i suoi limiti fisici.
    maxTokens: Number(opt("ORCHESTRATOR_MAX_TOKENS", "0")),
    // 0 = nessun taglio artificiale del numero di entita' generate.
    maxEntities: Number(opt("ORCHESTRATOR_MAX_ENTITIES", "0")),
  },

  generatedApps: {
    templateDir: opt("GENERATED_APP_TEMPLATE_DIR"),
    publishDir: opt("GENERATED_APPS_DIR"),
    buildRoot: opt("GENERATED_APP_BUILD_ROOT"),
    sdkDir: opt("MELLUCODE_SDK_DIR"),
    buildTimeoutMs: Number(opt("GENERATED_APP_BUILD_TIMEOUT_MS", "600000")),
    codegenEnabled: opt("FRONTEND_CODEGEN_ENABLED", "false") === "true",
    codegenModel: opt("FRONTEND_CODEGEN_MODEL", opt("ORCHESTRATOR_MODEL", DEFAULT_FRONTEND_CODEGEN_MODEL)),
    codegenMaxTokens: Number(opt("FRONTEND_CODEGEN_MAX_TOKENS", "0")),
    codegenRetries: Number(opt("FRONTEND_CODEGEN_RETRIES", "3")),
    // Codegen con modelli premium puo' richiedere piu' di 2 minuti.
    // Teniamo un timeout di sicurezza per non lasciare socket appesi per ore,
    // ma non un tappo basso che fa fallire build valide.
    codegenTimeoutMs: Number(opt("FRONTEND_CODEGEN_TIMEOUT_MS", opt("OPENROUTER_TIMEOUT_MS", "600000"))),
  },
};

export const isDev = config.env !== "production";
