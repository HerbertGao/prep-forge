import { jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { courseExamStatusEnum } from "./common";
import { baseEntityColumns, provenanceColumns } from "./columns";

// Curriculum tables — mirror @prep-forge/schemas/curriculum.ts.
// Natural keys (设计决策 2) enforced via unique indexes.

export const examTracks = pgTable(
  "exam_tracks",
  {
    ...baseEntityColumns(),
    examTrack: text("exam_track").notNull(),
    title: text("title"),
    examDate: text("exam_date"),
    ...provenanceColumns(),
  },
  (t) => [uniqueIndex("exam_tracks_natural_key_uq").on(t.examTrack)],
);

export const courses = pgTable(
  "courses",
  {
    ...baseEntityColumns(),
    courseCode: text("course_code").notNull(),
    slug: text("slug"),
    name: text("name").notNull(),
    examTrack: text("exam_track"),
    examStatus: courseExamStatusEnum("exam_status").notNull(),
    ...provenanceColumns(),
  },
  (t) => [uniqueIndex("courses_natural_key_uq").on(t.courseCode)],
);

export const subjects = pgTable(
  "subjects",
  {
    ...baseEntityColumns(),
    subjectCode: text("subject_code").notNull(),
    courseCode: text("course_code"),
    name: text("name").notNull(),
    examTrack: text("exam_track"),
    ...provenanceColumns(),
  },
  (t) => [uniqueIndex("subjects_natural_key_uq").on(t.subjectCode)],
);

export const chapters = pgTable(
  "chapters",
  {
    ...baseEntityColumns(),
    courseCode: text("course_code").notNull(),
    chapterNo: text("chapter_no").notNull(),
    title: text("title").notNull(),
    ...provenanceColumns(),
  },
  (t) => [uniqueIndex("chapters_natural_key_uq").on(t.courseCode, t.chapterNo)],
);

export const knowledgePoints = pgTable(
  "knowledge_points",
  {
    ...baseEntityColumns(),
    courseCode: text("course_code").notNull(),
    kpCode: text("kp_code").notNull(),
    title: text("title").notNull(),
    chapterNo: text("chapter_no"),
    examFrequency: text("exam_frequency"),
    ...provenanceColumns(),
  },
  (t) => [uniqueIndex("knowledge_points_natural_key_uq").on(t.courseCode, t.kpCode)],
);

export const learnerProfiles = pgTable(
  "learner_profiles",
  {
    ...baseEntityColumns(),
    learnerId: text("learner_id").notNull(),
    displayName: text("display_name"),
    examTrack: text("exam_track"),
    preferences: jsonb("preferences"),
    ...provenanceColumns(),
  },
  (t) => [uniqueIndex("learner_profiles_natural_key_uq").on(t.learnerId)],
);
