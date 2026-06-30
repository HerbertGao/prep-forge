import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Standalone, additive admin audit trail (task 5.2). Records human confirmation
// of imported content (题目/答案/知识点映射) BY REFERENCE: entity_id holds the
// imported row's own id as a value — this table NEVER reads back into nor
// modifies questions/question_solutions/question_kp_links. The derived id
// (`confirm#<entityType>:<entityId>`) makes re-confirming the same entity an
// UPSERT, not a duplicate. No Zod counterpart: it has no import source and is
// not a domain object (parity is table ⊇ Zod, so its absence keeps parity green).
export const adminConfirmations = pgTable("admin_confirmations", {
  id: text("id").primaryKey(), // confirm#<entityType>:<entityId>
  entityType: text("entity_type").notNull(), // 'question' | 'answer' | 'kp_link'
  entityId: text("entity_id").notNull(),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }).notNull().defaultNow(),
  note: text("note"),
});
