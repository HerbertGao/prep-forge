import { pgEnum } from "drizzle-orm/pg-core";

// Shared pgEnums — mirror @prep-forge/schemas/common.ts (Zod is the SoT).
// Column property names in tables are camelCase and MUST equal the Zod field
// names so the parity test (schema.parity.test.ts) can compare key sets.

export const originEnum = pgEnum("origin", ["imported", "system", "ai_generated"]);
export const visibilityEnum = pgEnum("visibility", ["public", "personal"]);
export const courseExamStatusEnum = pgEnum("course_exam_status", [
  "未开始",
  "缺考",
  "重考",
  "在考",
  "已通过",
  "unmapped",
]);
export const kpStateEnum = pgEnum("kp_state", ["unseen", "taught", "practiced", "mastered"]);
export const lessonPacketStatusEnum = pgEnum("lesson_packet_status", [
  "validating",
  "draft",
  "ready",
  "consumed",
  "quarantine",
]);
// Phase 2 prep job lifecycle (D3) — INDEPENDENT enum (not reused from
// lesson_packet_status); does not include 'ready' (worker never auto-readies).
export const prepJobStatusEnum = pgEnum("prep_job_status", [
  "pending",
  "running",
  "validating",
  "done",
  "failed",
]);
export const sessionEventTypeEnum = pgEnum("session_event_type", [
  "lesson_started",
  "step_shown",
  "student_answered",
  "lesson_completed",
]);
export const actorTypeEnum = pgEnum("actor_type", ["student", "system", "tutor"]);
export const lessonStepTypeEnum = pgEnum("lesson_step_type", [
  "diagnostic_question",
  "socratic_question",
  "explanation",
  "math_block",
  "worked_example",
  "practice",
  "hint",
  "summary",
  "review_prompt",
]);

// Provenance status enums (mirror @prep-forge/schemas/import.ts).
export const importRunStatusEnum = pgEnum("import_run_status", ["running", "completed", "failed"]);
export const sourceDocumentStatusEnum = pgEnum("source_document_status", [
  "parsed",
  "unsupported",
  "skipped",
  "error",
]);
export const importedEntityStatusEnum = pgEnum("imported_entity_status", [
  "staged",
  "published",
  "quarantine",
  "error",
]);
export const importErrorSeverityEnum = pgEnum("import_error_severity", [
  "error",
  "warning",
  "quarantine",
]);
