import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Database = ReturnType<typeof drizzle<typeof schema>>;

/** Connect using DATABASE_URL (or an explicit url). Throws if neither is set. */
export function createDb(url: string | undefined = process.env.DATABASE_URL): Database {
  if (!url) {
    throw new Error("DATABASE_URL is not set (see .env.example / infra/docker-compose.yml)");
  }
  const sql = postgres(url);
  return drizzle(sql, { schema });
}
