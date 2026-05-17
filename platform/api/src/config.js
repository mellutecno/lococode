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
  },

  smtp: {
    host: opt("SMTP_HOST"),
    port: Number(opt("SMTP_PORT", "587")),
    secure: opt("SMTP_SECURE", "false") === "true",
    user: opt("SMTP_USER"),
    pass: opt("SMTP_PASS"),
    from: opt("SMTP_FROM", "noreply@mellucode.local"),
  },
};

export const isDev = config.env !== "production";
