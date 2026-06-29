import { and, eq, inArray } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import type { ZodType } from "zod";
import {
  Chapter,
  Course,
  DailyLogEntry,
  ExamTrack,
  ImportedEntity,
  KnowledgePoint,
  LearnerKpState,
  LearnerProfile,
  Mistake,
  Question,
  QuestionBankStats,
  QuestionKpLink,
  QuestionOption,
  QuestionSolution,
  ReviewItem,
  StudyPlan,
  Subject,
} from "@prep-forge/schemas";
import type { Database } from "./client";
import {
  chapters,
  courses,
  dailyLogs,
  examTracks,
  importedEntities,
  importErrors,
  knowledgePoints,
  learnerKpStates,
  learnerProfiles,
  mistakes,
  questionBankStats,
  questionKpLinks,
  questionOptions,
  questionSolutions,
  questions,
  reviewItems,
  studyPlans,
  subjects,
} from "./schema";

/**
 * entity_type vocabulary the importer (Group D) writes into imported_entities,
 * and the only types publishStaged knows how to publish into domain tables.
 */
export const EntityType = {
  examTrack: "exam_track",
  course: "course",
  subject: "subject",
  chapter: "chapter",
  knowledgePoint: "knowledge_point",
  learnerProfile: "learner_profile",
  question: "question",
  questionOption: "question_option",
  questionSolution: "question_solution",
  questionBankStats: "question_bank_stats",
  questionKpLink: "question_kp_link",
  learnerKpState: "learner_kp_state",
  mistake: "mistake",
  reviewItem: "review_item",
  studyPlan: "study_plan",
  dailyLogEntry: "daily_log_entry",
} as const;

type Registration = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table: PgTable<any>;
  schema: ZodType;
  // natural-key columns for idempotent upsert; defaults to the `id` PK.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  conflict: any[];
};

// Maps entity_type -> { domain table, validating Zod schema, upsert conflict
// target }. Idempotency is by natural key where a table has one; the importer
// derives stable ids from the same natural key so id-conflict tables stay
// idempotent too (设计决策 2).
const REGISTRY: Record<string, Registration> = {
  [EntityType.examTrack]: { table: examTracks, schema: ExamTrack, conflict: [examTracks.examTrack] },
  [EntityType.course]: { table: courses, schema: Course, conflict: [courses.courseCode] },
  [EntityType.subject]: { table: subjects, schema: Subject, conflict: [subjects.subjectCode] },
  [EntityType.chapter]: {
    table: chapters,
    schema: Chapter,
    conflict: [chapters.courseCode, chapters.chapterNo],
  },
  [EntityType.knowledgePoint]: {
    table: knowledgePoints,
    schema: KnowledgePoint,
    conflict: [knowledgePoints.courseCode, knowledgePoints.kpCode],
  },
  [EntityType.learnerProfile]: {
    table: learnerProfiles,
    schema: LearnerProfile,
    conflict: [learnerProfiles.learnerId],
  },
  [EntityType.question]: {
    table: questions,
    schema: Question,
    conflict: [questions.courseCode, questions.src, questions.questionId],
  },
  [EntityType.questionOption]: {
    table: questionOptions,
    schema: QuestionOption,
    conflict: [questionOptions.id],
  },
  [EntityType.questionSolution]: {
    table: questionSolutions,
    schema: QuestionSolution,
    conflict: [questionSolutions.id],
  },
  [EntityType.questionBankStats]: {
    table: questionBankStats,
    schema: QuestionBankStats,
    conflict: [questionBankStats.id],
  },
  [EntityType.questionKpLink]: {
    table: questionKpLinks,
    schema: QuestionKpLink,
    conflict: [questionKpLinks.id],
  },
  [EntityType.learnerKpState]: {
    table: learnerKpStates,
    schema: LearnerKpState,
    conflict: [learnerKpStates.id],
  },
  [EntityType.mistake]: { table: mistakes, schema: Mistake, conflict: [mistakes.id] },
  [EntityType.reviewItem]: { table: reviewItems, schema: ReviewItem, conflict: [reviewItems.id] },
  [EntityType.studyPlan]: { table: studyPlans, schema: StudyPlan, conflict: [studyPlans.id] },
  [EntityType.dailyLogEntry]: { table: dailyLogs, schema: DailyLogEntry, conflict: [dailyLogs.id] },
};

export type PublishResult = {
  published: number;
  skipped: number;
  blocked: number;
};

/**
 * Write staged candidates into imported_entities (status defaults to "staged").
 * Deterministic write only — no parsing. Validates each row against the
 * ImportedEntity schema first.
 */
export async function stageEntities(
  db: Database,
  rows: ReadonlyArray<unknown>,
): Promise<number> {
  if (rows.length === 0) return 0;
  const values = rows.map((r) => {
    const e = ImportedEntity.parse(r);
    return { ...e, status: e.status ?? "staged" };
  });
  await db.insert(importedEntities).values(values).onConflictDoNothing();
  return values.length;
}

/**
 * Publish step (设计决策 2): explicit, separate from staging. Reads "staged"
 * imported_entities for one run and upserts them into domain tables by natural
 * key. Rows whose source block has an import_error of severity quarantine|error
 * are NEVER published; rows already in quarantine/error status are excluded by
 * the status filter. Quarantine raw blocks stay in place for human review.
 */
export async function publishStaged(db: Database, importRunId: string): Promise<PublishResult> {
  const blockedRows = await db
    .select({ sourceBlockId: importErrors.sourceBlockId })
    .from(importErrors)
    .where(
      and(
        eq(importErrors.importRunId, importRunId),
        inArray(importErrors.severity, ["quarantine", "error"]),
      ),
    );
  const blockedBlocks = new Set(
    blockedRows.map((r) => r.sourceBlockId).filter((v): v is string => Boolean(v)),
  );

  const staged = await db
    .select()
    .from(importedEntities)
    .where(
      and(eq(importedEntities.importRunId, importRunId), eq(importedEntities.status, "staged")),
    );

  let published = 0;
  let blocked = 0;

  for (const entity of staged) {
    if (blockedBlocks.has(entity.sourceBlockId)) {
      blocked += 1;
      continue;
    }
    const reg = REGISTRY[entity.entityType];
    // REGISTRY is complete for Phase 0; surface an unknown type loudly rather
    // than silently dropping it (no-silent-drop).
    if (!reg) throw new Error(`unknown entity_type: ${entity.entityType}`);
    const row = reg.schema.parse(entity.payload) as Record<string, unknown>;
    const { id: _id, ...set } = row;
    await db
      .insert(reg.table)
      .values(row)
      .onConflictDoUpdate({ target: reg.conflict, set });
    await db
      .update(importedEntities)
      .set({ status: "published" })
      .where(eq(importedEntities.id, entity.id));
    published += 1;
  }

  return { published, skipped: 0, blocked };
}
