// G8 8.4 — BFF content-prep CHAIN e2e on real PostgreSQL (DB-gated; SKIPS
// offline). Drives the whole gate→flip→draft→ready→classroom path through the
// PUBLIC BFF surface, with worker-shaped validating rows inserted directly (as
// the app role) to stand in for the worker's artifact — so NO live worker / HTTP
// hop is needed (the worker side is e2e-tested separately in
// services/ai-worker/tests/test_e2e_db.py). reconcileJob IS the orphan/running
// re-validate path (design D3/7.4): it rebuilds the LessonPacket from the
// persisted rows and runs the three gates, exactly like the normal path.
//
// Demo KP is the non-formula OS-13180 subject (design D7). Covered:
//   - success: running orphan → reconcile → draft, qgr all-pass;
//   - confirm A → ready leaves draft B STILL draft (per-packet, design D11);
//   - the now-ready packet runs in the Phase-1 classroom and grades an answer;
//   - quarantine via the math gate AND via an unconfirmed reference.
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, schema } from "@prep-forge/db";
import { confirmDraftReady, reconcileJob } from "./prep";
import { confirmId, loadPacket } from "./packets";
import { submitAnswer } from "../app/learn/[lessonId]/actions";

const HAS_DB = Boolean(process.env.DATABASE_URL);
if (process.env.CI && !HAS_DB) {
  throw new Error("prep-e2e.db.test requires DATABASE_URL in CI (Postgres service must be wired)");
}
const db = HAS_DB ? createDb() : (null as never);

const RUN = Date.now();
const COURSE = "13180"; // non-formula OS subject (demo KP, design D7)
const KP = `OS13180-e2e-${RUN}`;
const Q = `question#13180:e2e:${RUN}:confirmed`;
const Q_SOL = `${Q}:sol`;
const Q_LINK = `${Q}:link`;
const Q2 = `question#13180:e2e:${RUN}:unconfirmed`; // referenced but NOT confirmed
const Q2_SOL = `${Q2}:sol`;
const Q2_LINK = `${Q2}:link`;
const SESSION = `prep-e2e-${RUN}`;

const job = (tag: string) => `prep_job#e2e-${tag}-${RUN}`;
const pkt = (jobId: string) => `lesson_packet#prep:${jobId}`;
const JOBS = ["A", "B", "C", "D"].map(job);
const PKTS = JOBS.map(pkt);

// RUN_PREP_DB gates this OUT of the default `pnpm -r test`: that run includes the
// legacy-import suite, whose DROP SCHEMA … CASCADE would race this multi-step
// chain. It runs in its own isolated CI step (set the flag), where no concurrent
// schema drop can interleave. Probe the validating enum + prep schema via an
// insert that we roll back, like prep.db.test.ts.
const FLAG = process.env.RUN_PREP_DB === "1";

async function canRun(): Promise<boolean> {
  if (!FLAG || !HAS_DB) return false;
  try {
    await db.transaction(async (tx) => {
      await tx.insert(schema.lessonPackets).values({ id: `${pkt(job("probe"))}`, origin: "ai_generated", visibility: "public", version: 1, status: "validating", title: "probe", kpCodes: [KP] });
      throw new Error("rollback");
    });
    return false;
  } catch (e) {
    return String((e as Error).message).includes("rollback");
  }
}
const RUN_SUITE = await canRun();
if (process.env.CI && FLAG && HAS_DB && !RUN_SUITE) {
  throw new Error("prep-e2e.db.test: RUN_PREP_DB set in CI but prep schema not ready (run migrations)");
}

async function seedQuestion(id: string, sol: string, link: string, confirmed: boolean) {
  await db.insert(schema.questions).values({ id, origin: "imported", visibility: "public", courseCode: COURSE, src: "e2e", questionId: id, stem: "OS 的基本职能？", type: "单选题" }).onConflictDoNothing();
  await db.insert(schema.questionOptions).values([
    { id: `${id}:A`, origin: "imported", visibility: "public", questionId: id, label: "A", content: "应用软件", isCorrect: false },
    { id: `${id}:B`, origin: "imported", visibility: "public", questionId: id, label: "B", content: "管理硬件资源的系统软件", isCorrect: true },
  ]).onConflictDoNothing();
  await db.insert(schema.questionSolutions).values({ id: sol, origin: "imported", visibility: "public", questionId: id, answer: "B" }).onConflictDoNothing();
  await db.insert(schema.questionKpLinks).values({ id: link, origin: "imported", visibility: "public", questionId: id, courseCode: COURSE, kpCode: KP }).onConflictDoNothing();
  if (confirmed) {
    await db.insert(schema.adminConfirmations).values([
      { id: confirmId("question", id), entityType: "question", entityId: id },
      { id: confirmId("answer", sol), entityType: "answer", entityId: sol },
      { id: confirmId("kp_link", link), entityType: "kp_link", entityId: link },
    ]).onConflictDoNothing();
  }
}

async function insertValidating(tag: string, opts: { qid: string; math?: boolean }) {
  const jobId = job(tag);
  const pid = pkt(jobId);
  // distinct promptVersion per job so the active-job partial-unique index
  // (kp_code, prompt_version) doesn't collide across the 4 running fixtures.
  await db.insert(schema.prepJobs).values({ id: jobId, status: "running", kpCode: KP, promptVersion: `e2e-${tag}`, idempotencyKey: jobId }).onConflictDoNothing();
  await db.insert(schema.lessonPackets).values({ id: pid, origin: "ai_generated", visibility: "public", version: 1, status: "validating", courseCode: COURSE, title: `OS 草稿 ${tag}`, kpCodes: [KP], generationSources: [{ sourceType: "question", sourceId: opts.qid, modelCallIds: [], promptVersion: `e2e-${tag}` }] }).onConflictDoNothing();
  const steps: (typeof schema.lessonSteps.$inferInsert)[] = [
    { id: `${pid}:1`, lessonPacketId: pid, sequence: 1, type: "explanation", mdx: "操作系统管理硬件资源，向上层提供接口。" },
  ];
  if (opts.math) steps.push({ id: `${pid}:m`, lessonPacketId: pid, sequence: 2, type: "math_block", math: { latex: "x^2", displayMode: "inline" } });
  steps.push({ id: `${pid}:p`, lessonPacketId: pid, sequence: 3, type: "practice", questionIds: [opts.qid] });
  await db.insert(schema.lessonSteps).values(steps).onConflictDoNothing();
  return jobId;
}

async function packetStatus(id: string): Promise<string | undefined> {
  return (await db.select({ status: schema.lessonPackets.status }).from(schema.lessonPackets).where(eq(schema.lessonPackets.id, id)))[0]?.status;
}
async function jobStatus(id: string): Promise<string | undefined> {
  return (await db.select({ status: schema.prepJobs.status }).from(schema.prepJobs).where(eq(schema.prepJobs.id, id)))[0]?.status;
}
async function gateResult(jobId: string) {
  return (await db.select().from(schema.qualityGateResults).where(eq(schema.qualityGateResults.id, `qg#${jobId}`)))[0];
}

describe.skipIf(!RUN_SUITE)("G8 BFF content-prep chain (real DB)", () => {
  beforeAll(async () => {
    await seedQuestion(Q, Q_SOL, Q_LINK, true);
    await seedQuestion(Q2, Q2_SOL, Q2_LINK, false);
    await insertValidating("A", { qid: Q });
    await insertValidating("B", { qid: Q });
    await insertValidating("C", { qid: Q, math: true });
    await insertValidating("D", { qid: Q2 });
  });

  afterAll(async () => {
    await db.delete(schema.sessionEvents).where(eq(schema.sessionEvents.sessionId, SESSION));
    await db.delete(schema.learnerKpStates).where(and(eq(schema.learnerKpStates.origin, "system"), eq(schema.learnerKpStates.kpCode, KP)));
    await db.delete(schema.mistakes).where(and(eq(schema.mistakes.origin, "system"), inArray(schema.mistakes.questionRef, [Q, Q2])));
    await db.delete(schema.reviewItems).where(and(eq(schema.reviewItems.origin, "system"), eq(schema.reviewItems.kpCode, KP)));
    // FK order: qgr (→ prep_jobs + lesson_packets) → prep_jobs (→ lesson_packets
    // via lesson_packet_id, set by runGateTx) → steps (→ lesson_packets) → packets.
    await db.delete(schema.qualityGateResults).where(inArray(schema.qualityGateResults.prepJobId, JOBS));
    await db.delete(schema.prepJobs).where(inArray(schema.prepJobs.id, JOBS));
    await db.delete(schema.lessonSteps).where(inArray(schema.lessonSteps.lessonPacketId, PKTS));
    await db.delete(schema.lessonPackets).where(inArray(schema.lessonPackets.id, PKTS));
    for (const [id, sol, link] of [[Q, Q_SOL, Q_LINK], [Q2, Q2_SOL, Q2_LINK]] as const) {
      await db.delete(schema.adminConfirmations).where(inArray(schema.adminConfirmations.id, [confirmId("question", id), confirmId("answer", sol), confirmId("kp_link", link)]));
      await db.delete(schema.questionKpLinks).where(eq(schema.questionKpLinks.id, link));
      await db.delete(schema.questionSolutions).where(eq(schema.questionSolutions.id, sol));
      await db.delete(schema.questionOptions).where(eq(schema.questionOptions.questionId, id));
      await db.delete(schema.questions).where(eq(schema.questions.id, id));
    }
  });

  it("running orphan → reconcile rebuilds + gates → draft, all three gates pass", async () => {
    await reconcileJob(job("A"));
    expect(await packetStatus(pkt(job("A")))).toBe("draft");
    expect(await jobStatus(job("A"))).toBe("done");
    const qg = await gateResult(job("A"));
    expect(qg).toMatchObject({ schemaPassed: true, mathRenderPassed: true, questionRefsPassed: true, passed: true });
  });

  it("confirm A → ready leaves a second draft B STILL draft (per-packet, D11)", async () => {
    await reconcileJob(job("B"));
    expect(await packetStatus(pkt(job("B")))).toBe("draft");

    expect(await confirmDraftReady(pkt(job("A")))).toEqual({ ok: true });
    expect(await packetStatus(pkt(job("A")))).toBe("ready"); // A advanced
    expect(await packetStatus(pkt(job("B")))).toBe("draft"); // B untouched — no batch publish
  });

  it("the now-ready AI packet runs in the Phase-1 classroom and grades an answer", async () => {
    const loaded = await loadPacket(pkt(job("A")));
    expect(loaded?.source).toBe("db");
    expect(loaded?.packet.steps.some((s) => s.type === "practice")).toBe(true);

    const res = await submitAnswer({ sessionId: SESSION, sequence: 0, lessonPacketId: pkt(job("A")), stepId: `${pkt(job("A"))}:p`, questionId: Q, submitted: "B" });
    expect(res.persisted).toBe(true);
    expect(res.graded).toMatchObject({ kind: "graded", correct: true, score: 1 });
  });

  it("a step carrying a math block is quarantined by the math gate", async () => {
    await reconcileJob(job("C"));
    expect(await packetStatus(pkt(job("C")))).toBe("quarantine");
    expect(await jobStatus(job("C"))).toBe("done");
    const qg = await gateResult(job("C"));
    expect(qg).toMatchObject({ schemaPassed: true, mathRenderPassed: false, passed: false });
  });

  it("an unconfirmed referenced question is quarantined by the reference gate", async () => {
    await reconcileJob(job("D"));
    expect(await packetStatus(pkt(job("D")))).toBe("quarantine");
    const qg = await gateResult(job("D"));
    expect(qg).toMatchObject({ questionRefsPassed: false, passed: false });
    expect((qg?.issues as string[]).join(" ")).toMatch(/not confirmed/);
  });
});
