// MelluCode API entrypoint.
// Fastify monolite. Carica plugins, registra routes, avvia.
import Fastify from "fastify";
import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import { config, isDev } from "./config.js";
import { runMigrations } from "./db/migrate.js";
import authPlugin from "./plugins/auth.js";
import authRoutes from "./routes/auth.js";

async function main() {
  const app = Fastify({
    logger: isDev
      ? { level: "info", transport: { target: "pino-pretty" } }
      : { level: "info" },
    trustProxy: true,
  });

  // ---------- Core plugins ----------
  await app.register(cors, {
    origin: config.cors.origins.includes("*") ? true : config.cors.origins,
    credentials: true,
  });
  await app.register(sensible);
  await app.register(authPlugin);

  // ---------- Health ----------
  app.get("/v1/health", async () => ({
    ok: true,
    service: "mellucode-api",
    version: "0.1.0",
    env: config.env,
    timestamp: new Date().toISOString(),
  }));

  // ---------- Routes ----------
  await app.register(authRoutes, { prefix: "/v1/auth" });

  // ---------- Migrations on boot ----------
  // In dev applichiamo migrations automatiche cosi' non serve un comando manuale.
  // In production e' meglio gestirle via CI ma per ora va bene cosi'.
  try {
    await runMigrations();
    app.log.info("✓ Database migrations up to date");
  } catch (err) {
    app.log.error({ err }, "Migration failed at boot");
    process.exit(1);
  }

  // ---------- Listen ----------
  try {
    await app.listen({ port: config.port, host: config.host });
    app.log.info(`mellucode-api listening on http://${config.host}:${config.port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  // ---------- Graceful shutdown ----------
  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, async () => {
      app.log.info(`Received ${sig}, shutting down`);
      await app.close();
      process.exit(0);
    });
  }
}

main();
