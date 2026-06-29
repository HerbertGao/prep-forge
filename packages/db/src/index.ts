// @prep-forge/db — Drizzle schema + client + seed/import helpers.
//
// Schema SoT (设计决策 3): tables here mirror @prep-forge/schemas (Zod). The
// parity test (src/schema.parity.test.ts) guards against drift.

export const DB_PACKAGE = "@prep-forge/db";

export * as schema from "./schema";
export * from "./client";
export * from "./publish";
