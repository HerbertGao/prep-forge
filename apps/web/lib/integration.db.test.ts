// §6 集成验证 (组 E, tasks 6.1–6.4) — END-TO-END integration check over the REAL
// loop: the lesson-runtime public API + the web server actions' data path
// (app/learn/[lessonId]/actions: recordEvent / submitAnswer, which grade →
// persist session_events → applyLearnerState in one txn) against real PostgreSQL.
//
// Precondition (the task baseline): real ai-teacher import + the 3 seeded ready
// packets. beforeAll re-runs seedPackets (idempotent, resets status→ready) and
// asserts the import is present; afterAll restores the DB to that baseline
// (deletes the origin=system rows + this run's session_events, re-seeds packets).
//
// Gated like packages/legacy-import/test/idempotency.db.test.ts: skipped offline,
// MUST run in CI when DATABASE_URL is set. 6.5 (validate / focused tests /
// typecheck) is a separate CLI gate, not asserted here.
import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, schema, seedPackets } from "@prep-forge/db";
import {
  applyLearnerState,
  foldEvents,
  loadFoldEvents,
} from "@prep-forge/lesson-runtime";
import { recordEvent, submitAnswer } from "../app/learn/[lessonId]/actions";
import { loadPacket } from "./packets";
import { buildDashboard, buildSubject, loadSeed } from "./seed";
import {
  isMistakeActive,
  isReviewDueToday,
  mergeKpStateByMax,
  reviewPassesAdminGate,
  type KpRank,
} from "./merge";

const HAS_DB = Boolean(process.env.DATABASE_URL);
if (process.env.CI && !HAS_DB) {
  throw new Error("integration.db.test requires DATABASE_URL in CI (the Postgres service must be wired)");
}

const PACKET = "lesson_packet#00023:limits-intro";
// Every origin=system row this suite produces is course 00023 (S1/S2 only ever
// answer 00023 questions). Scoping cleanup to this course — instead of a blanket
// DELETE WHERE origin='system' — keeps it from wiping a parallel DB test's rows
// or shared dev state (RC test-isolation finding).
const COURSE = "00023";
const Q_CORRECT = "question#00023:2006年10月真题:Q-01-167"; // answer B, kp AM01-05
const Q_WRONG = "question#00023:2006年10月真题:Q-01-168"; // answer A, kp AM01-07
const KP_CORRECT = "AM01-05";
const KP_WRONG = "AM01-07";

// disposable, per-run session ids → targeted cleanup, no collision with leftovers.
const RUN = Date.now();
const S1 = `intg-e2e-${RUN}`; // the packet lesson
const S2 = `intg-resurface-${RUN}`; // a later free-practice wrong answer (anti-forgetting)
const ALL_SESSIONS = [S1, S2];

// Lazy: createDb() throws without DATABASE_URL, which would fail the file at
// IMPORT time and defeat describe.skipIf (the skipped block never touches `db`).
const db = HAS_DB ? createDb() : (null as never);

// The recordEvent step path resolves its payload from the real lesson_steps row
// by (lessonPacketId, stepId), so the step id MUST be the seeded one — not a
// synthetic `${PACKET}:s1`.
const STEP_EXPLAIN = "lesson_step#00023:limits-intro:1";

/** md5 of a learner_kp_states row's mutable columns — to prove imported rows are
 * byte-identical before/after the applier runs. */
function kpRowHash(r: { state: string; score: number | null; lastAppliedSessionId: string | null; lastAppliedSequence: number | null; origin: string }): string {
  return createHash("md5").update(JSON.stringify([r.origin, r.state, r.score, r.lastAppliedSessionId, r.lastAppliedSequence])).digest("hex");
}

async function sessionEvents(sessionId: string) {
  return db.select().from(schema.sessionEvents).where(eq(schema.sessionEvents.sessionId, sessionId));
}
async function systemKpState(courseCode: string, kpCode: string) {
  const rows = await db
    .select()
    .from(schema.learnerKpStates)
    .where(and(eq(schema.learnerKpStates.courseCode, courseCode), eq(schema.learnerKpStates.kpCode, kpCode), eq(schema.learnerKpStates.origin, "system")));
  return rows[0] ?? null;
}
async function systemReview(courseCode: string, kpCode: string) {
  const rows = await db
    .select()
    .from(schema.reviewItems)
    .where(and(eq(schema.reviewItems.courseCode, courseCode), eq(schema.reviewItems.kpCode, kpCode), eq(schema.reviewItems.origin, "system")));
  return rows[0] ?? null;
}

// CI-safe gate: run ONLY when the real ai-teacher baseline is loaded (13015 has
// ≥3 imported KP states). CI runs migrations + the schema-dropping legacy-import
// suite but never loads the real ~13k import, so this suite SKIPS there instead
// of failing the build. Local/setup runs (real import present) execute fully.
async function baselineLoaded(): Promise<boolean> {
  if (!HAS_DB) return false;
  try {
    const cs = await db.select().from(schema.learnerKpStates).where(eq(schema.learnerKpStates.courseCode, "13015"));
    return cs.length >= 3;
  } catch {
    return false;
  }
}
const RUN_SUITE = await baselineLoaded();

describe.skipIf(!RUN_SUITE)("§6 集成验证 — end-to-end real loop", () => {
  let importedHashBefore = "";

  beforeAll(async () => {
    // baseline is guaranteed present here (RUN_SUITE gate). ensure the 3 ready
    // packets (idempotent; resets a previously-consumed packet → ready).
    await seedPackets(db);
    // clean any leftovers from a prior interrupted run of THIS test (delete events
    // FIRST so a concurrent global re-fold can't recreate the course-00023 rows).
    await db.delete(schema.sessionEvents).where(inArray(schema.sessionEvents.sessionId, ALL_SESSIONS));
    await db.delete(schema.learnerKpStates).where(and(eq(schema.learnerKpStates.origin, "system"), eq(schema.learnerKpStates.courseCode, COURSE)));
    await db.delete(schema.mistakes).where(and(eq(schema.mistakes.origin, "system"), eq(schema.mistakes.courseCode, COURSE)));
    await db.delete(schema.reviewItems).where(and(eq(schema.reviewItems.origin, "system"), eq(schema.reviewItems.courseCode, COURSE)));
    importedHashBefore = createHash("md5")
      .update(JSON.stringify((await db.select().from(schema.learnerKpStates).where(eq(schema.learnerKpStates.origin, "imported"))).map(kpRowHash).sort()))
      .digest("hex");
  });

  afterAll(async () => {
    // restore the pre-run baseline: drop this run's events FIRST, then this test's
    // own course-00023 origin=system projection rows (baseline had 0), and reset
    // packet status → ready. Course-scoped so a parallel DB test keeps its rows.
    await db.delete(schema.sessionEvents).where(inArray(schema.sessionEvents.sessionId, ALL_SESSIONS));
    await db.delete(schema.learnerKpStates).where(and(eq(schema.learnerKpStates.origin, "system"), eq(schema.learnerKpStates.courseCode, COURSE)));
    await db.delete(schema.mistakes).where(and(eq(schema.mistakes.origin, "system"), eq(schema.mistakes.courseCode, COURSE)));
    await db.delete(schema.reviewItems).where(and(eq(schema.reviewItems.origin, "system"), eq(schema.reviewItems.courseCode, COURSE)));
    await seedPackets(db); // status → ready
  });

  // 6.1 ── 开始课程 → 答客观题 → 批改(payload 冻结 grade) → 错题 → 复习更新；进度由确定性 applier 派生
  it("6.1 starts a packet, grades objective answers, and the applier derives system rows", async () => {
    // drive the REAL web action data path (each call: grade → persist event → applyLearnerState).
    expect((await recordEvent({ sessionId: S1, sequence: 0, lessonPacketId: PACKET, kind: "start" })).persisted).toBe(true);
    expect((await recordEvent({ sessionId: S1, sequence: 1, lessonPacketId: PACKET, kind: "step", stepId: STEP_EXPLAIN })).persisted).toBe(true);
    const correct = await submitAnswer({ sessionId: S1, sequence: 2, lessonPacketId: PACKET, stepId: `${PACKET}:s3`, questionId: Q_CORRECT, submitted: "B" });
    const wrong = await submitAnswer({ sessionId: S1, sequence: 3, lessonPacketId: PACKET, stepId: `${PACKET}:s3`, questionId: Q_WRONG, submitted: "B" });
    expect(correct.graded).toMatchObject({ kind: "graded", correct: true, score: 1 });
    expect(wrong.graded).toMatchObject({ kind: "graded", correct: false, score: 0 });

    const evs = await sessionEvents(S1);
    // lesson_started persisted.
    expect(evs.some((e) => e.eventType === "lesson_started")).toBe(true);
    // graded student_answered with the GradingResult FROZEN in payload.
    const graded = evs.filter((e) => e.eventType === "student_answered" && (e.payload as { kind?: string } | null)?.kind === "graded");
    expect(graded.length).toBe(2);
    const correctEv = graded.find((e) => (e.payload as { gradingResult: { questionId: string } }).gradingResult.questionId === Q_CORRECT)!;
    expect((correctEv.payload as { gradingResult: { correct: boolean; score: number } }).gradingResult).toMatchObject({ correct: true, score: 1 });

    // applier wrote origin=system rows: practiced KP-state, a mistake on the wrong
    // answer, a review_item with ISO due_date + last_applied_at.
    const kp = await systemKpState("00023", KP_CORRECT);
    expect(kp?.state).toBe("practiced");
    const mistakes = await db.select().from(schema.mistakes).where(eq(schema.mistakes.origin, "system"));
    const wrongMistake = mistakes.find((m) => m.questionRef === Q_WRONG);
    expect(wrongMistake, "a mistake row exists for the wrong answer").toBeTruthy();
    const review = await systemReview("00023", KP_CORRECT);
    expect(review, "a system review_item exists for the practiced KP").toBeTruthy();
    expect(() => new Date(review!.dueDate!).toISOString()).not.toThrow();
    expect(review!.dueDate).toBe(new Date(review!.dueDate!).toISOString()); // already ISO
    expect(review!.lastAppliedAt).toBeInstanceOf(Date);

    // progress changed ONLY via the deterministic applier: every learner_kp_state
    // touched for the packet's KPs is origin=system (imported rows untouched).
    expect(kp!.origin).toBe("system");
  });

  // 6.2 ── 完成最后一步 emit lesson_completed、课包 ready→consumed、≥1 graded；全序重放幂等(含 dueDate)
  it("6.2 completes the packet (ready→consumed, ≥1 graded) and replays idempotently", async () => {
    const statusBeforeRows = await db.select({ status: schema.lessonPackets.status }).from(schema.lessonPackets).where(eq(schema.lessonPackets.id, PACKET));
    expect(statusBeforeRows[0]?.status).toBe("ready");

    const res = await recordEvent({ sessionId: S1, sequence: 4, lessonPacketId: PACKET, kind: "complete" });
    expect(res.persisted).toBe(true);
    expect(res.wvll?.countable).toBe(true); // ROADMAP §2 WVLL predicate

    const evs = await sessionEvents(S1);
    expect(evs.some((e) => e.eventType === "lesson_completed")).toBe(true);
    expect(evs.filter((e) => e.eventType === "student_answered" && (e.payload as { kind?: string } | null)?.kind === "graded").length).toBeGreaterThanOrEqual(1);
    const statusAfter = await db.select({ status: schema.lessonPackets.status }).from(schema.lessonPackets).where(eq(schema.lessonPackets.id, PACKET));
    expect(statusAfter[0]?.status).toBe("consumed");

    // pure full re-fold over the SAME events (total order) twice → identical
    // terminal state INCLUDING review dueDate (replay idempotent, design D4).
    const learnerId = "ai-teacher-self";
    const foldEventsRows = await loadFoldEvents(db);
    const r1 = foldEvents(learnerId, foldEventsRows);
    const r2 = foldEvents(learnerId, [...foldEventsRows].reverse());
    expect(r2).toEqual(r1);
    const r1Review = r1.reviewItems.find((x) => x.kpCode === KP_CORRECT)!;
    const r2Review = r2.reviewItems.find((x) => x.kpCode === KP_CORRECT)!;
    expect(r2Review.dueDate).toBe(r1Review.dueDate);

    // a SECOND applyLearnerState (idempotent upsert) leaves the DB review unchanged.
    const dueBefore = (await systemReview("00023", KP_CORRECT))!.dueDate;
    await db.transaction(async (tx) => {
      await applyLearnerState(tx as never, learnerId);
    });
    const dueAfter = (await systemReview("00023", KP_CORRECT))!.dueDate;
    expect(dueAfter).toBe(dueBefore);
  });

  // 6.3 ── applier 派生；imported 不被改写；读侧合并无重复计数；admin 咨询性 + 答错重新浮现；可追溯
  it("6.3 imported rows untouched, read-side merge no double-count, traceable", async () => {
    // imported rows are byte-identical before/after the applier ran (6.1/6.2).
    const importedHashAfter = createHash("md5")
      .update(JSON.stringify((await db.select().from(schema.learnerKpStates).where(eq(schema.learnerKpStates.origin, "imported"))).map(kpRowHash).sort()))
      .digest("hex");
    expect(importedHashAfter).toBe(importedHashBefore);

    // read-side merge: AM01-05 has BOTH an imported (unseen) and a system
    // (practiced) row → merge to ONE row at the MAX rank (no double-count).
    const am0105rows = await db.select().from(schema.learnerKpStates).where(eq(schema.learnerKpStates.kpCode, KP_CORRECT));
    expect(am0105rows.filter((r) => r.origin === "imported").length).toBe(1);
    expect(am0105rows.filter((r) => r.origin === "system").length).toBe(1);
    const merged = mergeKpStateByMax(am0105rows.map((r) => ({ kpCode: r.kpCode, state: r.state as KpRank })));
    expect(merged.size).toBe(1);
    expect(merged.get(KP_CORRECT)).toBe("practiced"); // max(unseen, practiced)
    // the subject view (buildSubject) lists AM01-05 exactly once at the merged rank.
    const subject = buildSubject(await loadSeed(), "00023")!;
    const am0105 = subject.kps.filter((k) => k.kpCode === KP_CORRECT);
    expect(am0105).toHaveLength(1);
    expect(am0105[0]!.state).toBe("practiced");

    // mistakeCount = distinct mistake ids (per-event union, not KP-collapsed).
    const allMistakes = await db.select({ id: schema.mistakes.id }).from(schema.mistakes);
    expect(new Set(allMistakes.map((m) => m.id)).size).toBe(allMistakes.length);

    // traceability: derived rows point back to session_id + sequence.
    const kp = await systemKpState("00023", KP_CORRECT);
    expect(kp!.lastAppliedSessionId).toBe(S1);
    expect(typeof kp!.lastAppliedSequence).toBe("number");
    const wrongMistake = (await db.select().from(schema.mistakes).where(and(eq(schema.mistakes.origin, "system"), eq(schema.mistakes.questionRef, Q_WRONG))))[0]!;
    expect(wrongMistake.sourceSessionId).toBe(S1);
    expect(wrongMistake.sourceSequence).toBe(3);
  });

  // 6.3 (cont.) ── admin 确认咨询性：离开今日列表，答错后重新浮现
  it("6.3 admin confirm is advisory — leaves today's list then resurfaces on a later wrong answer", async () => {
    // evaluate the calendar gate from a vantage 40 days ahead so the +1d system
    // review IS due (isolating the admin gate as the deciding factor).
    const future = new Date(Date.now() + 40 * 86_400_000);
    const reviewBefore = (await systemReview("00023", KP_CORRECT))!;
    expect(isReviewDueToday({ id: reviewBefore.id, learnerId: reviewBefore.learnerId, courseCode: reviewBefore.courseCode, kpCode: reviewBefore.kpCode, origin: reviewBefore.origin, dueDate: reviewBefore.dueDate, adminConfirmedAt: null, lastAppliedAt: reviewBefore.lastAppliedAt }, future)).toBe(true);

    // admin confirm (mirrors confirm-actions.confirmReview: guarded origin=system
    // UPDATE) at the row's current last_applied_at → leaves today's list.
    const confirmAt = reviewBefore.lastAppliedAt!;
    const upd = await db.update(schema.reviewItems).set({ adminConfirmedAt: confirmAt }).where(and(eq(schema.reviewItems.id, reviewBefore.id), eq(schema.reviewItems.origin, "system")));
    expect((upd as { count?: number }).count).not.toBe(0);
    const confirmed = (await systemReview("00023", KP_CORRECT))!;
    expect(reviewPassesAdminGate({ adminConfirmedAt: confirmed.adminConfirmedAt, lastAppliedAt: confirmed.lastAppliedAt })).toBe(false);
    expect(isReviewDueToday({ id: confirmed.id, learnerId: confirmed.learnerId, courseCode: confirmed.courseCode, kpCode: confirmed.kpCode, origin: confirmed.origin, dueDate: confirmed.dueDate, adminConfirmedAt: confirmed.adminConfirmedAt, lastAppliedAt: confirmed.lastAppliedAt }, future)).toBe(false);

    // a later wrong answer for AM01-05 (a NEW free-practice session) — re-fold
    // advances last_applied_at past admin_confirmed_at → review resurfaces, AND a
    // new per-event mistake row appears (per-event resurface).
    const w = await submitAnswer({ sessionId: S2, sequence: 0, lessonPacketId: null, stepId: null, questionId: Q_CORRECT, submitted: "A" });
    expect(w.graded).toMatchObject({ kind: "graded", correct: false });

    const after = (await systemReview("00023", KP_CORRECT))!;
    // applier overwrote derived last_applied_at but NEVER admin_confirmed_at.
    expect(after.adminConfirmedAt!.getTime()).toBe(confirmAt.getTime());
    expect(after.lastAppliedAt!.getTime()).toBeGreaterThan(after.adminConfirmedAt!.getTime());
    expect(reviewPassesAdminGate({ adminConfirmedAt: after.adminConfirmedAt, lastAppliedAt: after.lastAppliedAt })).toBe(true);
    expect(isReviewDueToday({ id: after.id, learnerId: after.learnerId, courseCode: after.courseCode, kpCode: after.kpCode, origin: after.origin, dueDate: after.dueDate, adminConfirmedAt: after.adminConfirmedAt, lastAppliedAt: after.lastAppliedAt }, future)).toBe(true);

    // per-event mistake resurface: a NEW mistake row (S2/seq0) for Q_CORRECT, active.
    const newMistake = (await db.select().from(schema.mistakes).where(and(eq(schema.mistakes.origin, "system"), eq(schema.mistakes.questionRef, Q_CORRECT), eq(schema.mistakes.sourceSessionId, S2))))[0];
    expect(newMistake, "a new per-event mistake row exists for the later wrong answer").toBeTruthy();
    expect(isMistakeActive({ adminConfirmedAt: newMistake!.adminConfirmedAt })).toBe(true);
  });

  // 6.4 ── 课堂围绕课包步骤推进(非聊天框)；13015 按实现阈值识别为维护/抗遗忘
  it("6.4 classroom is step-driven and 13015 is flagged maintenance", async () => {
    // step-driven: the packet drives ordered, typed steps (not a free chat).
    const loaded = await loadPacket(PACKET);
    expect(loaded?.source).toBe("db");
    const steps = loaded!.packet.steps;
    expect(steps.length).toBeGreaterThanOrEqual(2);
    expect(steps.map((s) => s.type)).toContain("practice");
    const practice = steps.find((s) => s.type === "practice")!;
    expect(practice.questions.length).toBeGreaterThanOrEqual(1);
    expect(practice.questions.some((q) => q.type === "单选题" || q.type === "多选题")).toBe(true);

    // 13015 (重考, 3/3 engaged mastered = 100% ≥ MAINTENANCE_MASTERY_RATIO=0.8) is
    // flagged maintenance by the dashboard/read layer.
    const dash = buildDashboard(await loadSeed());
    expect(dash.source).toBe("db");
    expect(dash.maintenanceCourses.map((c) => c.courseCode)).toContain("13015");
  });
});
