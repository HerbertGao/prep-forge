// @prep-forge/schemas — Phase 0 shared Zod schemas.
//
// Schema SoT (设计决策 3，task 2.7):
//   Zod schemas in this package are the SINGLE source of truth for Phase 0
//   domain shapes. packages/db (Drizzle, Group C) MUST match these and is
//   derived from them (drizzle-zod or a parity test guards against drift).
//   TS uses camelCase; Drizzle maps to snake_case columns. Do not hand-maintain
//   a second schema definition.
//
// Conventions:
//   - Every domain object carries stable `id`, `origin` and `visibility`
//     (public|personal) — see common.ts baseEntityFields.
//   - Imported domain objects link back to provenance via sourceBlockId +
//     contentHash (common.ts provenanceFields). contentHash is change-detection
//     only; it is NOT part of any stable natural key (设计决策 2).

export * from "./common";
export * from "./import";
export * from "./curriculum";
export * from "./questions";
export * from "./learner-state";
export * from "./lesson";
export * from "./contracts";

export const SCHEMAS_PACKAGE = "@prep-forge/schemas";
