import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Database = ReturnType<typeof drizzle<typeof schema>>;

// One postgres pool (+ drizzle wrapper) per distinct url for the lifetime of the
// process. Without this, every createDb() call — and RSC/scripts call it a lot —
// opened a fresh pool that nothing could close, leaking connections.
const pools = new Map<string, Database>();

/** Connect using DATABASE_URL (or an explicit url). Throws if neither is set. */
export function createDb(url: string | undefined = process.env.DATABASE_URL): Database {
  if (!url) {
    throw new Error("DATABASE_URL is not set (see .env.example / infra/docker-compose.yml)");
  }
  let db = pools.get(url);
  if (!db) {
    db = drizzle(postgres(url), { schema });
    pools.set(url, db);
  }
  return db;
}
