import { integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import {
  actorTypeEnum,
  lessonPacketStatusEnum,
  lessonStepTypeEnum,
  sessionEventTypeEnum,
} from "./common";
import { baseEntityColumns, provenanceColumns } from "./columns";

// Lesson + session-event tables — mirror @prep-forge/schemas/lesson.ts.

export const lessonPackets = pgTable("lesson_packets", {
  ...baseEntityColumns(),
  version: integer("version").notNull(),
  status: lessonPacketStatusEnum("status").notNull(),
  subjectCode: text("subject_code"),
  courseCode: text("course_code"),
  title: text("title").notNull(),
  kpCodes: jsonb("kp_codes").notNull(),
  prerequisites: jsonb("prerequisites"),
  estimatedMinutes: integer("estimated_minutes"),
  difficulty: text("difficulty"),
  objectives: jsonb("objectives"),
  // LessonPacket.steps (Zod) is normalized into lesson_steps below; the parity
  // test treats it as a relational field rather than a column.
  ...provenanceColumns(),
});

export const lessonSteps = pgTable("lesson_steps", {
  id: text("id").primaryKey(),
  lessonPacketId: text("lesson_packet_id")
    .notNull()
    .references(() => lessonPackets.id),
  sequence: integer("sequence").notNull(),
  type: lessonStepTypeEnum("type").notNull(),
  prompt: text("prompt"),
  mdx: text("mdx"),
  math: jsonb("math"),
  questionIds: jsonb("question_ids"),
});

// Session-event ledger — strict ARCHITECTURE §4 envelope. Phase 0 records only
// local/demo events but the envelope is fixed now so Phase 1 replay can run on
// Phase 0 data. tenant_id reserved (demo placeholder, no derivation applied);
// correlation_id / causation_id / model_call_id reserved for Phase 1/2.
export const sessionEvents = pgTable(
  "session_events",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id"),
    sessionId: text("session_id").notNull(),
    enrollmentId: text("enrollment_id"),
    eventType: sessionEventTypeEnum("event_type").notNull(),
    eventVersion: integer("event_version").notNull(),
    sequence: integer("sequence").notNull(),
    actorType: actorTypeEnum("actor_type").notNull(),
    payload: jsonb("payload"),
    idempotencyKey: text("idempotency_key").notNull(),
    correlationId: text("correlation_id"),
    causationId: text("causation_id"),
    modelCallId: text("model_call_id"),
    lessonPacketId: text("lesson_packet_id"),
    stepId: text("step_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("session_events_session_sequence_uq").on(t.sessionId, t.sequence),
    uniqueIndex("session_events_session_idempotency_uq").on(t.sessionId, t.idempotencyKey),
  ],
);
