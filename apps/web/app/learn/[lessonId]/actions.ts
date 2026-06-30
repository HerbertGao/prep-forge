"use server";

// Classroom server actions (tasks 4.1 / 4.2, design D1/D9/D10). Each action
// validates a SessionEvent envelope, persists it into session_events, then —
// IN THE SAME TRANSACTION — drives the lesson-runtime applier so learner_kp_
// states / mistakes / review_items are deterministically updated. Grading,
// folding and the upsert all come from @prep-forge/lesson-runtime (we never
// reimplement the loop). No DB ⇒ persisted:false, the client keeps events
// locally (offline demo), matching Phase 0.
import { and, eq, inArray } from "drizzle-orm";
import { type Database, createDb, schema } from "@prep-forge/db";
import {
  applyLearnerState,
  getDemoLearnerId,
  gradeQuestion,
} from "@prep-forge/lesson-runtime";
import { SessionEvent, type SessionEventPayload } from "@prep-forge/schemas";
import { wvllCountable, type WvllResult } from "../../../lib/merge";

type EnvelopeInput = {
  sessionId: string;
  sequence: number;
  eventType: SessionEvent["eventType"];
  actorType: SessionEvent["actorType"];
  idempotencyKey: string;
  lessonPacketId: string | null;
  stepId?: string | null;
  payload?: SessionEventPayload | null;
};

type StepShownPayload = Extract<SessionEventPayload, { stepType: string }>;

type PersistApplyResult = {
  persisted: boolean;
  deterministicUpdate: boolean;
  readyPacketConsumed: boolean;
};

function buildEnvelope(i: EnvelopeInput): SessionEvent {
  return SessionEvent.parse({
    id: `${i.sessionId}:evt:${i.sequence}`,
    sessionId: i.sessionId,
    enrollmentId: null,
    eventType: i.eventType,
    eventVersion: 1,
    sequence: i.sequence,
    actorType: i.actorType,
    idempotencyKey: i.idempotencyKey,
    occurredAt: new Date().toISOString(),
    tenantId: "demo",
    lessonPacketId: i.lessonPacketId,
    stepId: i.stepId ?? null,
    payload: i.payload ?? null,
  });
}

function eventValues(ev: SessionEvent) {
  return {
    id: ev.id,
    tenantId: ev.tenantId ?? "demo",
    sessionId: ev.sessionId,
    enrollmentId: ev.enrollmentId ?? null,
    eventType: ev.eventType,
    eventVersion: ev.eventVersion,
    sequence: ev.sequence,
    actorType: ev.actorType,
    payload: ev.payload ?? null,
    idempotencyKey: ev.idempotencyKey,
    lessonPacketId: ev.lessonPacketId ?? null,
    stepId: ev.stepId ?? null,
    occurredAt: new Date(ev.occurredAt),
  };
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function uniqueStrings(values: Iterable<string>): string[] {
  return [...new Set(values)];
}

async function sessionHasGradedAnswer(
  db: Database,
  sessionId: string,
  lessonPacketId: string,
): Promise<boolean> {
  const stepRows = await db
    .select({ questionIds: schema.lessonSteps.questionIds })
    .from(schema.lessonSteps)
    .where(eq(schema.lessonSteps.lessonPacketId, lessonPacketId));
  const packetQuestionIds = new Set(stepRows.flatMap((r) => stringArray(r.questionIds)));
  if (packetQuestionIds.size === 0) return false;

  const rows = await db
    .select({ payload: schema.sessionEvents.payload })
    .from(schema.sessionEvents)
    .where(
      and(
        eq(schema.sessionEvents.sessionId, sessionId),
        eq(schema.sessionEvents.lessonPacketId, lessonPacketId),
        eq(schema.sessionEvents.eventType, "student_answered"),
      ),
    );
  return rows.some((r) => {
    if (!r.payload || (r.payload as { kind?: string }).kind !== "graded") return false;
    const questionId = (r.payload as { gradingResult?: { questionId?: unknown } }).gradingResult?.questionId;
    return typeof questionId === "string" && packetQuestionIds.has(questionId);
  });
}

async function resolveStepPayload(
  lessonPacketId: string | null,
  stepId: string | null | undefined,
): Promise<StepShownPayload | null> {
  if (!lessonPacketId || !stepId) return null;
  const db = createDb();
  const row = (
    await db
      .select({
        stepType: schema.lessonSteps.type,
        questionIds: schema.lessonSteps.questionIds,
        packetKpCodes: schema.lessonPackets.kpCodes,
      })
      .from(schema.lessonSteps)
      .innerJoin(schema.lessonPackets, eq(schema.lessonSteps.lessonPacketId, schema.lessonPackets.id))
      .where(
        and(
          eq(schema.lessonSteps.lessonPacketId, lessonPacketId),
          eq(schema.lessonSteps.id, stepId),
        ),
      )
      .limit(1)
  )[0];
  if (!row) return null;

  const questionIds = stringArray(row.questionIds);
  let kpCodes: string[] = [];
  if (questionIds.length > 0) {
    const links = await db
      .select({ kpCode: schema.questionKpLinks.kpCode })
      .from(schema.questionKpLinks)
      .where(inArray(schema.questionKpLinks.questionId, questionIds));
    kpCodes = uniqueStrings(links.map((l) => l.kpCode));
  }
  if (kpCodes.length === 0) {
    kpCodes = stringArray(row.packetKpCodes);
  }

  return { stepType: row.stepType, kpCodes };
}

/**
 * Persist one event and (same txn) re-fold the applier. `completePacketId` also
 * transitions that packet ready→consumed (the WVLL completion marker, D10).
 */
async function persistAndApply(
  ev: SessionEvent,
  opts: { completePacketId?: string } = {},
): Promise<PersistApplyResult> {
  try {
    const db = createDb();
    const learnerId = await getDemoLearnerId(db);
    let deterministicUpdate = false;
    let readyPacketConsumed = false;
    let persisted = false;
    await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(schema.sessionEvents)
        .values(eventValues(ev))
        .onConflictDoNothing()
        .returning({ id: schema.sessionEvents.id });
      persisted = inserted.length > 0;
      if (opts.completePacketId) {
        const hasGraded = await sessionHasGradedAnswer(
          tx as unknown as Database,
          ev.sessionId,
          opts.completePacketId,
        );
        if (hasGraded) {
          const consumed = await tx
            .update(schema.lessonPackets)
            .set({ status: "consumed" })
            .where(
              and(
                eq(schema.lessonPackets.id, opts.completePacketId),
                eq(schema.lessonPackets.status, "ready"),
              ),
            )
            .returning({ id: schema.lessonPackets.id });
          readyPacketConsumed = consumed.length > 0;
        }
      }
      // tx satisfies the same select/insert/update surface as Database.
      const applied = await applyLearnerState(tx as unknown as Database, learnerId, ev.sessionId);
      deterministicUpdate = applied.deterministicUpdate;
    });
    return { persisted, deterministicUpdate, readyPacketConsumed };
  } catch (err) {
    console.error("[classroom] persist+apply failed, recorded locally only:", err);
    return { persisted: false, deterministicUpdate: false, readyPacketConsumed: false };
  }
}

/** lesson_started / step_shown / lesson_completed (no server-side grading). */
export async function recordEvent(input: {
  sessionId: string;
  sequence: number;
  lessonPacketId: string | null;
  kind: "start" | "step" | "complete";
  stepId?: string | null;
}): Promise<{ persisted: boolean; wvll?: WvllResult }> {
  const { sessionId, sequence, lessonPacketId, kind } = input;
  if (kind === "start") {
    const ev = buildEnvelope({
      sessionId,
      sequence,
      eventType: "lesson_started",
      actorType: "student",
      idempotencyKey: `${sessionId}:started`,
      lessonPacketId,
    });
    const persisted = await persistAndApply(ev);
    return { persisted: persisted.persisted };
  }
  if (kind === "step") {
    try {
      const payload = await resolveStepPayload(lessonPacketId, input.stepId);
      if (!payload) return { persisted: false };
      const ev = buildEnvelope({
        sessionId,
        sequence,
        eventType: "step_shown",
        actorType: "system",
        idempotencyKey: `${sessionId}:step:${input.stepId}`,
        lessonPacketId,
        stepId: input.stepId,
        payload,
      });
      const persisted = await persistAndApply(ev);
      return { persisted: persisted.persisted };
    } catch (err) {
      console.error("[classroom] step event failed, recorded locally only:", err);
      return { persisted: false };
    }
  }
  // complete
  const ev = buildEnvelope({
    sessionId,
    sequence,
    eventType: "lesson_completed",
    actorType: "system",
    idempotencyKey: `${sessionId}:completed`,
    lessonPacketId,
  });
  const persisted = await persistAndApply(
    ev,
    lessonPacketId ? { completePacketId: lessonPacketId } : {},
  );
  const wvll = await computeWvll(
    sessionId,
    persisted.readyPacketConsumed,
    persisted.deterministicUpdate,
  );
  return { persisted: persisted.persisted, wvll };
}

/** student_answered — grade objectively (DB), then persist + apply (same txn). */
export async function submitAnswer(input: {
  sessionId: string;
  sequence: number;
  lessonPacketId: string | null;
  stepId: string | null;
  questionId: string;
  submitted: string | string[];
}): Promise<{
  persisted: boolean;
  graded: { kind: "graded"; correct: boolean; score: number } | { kind: "ungraded"; reason: string };
}> {
  const { sessionId, sequence, lessonPacketId, stepId, questionId, submitted } = input;
  let payload: SessionEventPayload;
  try {
    const db = createDb();
    payload = await gradeQuestion(db, questionId, submitted);
  } catch (err) {
    console.error("[classroom] grade failed (no DB?), recording ungraded:", err);
    payload = { kind: "ungraded", reason: "grading unavailable (no DB)", resolvedKpCodes: [] };
  }
  const ev = buildEnvelope({
    sessionId,
    sequence,
    eventType: "student_answered",
    actorType: "student",
    idempotencyKey: `${sessionId}:answer:${stepId ?? "_"}:${questionId}`,
    lessonPacketId,
    stepId,
    payload,
  });
  const persisted = await persistAndApply(ev);
  const graded =
    "kind" in payload && payload.kind === "graded"
      ? {
          kind: "graded" as const,
          correct: payload.gradingResult.correct === true,
          score: payload.gradingResult.score,
        }
      : { kind: "ungraded" as const, reason: "reason" in payload ? payload.reason : "ungraded" };
  return { persisted: persisted.persisted, graded };
}

/** Evaluate the ROADMAP §2 WVLL predicate over this session's persisted events. */
async function computeWvll(
  sessionId: string,
  readyPacketConsumed: boolean,
  deterministicUpdate: boolean,
): Promise<WvllResult> {
  try {
    const db = createDb();
    const rows = await db
      .select({ eventType: schema.sessionEvents.eventType, payload: schema.sessionEvents.payload })
      .from(schema.sessionEvents)
      .where(eq(schema.sessionEvents.sessionId, sessionId));
    const graded = rows.filter(
      (r) =>
        r.eventType === "student_answered" &&
        !!r.payload &&
        (r.payload as { kind?: string }).kind === "graded",
    ).length;
    return wvllCountable({
      readyPacketConsumed,
      sessionEventCount: rows.length,
      gradedAnswerCount: graded,
      deterministicUpdate,
    });
  } catch {
    return wvllCountable({
      readyPacketConsumed: false,
      sessionEventCount: 0,
      gradedAnswerCount: 0,
      deterministicUpdate: false,
    });
  }
}
