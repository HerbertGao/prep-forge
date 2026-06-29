import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  // generate works offline; migrate/push read this at runtime.
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://prepforge:prepforge@localhost:5432/prepforge",
  },
});
