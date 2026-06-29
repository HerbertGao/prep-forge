import { defineConfig } from "drizzle-kit";

// generate works offline; migrate/push need a real DATABASE_URL. Fail fast for
// those rather than silently falling back to localhost and writing to the wrong
// database. generate doesn't include "migrate"/"push" in argv, so it stays offline.
const needsDb = process.argv.some((a) => a === "migrate" || a === "push");
const url = process.env.DATABASE_URL ?? "";
if (needsDb && !url) {
  throw new Error("DATABASE_URL is required for drizzle-kit migrate/push");
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dbCredentials: { url },
});
