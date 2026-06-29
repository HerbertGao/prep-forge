import { doublePrecision, jsonb, pgTable, text } from "drizzle-orm/pg-core";
import { kpStateEnum } from "./common";
import { baseEntityColumns, provenanceColumns } from "./columns";

// Personal learning-state tables (visibility = personal) — mirror
// @prep-forge/schemas/learner-state.ts. Kept SEPARATE from public content
// tables (ARCHITECTURE §7: 公共与个人不可混表).

export const learnerKpStates = pgTable("learner_kp_states", {
  ...baseEntityColumns(),
  learnerId: text("learner_id").notNull(),
  courseCode: text("course_code").notNull(),
  kpCode: text("kp_code").notNull(),
  state: kpStateEnum("state").notNull(),
  score: doublePrecision("score"),
  ...provenanceColumns(),
});

export const mistakes = pgTable("mistakes", {
  ...baseEntityColumns(),
  learnerId: text("learner_id"),
  courseCode: text("course_code"),
  kpCode: text("kp_code"),
  questionRef: text("question_ref"),
  category: text("category"),
  note: text("note"),
  ...provenanceColumns(),
});

export const reviewItems = pgTable("review_items", {
  ...baseEntityColumns(),
  learnerId: text("learner_id"),
  courseCode: text("course_code"),
  kpCode: text("kp_code").notNull(),
  dueDate: text("due_date"),
  status: text("status"),
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
