// Event applier (task 2.4 / 2.5 / 2.6, design D4/D5/D7). Thin DB writer around
// the pure fold: read session events → resolve courseCode (payload only, NO
// question-bank read) → fold → upsert origin=system projection rows via derived
// id + ON CONFLICT(id). The web layer (group D) runs this in the same
// transaction as the event persist.
//
// SET lists are per-table and contain ONLY derived fields — NEVER
// admin_confirmed_at (admin columns are owned by D11, disjoint from derived).
// origin=imported rows are never written or updated.
import { sql } from "drizzle-orm";
import { schema } from "@prep-forge/db";
import type { Database } from "@prep-forge/db";
import type { SessionEventPayload } from "@prep-forge/schemas";
import { foldEvents } from "./fold";
import type { FoldEvent, FoldResult } from "./fold";
import { courseFromQuestionId, systemKpStateId, systemMistakeId, systemReviewItemId } from "./ids";

/** Single demo learner (design D8); fallback if learner_profiles is empty. */
export const DEMO_LEARNER_FALLBACK = "ai-teacher-self";

export async function getDemoLearnerId(db: Database): Promise<string> {
  const rows = await db
    .select({ learnerId: schema.learnerProfiles.learnerId })
    .from(schema.learnerProfiles)
    .limit(1);
  return rows[0]?.learnerId ?? DEMO_LEARNER_FALLBACK;
}

/**
 * Read all session events and reduce each to a FoldEvent, resolving courseCode:
 *  - step_shown: from the lesson packet (lesson table, not the question bank).
 *  - student_answered (graded): parsed from the questionId in the payload.
 * Lifecycle / unplaceable events are dropped (they touch no KP).
 */
export async function loadFoldEvents(db: Database): Promise<FoldEvent[]> {
  const rows = await db.select().from(schema.sessionEvents);
  const packets = await db
    .select({ id: schema.lessonPackets.id, courseCode: schema.lessonPackets.courseCode })
    .from(schema.lessonPackets);
  const packetCourse = new Map(packets.map((p) => [p.id, p.courseCode]));

  const out: FoldEvent[] = [];
  for (const r of rows) {
    const payload = (r.payload ?? null) as SessionEventPayload | null;
    if (!payload) continue;
    let courseCode: string | null = null;
    if (r.eventType === "step_shown") {
      courseCode = r.lessonPacketId ? (packetCourse.get(r.lessonPacketId) ?? null) : null;
    } else if (r.eventType === "student_answered" && "kind" in payload && payload.kind === "graded") {
      courseCode = courseFromQuestionId(payload.gradingResult.questionId);
    }
    if (!courseCode) continue;
    out.push({
      sessionId: r.sessionId,
      sequence: r.sequence,
      createdAt: r.createdAt,
      eventType: r.eventType,
      courseCode,
      payload,
    });
  }
  return out;
}

export interface ProjectionWriteCounts {
  kpStates: number;
  mistakes: number;
  reviewItems: number;
  total: number;
}

export type ApplyLearnerStateResult = FoldResult & {
  projectionWrites: ProjectionWriteCounts;
  deterministicUpdate: boolean;
};

function projectionCounts(result: FoldResult, sessionId?: string): ProjectionWriteCounts {
  const kpStates = sessionId
    ? result.kpStates.filter((m) => m.lastAppliedSessionId === sessionId).length
    : result.kpStates.length;
  const reviewItems = sessionId
    ? result.reviewItems.filter((m) => m.lastAppliedSessionId === sessionId).length
    : result.reviewItems.length;
  const mistakes = sessionId
    ? result.mistakes.filter((m) => m.sourceSessionId === sessionId).length
    : result.mistakes.length;
  return { kpStates, mistakes, reviewItems, total: kpStates + mistakes + reviewItems };
}

/** Upsert the folded mutations as origin=system rows (derived id + ON CONFLICT(id)). */
export async function writeMutations(db: Database, result: FoldResult): Promise<void> {
  for (const m of result.kpStates) {
    await db
      .insert(schema.learnerKpStates)
      .values({
        id: systemKpStateId(m.learnerId, m.courseCode, m.kpCode),
        origin: "system",
        visibility: "personal",
        learnerId: m.learnerId,
        courseCode: m.courseCode,
        kpCode: m.kpCode,
        state: m.state,
        score: m.score,
        lastAppliedSessionId: m.lastAppliedSessionId,
        lastAppliedSequence: m.lastAppliedSequence,
        sourceBlockId: null,
        contentHash: null,
      })
      .onConflictDoUpdate({
        target: schema.learnerKpStates.id,
        set: {
          state: m.state,
          score: m.score,
          lastAppliedSessionId: m.lastAppliedSessionId,
          lastAppliedSequence: m.lastAppliedSequence,
        },
      });
  }

  for (const m of result.reviewItems) {
    await db
      .insert(schema.reviewItems)
      .values({
        id: systemReviewItemId(m.learnerId, m.courseCode, m.kpCode),
        origin: "system",
        visibility: "personal",
        learnerId: m.learnerId,
        courseCode: m.courseCode,
        kpCode: m.kpCode,
        dueDate: m.dueDate,
        status: "scheduled",
        lastAppliedSessionId: m.lastAppliedSessionId,
        lastAppliedSequence: m.lastAppliedSequence,
        lastAppliedAt: m.lastAppliedAt,
        sourceBlockId: null,
        contentHash: null,
      })
      .onConflictDoUpdate({
        target: schema.reviewItems.id,
        set: {
          dueDate: m.dueDate,
          lastAppliedSessionId: m.lastAppliedSessionId,
          lastAppliedSequence: m.lastAppliedSequence,
          lastAppliedAt: m.lastAppliedAt,
        },
      });
  }

  for (const m of result.mistakes) {
    await db
      .insert(schema.mistakes)
      .values({
        id: systemMistakeId(m.sourceSessionId, m.sourceSequence, m.questionRef),
        origin: "system",
        visibility: "personal",
        learnerId: m.learnerId,
        courseCode: m.courseCode,
        kpCode: m.kpCode,
        questionRef: m.questionRef,
        category: m.category,
        note: null,
        sourceSessionId: m.sourceSessionId,
        sourceSequence: m.sourceSequence,
        sourceBlockId: null,
        contentHash: null,
      })
      .onConflictDoUpdate({
        target: schema.mistakes.id,
        set: {
          // derived fields only — NEVER adminConfirmedAt.
          courseCode: m.courseCode,
          kpCode: m.kpCode,
          category: m.category,
        },
      });
  }

}

/**
 * Full apply: load events → pure fold → write projection rows. Pass a
 * transaction handle as `db` to run inside the event-persist transaction.
 */
export async function applyLearnerState(
  db: Database,
  learnerId?: string,
  sessionId?: string,
): Promise<ApplyLearnerStateResult> {
  const lid = learnerId ?? (await getDemoLearnerId(db));
  await db.execute(sql`select pg_advisory_xact_lock(hashtext(${lid}))`);
  const events = await loadFoldEvents(db);
  const result = foldEvents(lid, events);
  await writeMutations(db, result);
  const projectionWrites = projectionCounts(result, sessionId);
  // ponytail: interleaved same-KP sessions can make this session-scoped count false-negative; Phase 2 concern.
  const deterministicUpdate = projectionWrites.total > 0;
  return {
    ...result,
    projectionWrites,
    deterministicUpdate,
  };
}
