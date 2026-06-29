import { boolean, index, integer, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { baseEntityColumns, provenanceColumns } from "./columns";

// Question-bank tables (public content) — mirror @prep-forge/schemas/questions.ts.

export const questions = pgTable(
  "questions",
  {
    ...baseEntityColumns(),
    courseCode: text("course_code").notNull(),
    src: text("src").notNull(),
    questionId: text("question_id").notNull(),
    // fallback natural-key fields (设计决策 2)
    stemHash: text("stem_hash"),
    chapterNo: text("chapter_no"),
    sequence: integer("sequence"),
    stem: text("stem").notNull(),
    type: text("type").notNull(),
    ...provenanceColumns(),
  },
  (t) => [uniqueIndex("questions_natural_key_uq").on(t.courseCode, t.src, t.questionId)],
);

export const questionOptions = pgTable(
  "question_options",
  {
    ...baseEntityColumns(),
    questionId: text("question_id").notNull(),
    label: text("label").notNull(),
    content: text("content").notNull(),
    isCorrect: boolean("is_correct"),
    ...provenanceColumns(),
  },
  // practice load joins options per question_id (13k-row table) — avoid a seq scan.
  (t) => [index("question_options_question_id_idx").on(t.questionId)],
);

export const questionSolutions = pgTable(
  "question_solutions",
  {
    ...baseEntityColumns(),
    questionId: text("question_id").notNull(),
    answer: text("answer").notNull(),
    explanation: text("explanation"),
    ...provenanceColumns(),
  },
  // practice load fetches solutions per question_id (13k-row table) — avoid a seq scan.
  (t) => [index("question_solutions_question_id_idx").on(t.questionId)],
);

export const questionBankStats = pgTable("question_bank_stats", {
  ...baseEntityColumns(),
  courseCode: text("course_code").notNull(),
  src: text("src"),
  declaredCount: integer("declared_count"),
  parsedCount: integer("parsed_count"),
  typeDistribution: jsonb("type_distribution"),
  ...provenanceColumns(),
});

export const questionKpLinks = pgTable(
  "question_kp_links",
  {
    ...baseEntityColumns(),
    questionId: text("question_id").notNull(),
    courseCode: text("course_code").notNull(),
    kpCode: text("kp_code").notNull(),
    ...provenanceColumns(),
  },
  // practice/admin filters by course_code, while grader/packet/event paths fetch
  // links by question_id IN (...); both hot paths need indexes on the 13k-row table.
  (t) => [
    index("question_kp_links_course_code_idx").on(t.courseCode),
    index("question_kp_links_question_id_idx").on(t.questionId),
  ],
);
