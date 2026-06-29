import { sql } from "drizzle-orm";
import {
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { kpStateEnum } from "./common";
import { baseEntityColumns, provenanceColumns } from "./columns";

// Personal learning-state tables (visibility = personal) — mirror
// @prep-forge/schemas/learner-state.ts. Kept SEPARATE from public content
// tables (ARCHITECTURE §7: 公共与个人不可混表).
//
// Phase 1 additive audit columns (design D11/D12) are drizzle-only and nullable:
// parity is one-directional (table ⊇ Zod), so they need no Zod mirror. Dedup
// authority is the derived id + ON CONFLICT(id); the partial-unique index below
// is only redundant protection for system projection rows (all keys notNull).

export const learnerKpStates = pgTable(
  "learner_kp_states",
  {
    ...baseEntityColumns(),
    learnerId: text("learner_id").notNull(),
    courseCode: text("course_code").notNull(),
    kpCode: text("kp_code").notNull(),
    state: kpStateEnum("state").notNull(),
    score: doublePrecision("score"),
    // audit pointer (not identity) — last event folded into this cumulative row.
    lastAppliedSessionId: text("last_applied_session_id"),
    lastAppliedSequence: integer("last_applied_sequence"),
    ...provenanceColumns(),
  },
  (t) => [
    uniqueIndex("learner_kp_states_system_natural_uq")
      .on(t.learnerId, t.courseCode, t.kpCode)
      .where(sql`${t.origin} = 'system'`),
  ],
);

export const mistakes = pgTable("mistakes", {
  ...baseEntityColumns(),
  learnerId: text("learner_id"),
  courseCode: text("course_code"),
  kpCode: text("kp_code"),
  questionRef: text("question_ref"),
  category: text("category"),
  note: text("note"),
  // 1:1 traceability + identity (design D12); no status column (no reader).
  sourceSessionId: text("source_session_id"),
  sourceSequence: integer("source_sequence"),
  // admin advisory audit mark (design D11) — written only on origin=system rows.
  adminConfirmedAt: timestamp("admin_confirmed_at", { withTimezone: true }),
  ...provenanceColumns(),
});

export const reviewItems = pgTable("review_items", {
  ...baseEntityColumns(),
  learnerId: text("learner_id"),
  courseCode: text("course_code"),
  kpCode: text("kp_code").notNull(),
  dueDate: text("due_date"),
  status: text("status"),
  // audit pointer (per-KP terminal row, not 1:1 — no source_*). last_applied_at
  // = max created_at of folded events, gating admin confirmation (design D11/D12).
  lastAppliedSessionId: text("last_applied_session_id"),
  lastAppliedSequence: integer("last_applied_sequence"),
  lastAppliedAt: timestamp("last_applied_at", { withTimezone: true }),
  adminConfirmedAt: timestamp("admin_confirmed_at", { withTimezone: true }),
  ...provenanceColumns(),
});

export const studyPlans = pgTable("study_plans", {
  ...baseEntityColumns(),
  learnerId: text("learner_id"),
  examTrack: text("exam_track"),
  title: text("title"),
  slots: jsonb("slots"),
  ...provenanceColumns(),
});

export const dailyLogs = pgTable("daily_logs", {
  ...baseEntityColumns(),
  learnerId: text("learner_id"),
  date: text("date").notNull(),
  content: text("content").notNull(),
  ...provenanceColumns(),
});
