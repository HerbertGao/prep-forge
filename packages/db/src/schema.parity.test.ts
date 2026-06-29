import { describe, expect, it } from "vitest";
import { getTableColumns } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import type { ZodType } from "zod";
import * as S from "@prep-forge/schemas";
import * as T from "./schema";

// SoT drift guard (task 2.7 / 3.x): every field of a Zod schema in
// @prep-forge/schemas MUST be covered by a column on the matching Drizzle
// table. Tables may carry EXTRA columns (e.g. the session_events Phase-1
// envelope, lesson_steps FK/order) — parity is one-directional: table ⊇ Zod.
// A few Zod fields are normalized into a child table instead of a column; those
// are listed in `relationalFields` and skipped.

type Pair = {
  name: string;
  schema: ZodType;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table: PgTable<any>;
  relationalFields?: string[];
};

const PAIRS: Pair[] = [
  // provenance
  { name: "ImportRun", schema: S.ImportRun, table: T.importRuns },
  { name: "SourceDocument", schema: S.SourceDocument, table: T.sourceDocuments },
  { name: "SourceBlock", schema: S.SourceBlock, table: T.sourceBlocks },
  { name: "ImportedEntity", schema: S.ImportedEntity, table: T.importedEntities },
  { name: "ImportError", schema: S.ImportError, table: T.importErrors },
  // curriculum
  { name: "ExamTrack", schema: S.ExamTrack, table: T.examTracks },
  { name: "Course", schema: S.Course, table: T.courses },
  { name: "Subject", schema: S.Subject, table: T.subjects },
  { name: "Chapter", schema: S.Chapter, table: T.chapters },
  { name: "KnowledgePoint", schema: S.KnowledgePoint, table: T.knowledgePoints },
  { name: "LearnerProfile", schema: S.LearnerProfile, table: T.learnerProfiles },
  // questions
  { name: "Question", schema: S.Question, table: T.questions },
  { name: "QuestionOption", schema: S.QuestionOption, table: T.questionOptions },
  { name: "QuestionSolution", schema: S.QuestionSolution, table: T.questionSolutions },
  { name: "QuestionBankStats", schema: S.QuestionBankStats, table: T.questionBankStats },
  { name: "QuestionKpLink", schema: S.QuestionKpLink, table: T.questionKpLinks },
  // lesson
  {
    name: "LessonPacket",
    schema: S.LessonPacket,
    table: T.lessonPackets,
    relationalFields: ["steps"], // normalized into lesson_steps
  },
  { name: "LessonStep", schema: S.LessonStep, table: T.lessonSteps },
  { name: "SessionEvent", schema: S.SessionEvent, table: T.sessionEvents },
  // learner state
  { name: "LearnerKpState", schema: S.LearnerKpState, table: T.learnerKpStates },
  { name: "Mistake", schema: S.Mistake, table: T.mistakes },
  { name: "ReviewItem", schema: S.ReviewItem, table: T.reviewItems },
  { name: "StudyPlan", schema: S.StudyPlan, table: T.studyPlans },
  { name: "DailyLogEntry", schema: S.DailyLogEntry, table: T.dailyLogs },
];

function zodFields(schema: ZodType): string[] {
  // ZodObject (and Zod 4 refined objects) expose `.shape` directly.
  const shape = (schema as unknown as { shape?: Record<string, unknown> }).shape;
  if (!shape) throw new Error("schema has no .shape");
  return Object.keys(shape);
}

describe("Drizzle ⇄ Zod schema parity (SoT = @prep-forge/schemas)", () => {
  it.each(PAIRS)("$name table covers every Zod field", ({ schema, table, relationalFields }) => {
    const columns = new Set(Object.keys(getTableColumns(table)));
    const skip = new Set(relationalFields ?? []);
    const missing = zodFields(schema).filter((f) => !skip.has(f) && !columns.has(f));
    expect(missing, `missing columns: ${missing.join(", ")}`).toEqual([]);
  });
});

// Enum value-set parity: each Drizzle pgEnum's value set MUST equal the matching
// Zod enum's value set. Without this, adding a value to a Zod enum (e.g. KpState)
// without updating the pgEnum drifts silently. The Zod enum for lesson_step_type
// is inline on LessonStep.type (no named export), so reach into its `.options`.
type EnumPair = { name: string; pgValues: readonly string[]; zodValues: readonly string[] };
const ENUM_PAIRS: EnumPair[] = [
  { name: "origin", pgValues: T.originEnum.enumValues, zodValues: S.Origin.options },
  { name: "visibility", pgValues: T.visibilityEnum.enumValues, zodValues: S.Visibility.options },
  { name: "course_exam_status", pgValues: T.courseExamStatusEnum.enumValues, zodValues: S.CourseExamStatus.options },
  { name: "kp_state", pgValues: T.kpStateEnum.enumValues, zodValues: S.KpState.options },
  { name: "lesson_packet_status", pgValues: T.lessonPacketStatusEnum.enumValues, zodValues: S.LessonPacketStatus.options },
  { name: "session_event_type", pgValues: T.sessionEventTypeEnum.enumValues, zodValues: S.SessionEventType.options },
  { name: "actor_type", pgValues: T.actorTypeEnum.enumValues, zodValues: S.ActorType.options },
  {
    name: "lesson_step_type",
    pgValues: T.lessonStepTypeEnum.enumValues,
    zodValues: (S.LessonStep.shape.type as unknown as { options: readonly string[] }).options,
  },
  {
    name: "import_run_status",
    pgValues: T.importRunStatusEnum.enumValues,
    zodValues: (S.ImportRun.shape.status as unknown as { options: readonly string[] }).options,
  },
  {
    name: "source_document_status",
    pgValues: T.sourceDocumentStatusEnum.enumValues,
    zodValues: (S.SourceDocument.shape.status as unknown as { options: readonly string[] }).options,
  },
  {
    name: "imported_entity_status",
    pgValues: T.importedEntityStatusEnum.enumValues,
    zodValues: (S.ImportedEntity.shape.status as unknown as { options: readonly string[] }).options,
  },
  {
    name: "import_error_severity",
    pgValues: T.importErrorSeverityEnum.enumValues,
    zodValues: (S.ImportError.shape.severity as unknown as { options: readonly string[] }).options,
  },
];

describe("Drizzle ⇄ Zod enum value-set parity", () => {
  it.each(ENUM_PAIRS)("$name pgEnum equals the Zod enum value set", ({ pgValues, zodValues }) => {
    expect([...pgValues].sort()).toEqual([...zodValues].sort());
  });
});

// Nullability parity (where feasible): a Zod field that is required AND non-null
// must map to a notNull column. Skip columns with a DB default (ids/timestamps/
// status are server-filled, so a required Zod value is legitimately defaulted).
describe("Drizzle ⇄ Zod nullability parity (required Zod field ⇒ notNull column)", () => {
  it.each(PAIRS)("$name required fields are notNull", ({ schema, table, relationalFields }) => {
    const columns = getTableColumns(table);
    const skip = new Set(relationalFields ?? []);
    const shape = (schema as unknown as { shape: Record<string, ZodType> }).shape;
    for (const [field, fieldSchema] of Object.entries(shape)) {
      if (skip.has(field)) continue;
      const col = columns[field] as unknown as { notNull: boolean; hasDefault: boolean } | undefined;
      if (!col) continue; // coverage is asserted by the field-parity test above
      const required =
        !fieldSchema.safeParse(undefined).success && !fieldSchema.safeParse(null).success;
      if (required && !col.hasDefault) {
        expect(col.notNull, `${field} required in Zod but column is nullable`).toBe(true);
      }
    }
  });
});
