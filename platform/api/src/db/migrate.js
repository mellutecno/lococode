// Runtime migrator. Eseguito ad ogni boot dell'API per applicare migrations
// pendenti. In produzione si puo' fare anche via `drizzle-kit migrate` da CI,
// ma tenerlo in-app garantisce che il DB sia sempre in sync con il codice.
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function runMigrations() {
  const client = postgres(config.databaseUrl, { max: 1 });
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: path.join(__dirname, "migrations") });
  await client.end();
}

// Se eseguito direttamente con `node src/db/migrate.js`
if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations()
    .then(() => {
      console.log("✓ Migrations applied");
      process.exit(0);
    })
    .catch((err) => {
      console.error("✗ Migration failed:", err);
      process.exit(1);
    });
}
