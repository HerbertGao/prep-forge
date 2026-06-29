"use server";

// Out-of-packet practice (task 4.5, lesson-packet-seed spec): an independent
// practice answer must still OPEN a session and flow through session_events →
// applier — the same deterministic path as the classroom, never a side-write to
// learner_kp_states / mistakes / review_items. Each answer is its own one-shot
// session (lesson_started + student_answered), then the applier re-folds.
import { type Database, createDb, schema } from "@prep-forge/db";
import { applyLearnerState, getDemoLearnerId, gradeQuestion } from "@prep-forge/lesson-runtime";
import { SessionEvent, type SessionEvent as SessionEventT } from "@prep-forge/schemas";

function eventValues(ev: SessionEventT) {
  return {
    id: ev.id,
    tenantId: ev.tenantId ?? "demo",
    sessionId: ev.sessionId,
    enrollmentId: null,
    eventType: ev.eventType,
    eventVersion: ev.eventVersion,
    sequence: ev.sequence,
    actorType: ev.actorType,
    payload: ev.payload ?? null,
    idempotencyKey: ev.idempotencyKey,
    lessonPacketId: null,
    stepId: ev.stepId ?? null,
    occurredAt: new Date(ev.occurredAt),
  };
}

export async function practiceAnswer(
  questionId: string,
  submitted: string | string[],
): Promise<{
  persisted: boolean;
  graded: { kind: "graded"; correct: boolean; score: number } | { kind: "ungraded"; reason: string };
}> {
  const sessionId = `practice:${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  try {
    const db = createDb();
    const learnerId = await getDemoLearnerId(db);
    const payload = await gradeQuestion(db, questionId, submitted);
    const started = SessionEvent.parse({
      id: `${sessionId}:evt:0`,
      sessionId,
      enrollmentId: null,
      eventType: "lesson_started",
      eventVersion: 1,
      sequence: 0,
      actorType: "student",
      idempotencyKey: `${sessionId}:started`,
      occurredAt: now,
      tenantId: "demo",
      lessonPacketId: null,
      stepId: null,
      payload: null,
    });
    const answered = SessionEvent.parse({
      id: `${sessionId}:evt:1`,
      sessionId,
      enrollmentId: null,
      eventType: "student_answered",
      eventVersion: 1,
      sequence: 1,
      actorType: "student",
      idempotencyKey: `${sessionId}:answer:${questionId}`,
      occurredAt: now,
      tenantId: "demo",
      lessonPacketId: null,
      stepId: null,
      payload,
    });
    await db.transaction(async (tx) => {
      await tx
        .insert(schema.sessionEvents)
        .values([eventValues(started), eventValues(answered)])
        .onConflictDoNothing();
      await applyLearnerState(tx as unknown as Database, learnerId);
    });
    const graded =
      "kind" in payload && payload.kind === "graded"
        ? {
            kind: "graded" as const,
            correct: payload.gradingResult.correct === true,
            score: payload.gradingResult.score,
          }
        : { kind: "ungraded" as const, reason: "reason" in payload ? payload.reason : "ungraded" };
    return { persisted: true, graded };
  } catch (e) {
    console.error("[practice] answer failed:", e);
    return { persisted: false, graded: { kind: "ungraded", reason: "no DB" } };
  }
}
