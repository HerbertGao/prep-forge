// DB-gated G7 tests (design D11/D12) — the IO paths the pure prep-gates.test
// can't cover: draft→ready per-packet isolation and the learner status gate.
// Inserts crafted rows directly as the APP role (no worker, no real import
// needed), so it runs as soon as the G3 migration (validating enum + prep
// tables) is applied. SKIPS offline; a probe also skips if prep schema is
// absent, so it never red-fails a pre-migration CI lane.
import { afterAll, describe, expect, it, vi } from "vitest";
import { createDb, schema } from "@prep-forge/db";
import { eq, inArray } from "drizzle-orm";
import { confirmDraftReady, generateDraftForKp } from "./prep";
import { confirmId, loadPacket } from "./packets";
import { recordEvent, submitAnswer } from "../app/learn/[lessonId]/actions";

const HAS_DB = Boolean(process.env.DATABASE_URL);
if (process.env.CI && !HAS_DB) {
  throw new Error("prep.db.test requires DATABASE_URL in CI (Postgres service must be wired)");
}
const db = HAS_DB ? createDb() : (null as never);

const RUN = Date.now();
const A = `lesson_packet#prep:test-A-${RUN}`;
const B = `lesson_packet#prep:test-B-${RUN}`;
const V = `lesson_packet#prep:test-V-${RUN}`;
const V_STEP = `${V}:1`;
const RETRY_KP = `TST-RETRY-${RUN}`;
const HARD_CAP_KP = `TST-HARD-CAP-${RUN}`;
const ALL_PACKETS = [A, B, V];

async function canRun(): Promise<boolean> {
  if (!HAS_DB) return false;
  try {
    // Probe the validating enum + prep schema via a real insert (rolled back).
    await db.transaction(async (tx) => {
      await tx.insert(schema.lessonPackets).values(draftRow(`${A}-probe`, "validating"));
      throw new Error("rollback");
    });
    return false;
  } catch (e) {
    return String((e as Error).message).includes("rollback");
  }
}
const RUN_SUITE = await canRun();

function draftRow(id: string, status: "draft" | "validating") {
  return {
    id,
    origin: "ai_generated" as const,
    visibility: "public" as const,
    version: 1,
    status,
    title: `crafted ${id}`,
    kpCodes: ["TST-01"],
  };
}

describe.skipIf(!RUN_SUITE)("G7 BFF draft→ready + learner gate (DB)", () => {
  afterAll(async () => {
    await db.delete(schema.lessonSteps).where(inArray(schema.lessonSteps.lessonPacketId, ALL_PACKETS));
    await db.delete(schema.prepJobs).where(inArray(schema.prepJobs.kpCode, [RETRY_KP, HARD_CAP_KP]));
    await db.delete(schema.lessonPackets).where(inArray(schema.lessonPackets.id, ALL_PACKETS));
    await db
      .delete(schema.adminConfirmations)
      .where(eq(schema.adminConfirmations.id, confirmId("lesson_packet", A)));
  });

  it("draft→ready confirms ONE packet (A ready, B still draft) and writes the audit row", async () => {
    await db.insert(schema.lessonPackets).values(draftRow(A, "draft")).onConflictDoNothing();
    await db.insert(schema.lessonPackets).values(draftRow(B, "draft")).onConflictDoNothing();

    expect(await confirmDraftReady(A)).toEqual({ ok: true });

    const a = (await db.select().from(schema.lessonPackets).where(eq(schema.lessonPackets.id, A)))[0];
    const b = (await db.select().from(schema.lessonPackets).where(eq(schema.lessonPackets.id, B)))[0];
    expect(a?.status).toBe("ready"); // A advanced
    expect(b?.status).toBe("draft"); // B untouched — no batch publish (id= predicate)

    const conf = await db
      .select()
      .from(schema.adminConfirmations)
      .where(eq(schema.adminConfirmations.id, confirmId("lesson_packet", A)));
    expect(conf.length).toBe(1);
    expect(conf[0]?.entityType).toBe("lesson_packet");

    // re-confirming an already-ready packet hits 0 rows → rollback, ok:false.
    expect(await confirmDraftReady(A)).toEqual({ ok: false });
  });

  it("a validating packet is not learnable and rejects learner advance (D12)", async () => {
    await db.insert(schema.lessonPackets).values(draftRow(V, "validating")).onConflictDoNothing();
    await db
      .insert(schema.lessonSteps)
      .values({ id: V_STEP, lessonPacketId: V, sequence: 1, type: "practice", questionIds: ["q-x"] })
      .onConflictDoNothing();

    // single-packet loader denylist now includes validating.
    expect(await loadPacket(V)).toBeNull();

    // net-new status gate on the non-join action paths.
    const ans = await submitAnswer({
      sessionId: `prep-gate-${RUN}`,
      sequence: 0,
      lessonPacketId: V,
      stepId: V_STEP,
      questionId: "q-x",
      submitted: "A",
    });
    expect(ans.persisted).toBe(false);
    expect(ans.graded.kind).toBe("ungraded");

    const started = await recordEvent({ sessionId: `prep-gate-${RUN}`, sequence: 1, lessonPacketId: V, kind: "start" });
    expect(started.persisted).toBe(false);

    const missingPacket = `lesson_packet#prep:missing-${RUN}`;
    const missingAns = await submitAnswer({
      sessionId: `prep-gate-missing-${RUN}`,
      sequence: 0,
      lessonPacketId: missingPacket,
      stepId: null,
      questionId: "q-x",
      submitted: "A",
    });
    expect(missingAns.persisted).toBe(false);
    expect(missingAns.graded.kind).toBe("ungraded");

    const missingStarted = await recordEvent({
      sessionId: `prep-gate-missing-${RUN}`,
      sequence: 1,
      lessonPacketId: missingPacket,
      kind: "start",
    });
    expect(missingStarted.persisted).toBe(false);
  });

  it("worker transport failure keeps the active job retryable for orphan recovery", async () => {
    const oldUrl = process.env.AI_WORKER_URL;
    const oldSecret = process.env.AI_WORKER_SHARED_SECRET;
    process.env.AI_WORKER_URL = "http://127.0.0.1:9";
    process.env.AI_WORKER_SHARED_SECRET = "test-secret";
    vi.stubGlobal("fetch", async () => {
      throw new Error("simulated timeout");
    });
    try {
      const job = await generateDraftForKp(RETRY_KP);
      expect(job.status).toBe("running");
      expect(job.attemptCount).toBe(1);
      expect(job.failureReason).toMatch(/retryable/);
    } finally {
      vi.unstubAllGlobals();
      if (oldUrl === undefined) delete process.env.AI_WORKER_URL;
      else process.env.AI_WORKER_URL = oldUrl;
      if (oldSecret === undefined) delete process.env.AI_WORKER_SHARED_SECRET;
      else process.env.AI_WORKER_SHARED_SECRET = oldSecret;
    }
  });

  it("worker guardrail hard limits fail the job instead of retrying", async () => {
    const oldUrl = process.env.AI_WORKER_URL;
    const oldSecret = process.env.AI_WORKER_SHARED_SECRET;
    process.env.AI_WORKER_URL = "http://127.0.0.1:9";
    process.env.AI_WORKER_SHARED_SECRET = "test-secret";
    vi.stubGlobal("fetch", async () => {
      return {
        ok: false,
        status: 502,
        async json() {
          return { detail: "generation failed", kind: "token_cap" };
        },
      } as Response;
    });
    try {
      const job = await generateDraftForKp(HARD_CAP_KP);
      expect(job.status).toBe("failed");
      expect(job.attemptCount).toBe(1);
      expect(job.failureReason).toMatch(/token_cap/);
      expect(job.failureReason).not.toMatch(/retryable/);
    } finally {
      vi.unstubAllGlobals();
      if (oldUrl === undefined) delete process.env.AI_WORKER_URL;
      else process.env.AI_WORKER_URL = oldUrl;
      if (oldSecret === undefined) delete process.env.AI_WORKER_SHARED_SECRET;
      else process.env.AI_WORKER_SHARED_SECRET = oldSecret;
    }
  });
});
