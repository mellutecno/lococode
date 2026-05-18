// Builder dell'app Fastify, isolato dal listen e dalle migrations.
// Serve a entrambi:
//   - src/server.js (entrypoint produzione: build + migrate + listen + shutdown)
//   - src/test/integration.test.js (build + inject, niente listen)
import Fastify from "fastify";
import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import multipart from "@fastify/multipart";
import { config, isDev } from "./config.js";
import authPlugin from "./plugins/auth.js";
import authRoutes from "./routes/auth.js";
import tenantRoutes from "./routes/tenants.js";
import appAuthRoutes from "./routes/appAuth.js";
import dataRoutes from "./routes/data.js";
import filesRoutes from "./routes/files.js";
import emailRoutes from "./routes/email.js";
import aiRoutes from "./routes/ai.js";

export async function buildApp(opts = {}) {
  const loggerOpt = opts.logger !== undefined
    ? opts.logger
    : (isDev
      ? { level: "info", transport: { target: "pino-pretty" } }
      : { level: "info" });

  const app = Fastify({
    logger: loggerOpt,
    trustProxy: true,
  });

  await app.register(cors, {
    origin: config.cors.origins.includes("*") ? true : config.cors.origins,
    credentials: true,
  });
  await app.register(sensible);
  await app.register(authPlugin);
  await app.register(multipart, {
    limits: {
      fileSize: config.storage.maxUploadBytes,
      files: 1,
    },
  });

  app.get("/v1/health", async () => ({
    ok: true,
    service: "mellucode-api",
    version: "0.1.0",
    env: config.env,
    timestamp: new Date().toISOString(),
  }));

  await app.register(authRoutes, { prefix: "/v1/auth" });
  await app.register(tenantRoutes, { prefix: "/v1/tenants" });
  await app.register(appAuthRoutes, { prefix: "/v1/app-auth" });
  await app.register(dataRoutes, { prefix: "/v1/data" });
  await app.register(filesRoutes, { prefix: "/v1/files" });
  await app.register(emailRoutes, { prefix: "/v1/email" });
  await app.register(aiRoutes, { prefix: "/v1/ai" });

  return app;
}
