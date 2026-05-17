// Drizzle client. Imported by routes that need DB.
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { config } from "../config.js";
import * as schema from "./schema.js";

// max connessioni: tieni basso per dev (1-5), in produzione 20+.
const client = postgres(config.databaseUrl, {
  max: config.env === "production" ? 20 : 5,
  idle_timeout: 30,
  connect_timeout: 10,
});

export const db = drizzle(client, { schema, logger: config.env === "development" });
export { schema };
