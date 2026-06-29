"use server";

// Records a local/demo session event (tasks 5.8 / 5.9). Writes ONLY into the
// session_events ledger when a DB is reachable; otherwise the client keeps the
// event locally. It NEVER updates learner_kp_states / mistakes / review_items —
// Phase 0 has no event applier (决策 7). The envelope is validated against the
// shared SessionEvent schema before persistence.
import { createDb, schema } from "@prep-forge/db";
import { SessionEvent } from "@prep-forge/schemas";

export async function recordSessionEvent(
  sessionId: string,
  raw: unknown,
): Promise<{ persisted: boolean }> {
  // sessionId is part of the validated envelope now; merge the arg in so the
  // schema stays authoritative even if the caller omitted it from `raw`.
  const ev = SessionEvent.parse({ ...(raw as Record<string, unknown>), sessionId });
  try {
    const db = createDb();
    await db
      .insert(schema.sessionEvents)
      .values({
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
      })
      .onConflictDoNothing();
    return { persisted: true };
  } catch (err) {
    // No DB / unreachable -> local-only record (the client already kept it).
    // Log so a genuine write bug is diagnosable rather than reading as benign offline mode.
    console.error("[session-event] persist failed, recorded locally only:", err);
    return { persisted: false };
  }
}
