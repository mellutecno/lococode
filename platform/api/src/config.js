// Centralized env loader. Importato dovunque serva config (server, db, plugins).
// In dev .env e' opzionale; in production le var devono essere settate fuori.
import "dotenv/config";

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
    defaultModel: opt("OPENROUTER_DEFAULT_MODEL", "openai/gpt-4o-mini"),
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
};

export const isDev = config.env !== "production";
