import { text } from "drizzle-orm/pg-core";
import { originEnum, visibilityEnum } from "./common";
import { sourceBlocks } from "./import";

// Fresh column builders for the fields every domain table shares.
// Functions (not constants) because Drizzle column builders are single-use.
// Mirrors @prep-forge/schemas common.ts baseEntityFields + provenanceFields.

export const baseEntityColumns = () => ({
  id: text("id").primaryKey(),
  origin: originEnum("origin").notNull(),
  visibility: visibilityEnum("visibility").notNull(),
});

export const provenanceColumns = () => ({
  // nullable: system/AI-generated rows have no source block.
  sourceBlockId: text("source_block_id").references(() => sourceBlocks.id),
  contentHash: text("content_hash"),
});
