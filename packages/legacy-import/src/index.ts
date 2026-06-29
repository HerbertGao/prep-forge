// @prep-forge/legacy-import — read-only importer for the ai-teacher snapshot.
//
// Pipeline (设计决策 1/2): scan → extract source blocks (with content_hash) →
// parse (core / subject / question-bank) → classify per-entity public|personal
// → cross-file warnings → report. --dry-run produces a report only; a real run
// stages into imported_entities then publishes via @prep-forge/db. Stable
// natural keys (设计决策 2) make re-imports idempotent; content_hash drives
// update-vs-create. The source is NEVER written.

export { parseSnapshot, runImport } from "./pipeline";
export type { ImportOptions, ImportOutcome, ParseSnapshotResult } from "./pipeline";
export { scanSnapshot, StructureError, recognize } from "./scanner";
export type { Candidate, Issue, ScannedDoc } from "./types";

export const LEGACY_IMPORT_PACKAGE = "@prep-forge/legacy-import";
