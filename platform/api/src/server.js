// MelluCode API entrypoint: builda l'app, applica migrations, ascolta.
import { config } from "./config.js";
import { runMigrations } from "./db/migrate.js";
import { buildApp } from "./app.js";

async function main() {
  const app = await buildApp();

  // In dev applichiamo migrations automatiche cosi' non serve un comando manuale.
  // In production e' meglio gestirle via CI ma per ora va bene cosi'.
  try {
    await runMigrations();
    app.log.info("✓ Database migrations up to date");
  } catch (err) {
    app.log.error({ err }, "Migration failed at boot");
    process.exit(1);
  }

  try {
    await app.listen({ port: config.port, host: config.host });
    app.log.info(`mellucode-api listening on http://${config.host}:${config.port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, async () => {
      app.log.info(`Received ${sig}, shutting down`);
      await app.close();
      process.exit(0);
    });
  }
}

main();
