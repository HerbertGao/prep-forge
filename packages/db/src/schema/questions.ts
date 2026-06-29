import { boolean, integer, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
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

export const questionOptions = pgTable("question_options", {
  ...baseEntityColumns(),
  questionId: text("question_id").notNull(),
  label: text("label").notNull(),
  content: text("content").notNull(),
  isCorrect: boolean("is_correct"),
  ...provenanceColumns(),
});

export const questionSolutions = pgTable("question_solutions", {
  ...baseEntityColumns(),
  questionId: text("question_id").notNull(),
  answer: text("answer").notNull(),
  explanation: text("explanation"),
  ...provenanceColumns(),
});

export const questionBankStats = pgTable("question_bank_stats", {
  ...baseEntityColumns(),
  courseCode: text("course_code").notNull(),
  src: text("src"),
  declaredCount: integer("declared_count"),
  parsedCount: integer("parsed_count"),
  typeDistribution: jsonb("type_distribution"),
  ...provenanceColumns(),
});

export const questionKpLinks = pgTable("question_kp_links", {
  ...baseEntityColumns(),
  questionId: text("question_id").notNull(),
  courseCode: text("course_code").notNull(),
  kpCode: text("kp_code").notNull(),
  ...provenanceColumns(),
});
