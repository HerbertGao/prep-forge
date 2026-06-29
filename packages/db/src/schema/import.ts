import { boolean, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import {
  importErrorSeverityEnum,
  importRunStatusEnum,
  importedEntityStatusEnum,
  originEnum,
  sourceDocumentStatusEnum,
  visibilityEnum,
} from "./common";

// Legacy import provenance tables — mirror @prep-forge/schemas/import.ts.
// Stable source-block identity = source_path + heading_path + normalized_key;
// content_hash is change-detection only (设计决策 2, ARCHITECTURE §4.5).

export const importRuns = pgTable("import_runs", {
  id: text("id").primaryKey(),
  sourceRepo: text("source_repo"),
  sourceRef: text("source_ref"),
  sourceRootPath: text("source_root_path").notNull(),
  dryRun: boolean("dry_run").notNull(),
  status: importRunStatusEnum("status").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

export const sourceDocuments = pgTable("source_documents", {
  id: text("id").primaryKey(),
  importRunId: text("import_run_id")
    .notNull()
    .references(() => importRuns.id),
  sourcePath: text("source_path").notNull(),
  sourceRepo: text("source_repo"),
  sourceRef: text("source_ref"),
  status: sourceDocumentStatusEnum("status").notNull(),
  contentHash: text("content_hash"),
});

export const sourceBlocks = pgTable(
  "source_blocks",
  {
    id: text("id").primaryKey(),
    importRunId: text("import_run_id")
      .notNull()
      .references(() => importRuns.id),
    sourceDocumentId: text("source_document_id")
      .notNull()
      .references(() => sourceDocuments.id),
    // stable natural key
    sourcePath: text("source_path").notNull(),
    headingPath: jsonb("heading_path").notNull(),
    normalizedKey: text("normalized_key").notNull(),
    // content + location
    lineRange: jsonb("line_range").notNull(),
    rawBlock: text("raw_block").notNull(),
    contentHash: text("content_hash").notNull(),
    sourceRepo: text("source_repo"),
    sourceRef: text("source_ref"),
  },
  (t) => [
    // source-block stable identity (设计决策 2): unique, excludes content_hash.
    uniqueIndex("source_blocks_identity_uq").on(t.sourcePath, t.headingPath, t.normalizedKey),
  ],
);

export const importedEntities = pgTable("imported_entities", {
  id: text("id").primaryKey(),
  origin: originEnum("origin").notNull(),
  visibility: visibilityEnum("visibility").notNull(),
  importRunId: text("import_run_id")
    .notNull()
    .references(() => importRuns.id),
  sourceBlockId: text("source_block_id")
    .notNull()
    .references(() => sourceBlocks.id),
  entityType: text("entity_type").notNull(),
  naturalKey: text("natural_key").notNull(),
  contentHash: text("content_hash").notNull(),
  status: importedEntityStatusEnum("status").notNull(),
  payload: jsonb("payload"),
});

export const importErrors = pgTable("import_errors", {
  id: text("id").primaryKey(),
  importRunId: text("import_run_id")
    .notNull()
    .references(() => importRuns.id),
  sourceDocumentId: text("source_document_id").references(() => sourceDocuments.id),
  sourceBlockId: text("source_block_id").references(() => sourceBlocks.id),
  sourcePath: text("source_path"),
  headingPath: jsonb("heading_path"),
  rawBlock: text("raw_block"),
  severity: importErrorSeverityEnum("severity").notNull(),
  kind: text("kind").notNull(),
  message: text("message").notNull(),
});
