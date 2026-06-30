// §6 自给种子的端到端集成验证 — proves grade→persist→fold→upsert over the REAL
// loop (the web server actions' data path + lesson-runtime) WITHOUT depending on
// the ~13k ai-teacher import. integration.db.test.ts gates on that baseline and
// therefore SKIPS in CI (which never loads it), proving nothing there; this suite
// seeds its OWN minimal fixture and runs whenever DATABASE_URL is set, so the
// core loop is exercised in CI too.
//
// Isolation: a UNIQUE fixture course (E2E01) + a tiny high-completion course
// (E2E99) that collide with nothing real and with no parallel suite. The fixture
// adds NO origin=imported learner_kp_states (integration.db.test hashes EVERY
// such row), so the two suites stay parallel-safe; the applier already serializes
// per-learner. Every delete is scoped to the fixture's own session / course / row
// ids — never a blanket DELETE WHERE origin='system' — so the DB is left EXACTLY
// at baseline.
import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, schema } from "@prep-forge/db";
import { foldEvents, getDemoLearnerId, loadFoldEvents } from "@prep-forge/lesson-runtime";
import { recordEvent, submitAnswer } from "../app/learn/[lessonId]/actions";
import { loadPacket } from "./packets";
import { buildDashboard, loadSeed } from "./seed";

const HAS_DB = Boolean(process.env.DATABASE_URL);
// In CI the loop proof MUST run — fail loudly if the Postgres service/env was
// dropped, so this can never silently skip back to green (matching the sibling
// db suites). Gates on HAS_DB ONLY, never on the real-import baseline.
if (process.env.CI && !HAS_DB) {
  throw new Error("loop-e2e.db.test requires DATABASE_URL in CI (the Postgres service must be wired)");
}

// Fixture identity — globally unique, owned solely by this suite.
const COURSE = "E2E01";
const MAINT_COURSE = "E2E99";
const COURSES = [COURSE, MAINT_COURSE];
const KP1 = "E2E01-K1";
const KP2 = "E2E01-K2";
const MAINT_KP = "E2E99-MK1";
const Q1 = `question#${COURSE}:fixture:Q-01`; // 单选题, correct = B, kp KP1
const Q2 = `question#${COURSE}:fixture:Q-02`; // 单选题, correct = A, kp KP2
const Q_UNGRADED = `question#${COURSE}:fixture:Q-UG`; // unsupported type → ungraded
const GRADED_Q_IDS = [Q1, Q2];
const Q_IDS = [Q1, Q2, Q_UNGRADED];
const PACKET = `lesson_packet#${COURSE}:loop-e2e`;
const PACKET_UNGRADED = `lesson_packet#${COURSE}:loop-e2e-ungraded`;
const PACKET_IDS = [PACKET, PACKET_UNGRADED];
const STEP_EXPLAIN = `lesson_step#${COURSE}:loop-e2e:1`;
const STEP_PRACTICE = `lesson_step#${COURSE}:loop-e2e:2`;
const STEP_UNGRADED = `lesson_step#${COURSE}:loop-e2e-ungraded:1`;
const PACKET_KPS = [KP1, KP2];
// high-completion maintenance signal: a single mastered origin=system row (NOT
// imported, to avoid polluting integration.db.test's whole-DB imported hash).
const MAINT_SYS_KP_ID = `learner_kp_state#system#e2e-maint:${MAINT_COURSE}:${MAINT_KP}`;

// disposable, per-run session ids → targeted cleanup.
const RUN = Date.now();
const S1 = `loop-e2e-${RUN}`;
const S_UNGRADED = `loop-e2e-ungraded-${RUN}`;
const MY_SESSIONS = [S1, S_UNGRADED];

const db = HAS_DB ? createDb() : (null as never);
let LEARNER = "";
let createdLearner = false;

/** md5 over the imported question-bank fixture rows' mutable columns. The loop
 * READS these (grading) but must never WRITE them — origin=imported is read-only. */
async function importedContentHash(): Promise<string> {
  const [qs, opts, sols, links] = await Promise.all([
    db.select().from(schema.questions).where(inArray(schema.questions.id, Q_IDS)),
    db.select().from(schema.questionOptions).where(inArray(schema.questionOptions.questionId, Q_IDS)),
    db.select().from(schema.questionSolutions).where(inArray(schema.questionSolutions.questionId, Q_IDS)),
    db.select().from(schema.questionKpLinks).where(inArray(schema.questionKpLinks.questionId, Q_IDS)),
  ]);
  const norm = (rows: Record<string, unknown>[]) =>
    rows.map((r) => [r.id, r.origin, JSON.stringify(r)]).sort();
  return createHash("md5")
    .update(JSON.stringify([norm(qs), norm(opts), norm(sols), norm(links)]))
    .digest("hex");
}

async function systemKpState(kpCode: string) {
  const rows = await db
    .select()
    .from(schema.learnerKpStates)
    .where(and(eq(schema.learnerKpStates.courseCode, COURSE), eq(schema.learnerKpStates.kpCode, kpCode), eq(schema.learnerKpStates.origin, "system")));
  return rows[0] ?? null;
}

/** Delete ONLY this fixture's rows (events first, then derived, then seeded). */
async function deleteFixture(): Promise<void> {
  // events first so a concurrent global re-fold can't recreate the derived rows.
  await db.delete(schema.sessionEvents).where(inArray(schema.sessionEvents.sessionId, MY_SESSIONS));
  await db.delete(schema.learnerKpStates).where(and(eq(schema.learnerKpStates.origin, "system"), inArray(schema.learnerKpStates.courseCode, COURSES)));
  await db.delete(schema.reviewItems).where(and(eq(schema.reviewItems.origin, "system"), inArray(schema.reviewItems.courseCode, COURSES)));
  await db.delete(schema.mistakes).where(and(eq(schema.mistakes.origin, "system"), inArray(schema.mistakes.courseCode, COURSES)));
  // seeded imported question bank + lesson + curriculum.
  await db.delete(schema.questionKpLinks).where(inArray(schema.questionKpLinks.questionId, Q_IDS));
  await db.delete(schema.questionSolutions).where(inArray(schema.questionSolutions.questionId, Q_IDS));
  await db.delete(schema.questionOptions).where(inArray(schema.questionOptions.questionId, Q_IDS));
  await db.delete(schema.questions).where(inArray(schema.questions.id, Q_IDS));
  await db.delete(schema.lessonSteps).where(inArray(schema.lessonSteps.lessonPacketId, PACKET_IDS)); // FK → packets
  await db.delete(schema.lessonPackets).where(inArray(schema.lessonPackets.id, PACKET_IDS));
  await db.delete(schema.knowledgePoints).where(inArray(schema.knowledgePoints.courseCode, COURSES));
  await db.delete(schema.courses).where(inArray(schema.courses.courseCode, COURSES));
}

async function seedFixture(): Promise<void> {
  await db.insert(schema.courses).values([
    { id: `course#${COURSE}`, origin: "imported", visibility: "public", courseCode: COURSE, slug: null, name: "E2E loop course", examTrack: null, examStatus: "在考", sourceBlockId: null, contentHash: null },
    { id: `course#${MAINT_COURSE}`, origin: "imported", visibility: "public", courseCode: MAINT_COURSE, slug: null, name: "E2E maintenance course", examTrack: null, examStatus: "重考", sourceBlockId: null, contentHash: null },
  ]);
  await db.insert(schema.knowledgePoints).values([
    { id: `kp#${COURSE}:${KP1}`, origin: "imported", visibility: "public", courseCode: COURSE, kpCode: KP1, title: "KP one", chapterNo: null, examFrequency: null, sourceBlockId: null, contentHash: null },
    { id: `kp#${COURSE}:${KP2}`, origin: "imported", visibility: "public", courseCode: COURSE, kpCode: KP2, title: "KP two", chapterNo: null, examFrequency: null, sourceBlockId: null, contentHash: null },
    { id: `kp#${MAINT_COURSE}:${MAINT_KP}`, origin: "imported", visibility: "public", courseCode: MAINT_COURSE, kpCode: MAINT_KP, title: "Maintenance KP", chapterNo: null, examFrequency: null, sourceBlockId: null, contentHash: null },
  ]);
  await db.insert(schema.questions).values([
    { id: Q1, origin: "imported", visibility: "public", courseCode: COURSE, src: "fixture", questionId: "Q-01", stemHash: null, chapterNo: null, sequence: 1, stem: "选出正确项（Q1）", type: "单选题", sourceBlockId: null, contentHash: null },
    { id: Q2, origin: "imported", visibility: "public", courseCode: COURSE, src: "fixture", questionId: "Q-02", stemHash: null, chapterNo: null, sequence: 2, stem: "选出正确项（Q2）", type: "单选题", sourceBlockId: null, contentHash: null },
    { id: Q_UNGRADED, origin: "imported", visibility: "public", courseCode: COURSE, src: "fixture", questionId: "Q-UG", stemHash: null, chapterNo: null, sequence: 3, stem: "请简述概念", type: "简答题", sourceBlockId: null, contentHash: null },
  ]);
  await db.insert(schema.questionOptions).values([
    { id: `${Q1}:A`, origin: "imported", visibility: "public", questionId: Q1, label: "A", content: "错误项", isCorrect: false, sourceBlockId: null, contentHash: null },
    { id: `${Q1}:B`, origin: "imported", visibility: "public", questionId: Q1, label: "B", content: "正确项", isCorrect: true, sourceBlockId: null, contentHash: null },
    { id: `${Q2}:A`, origin: "imported", visibility: "public", questionId: Q2, label: "A", content: "正确项", isCorrect: true, sourceBlockId: null, contentHash: null },
    { id: `${Q2}:B`, origin: "imported", visibility: "public", questionId: Q2, label: "B", content: "错误项", isCorrect: false, sourceBlockId: null, contentHash: null },
  ]);
  await db.insert(schema.questionSolutions).values([
    { id: `${Q1}:sol`, origin: "imported", visibility: "public", questionId: Q1, answer: "B", explanation: null, sourceBlockId: null, contentHash: null },
    { id: `${Q2}:sol`, origin: "imported", visibility: "public", questionId: Q2, answer: "A", explanation: null, sourceBlockId: null, contentHash: null },
  ]);
  await db.insert(schema.questionKpLinks).values([
    { id: `${Q1}:kp`, origin: "imported", visibility: "public", questionId: Q1, courseCode: COURSE, kpCode: KP1, sourceBlockId: null, contentHash: null },
    { id: `${Q2}:kp`, origin: "imported", visibility: "public", questionId: Q2, courseCode: COURSE, kpCode: KP2, sourceBlockId: null, contentHash: null },
    { id: `${Q_UNGRADED}:kp`, origin: "imported", visibility: "public", questionId: Q_UNGRADED, courseCode: COURSE, kpCode: KP1, sourceBlockId: null, contentHash: null },
  ]);
  await db.insert(schema.lessonPackets).values([
    {
      id: PACKET, origin: "system", visibility: "public", version: 1, status: "ready", subjectCode: null,
      courseCode: COURSE, title: "E2E loop packet", kpCodes: PACKET_KPS, prerequisites: null,
      estimatedMinutes: null, difficulty: null, objectives: ["走通一遍闭环"], sourceBlockId: null, contentHash: null,
    },
    {
      id: PACKET_UNGRADED, origin: "system", visibility: "public", version: 1, status: "ready", subjectCode: null,
      courseCode: COURSE, title: "E2E ungraded packet", kpCodes: [KP1], prerequisites: null,
      estimatedMinutes: null, difficulty: null, objectives: ["验证未批改不计数"], sourceBlockId: null, contentHash: null,
    },
  ]);
  await db.insert(schema.lessonSteps).values([
    { id: STEP_EXPLAIN, lessonPacketId: PACKET, sequence: 1, type: "explanation", prompt: "讲解", mdx: "讲解正文", math: null, questionIds: null },
    { id: STEP_PRACTICE, lessonPacketId: PACKET, sequence: 2, type: "practice", prompt: "练习", mdx: null, math: null, questionIds: GRADED_Q_IDS },
    { id: STEP_UNGRADED, lessonPacketId: PACKET_UNGRADED, sequence: 1, type: "practice", prompt: "简答练习", mdx: null, math: null, questionIds: [Q_UNGRADED] },
  ]);
  // high-completion course: one mastered origin=system KP state (no E2E99 events
  // exist, so the applier never touches this row). read layer flags maintenance.
  await db.insert(schema.learnerKpStates).values({
    id: MAINT_SYS_KP_ID, origin: "system", visibility: "personal", learnerId: LEARNER,
    courseCode: MAINT_COURSE, kpCode: MAINT_KP, state: "mastered", score: 1,
    lastAppliedSessionId: null, lastAppliedSequence: null, sourceBlockId: null, contentHash: null,
  });
}

let importedHashBefore = "";

describe.skipIf(!HAS_DB)("§6 自给种子端到端 — real loop on a minimal fixture", () => {
  beforeAll(async () => {
    // ensure a demo learner exists (the web action's getDemoLearnerId reads
    // learner_profiles[0]); insert one only if none — and remember to remove it.
    const existing = await db.select().from(schema.learnerProfiles).limit(1);
    if (existing.length === 0) {
      await db.insert(schema.learnerProfiles).values({
        id: "learner_profile#e2e-loop-fixture", origin: "imported", visibility: "personal",
        learnerId: "ai-teacher-self", displayName: "e2e loop fixture", examTrack: null,
        preferences: null, sourceBlockId: null, contentHash: null,
      });
      createdLearner = true;
    }
    LEARNER = await getDemoLearnerId(db);

    await deleteFixture(); // clear any leftovers from an interrupted run
    await seedFixture();
    importedHashBefore = await importedContentHash();
  });

  afterAll(async () => {
    await deleteFixture();
    if (createdLearner) {
      await db.delete(schema.learnerProfiles).where(eq(schema.learnerProfiles.id, "learner_profile#e2e-loop-fixture"));
    }
  });

  it("grades objective answers, freezes the GradingResult, and derives origin=system rows", async () => {
    expect((await recordEvent({ sessionId: S1, sequence: 0, lessonPacketId: PACKET, kind: "start" })).persisted).toBe(true);
    expect((await recordEvent({ sessionId: S1, sequence: 1, lessonPacketId: PACKET, kind: "step", stepId: STEP_EXPLAIN })).persisted).toBe(true);
    const correct = await submitAnswer({ sessionId: S1, sequence: 2, lessonPacketId: PACKET, stepId: STEP_PRACTICE, questionId: Q1, submitted: "B" });
    const wrong = await submitAnswer({ sessionId: S1, sequence: 3, lessonPacketId: PACKET, stepId: STEP_PRACTICE, questionId: Q2, submitted: "B" });
    expect(correct.persisted).toBe(true);
    expect(correct.graded).toMatchObject({ kind: "graded", correct: true, score: 1 });
    expect(wrong.graded).toMatchObject({ kind: "graded", correct: false, score: 0 });

    // GradingResult FROZEN into the persisted student_answered payload.
    const evs = await db.select().from(schema.sessionEvents).where(eq(schema.sessionEvents.sessionId, S1));
    expect(evs.some((e) => e.eventType === "lesson_started")).toBe(true);
    const graded = evs.filter((e) => e.eventType === "student_answered" && (e.payload as { kind?: string } | null)?.kind === "graded");
    expect(graded.length).toBe(2);
    const q1Ev = graded.find((e) => (e.payload as { gradingResult: { questionId: string } }).gradingResult.questionId === Q1)!;
    expect((q1Ev.payload as { gradingResult: { correct: boolean; score: number } }).gradingResult).toMatchObject({ correct: true, score: 1 });

    // applier wrote origin=system rows: practiced KP1 state, a mistake for the
    // wrong Q2, a review_item with an ISO due_date.
    const kp1 = await systemKpState(KP1);
    expect(kp1?.state).toBe("practiced");
    expect(kp1?.origin).toBe("system");
    const wrongMistake = (await db.select().from(schema.mistakes).where(and(eq(schema.mistakes.origin, "system"), eq(schema.mistakes.questionRef, Q2))))[0];
    expect(wrongMistake, "a system mistake row exists for the wrong answer").toBeTruthy();
    expect(wrongMistake!.sourceSessionId).toBe(S1);
    const review = (await db.select().from(schema.reviewItems).where(and(eq(schema.reviewItems.origin, "system"), eq(schema.reviewItems.courseCode, COURSE), eq(schema.reviewItems.kpCode, KP1))))[0];
    expect(review, "a system review_item exists for the practiced KP").toBeTruthy();
    expect(review!.dueDate).toBe(new Date(review!.dueDate!).toISOString()); // already ISO
  });

  it("leaves an all-ungraded completion uncounted and keeps the packet ready", async () => {
    expect((await recordEvent({ sessionId: S_UNGRADED, sequence: 0, lessonPacketId: PACKET_UNGRADED, kind: "start" })).persisted).toBe(true);
    expect((await recordEvent({ sessionId: S_UNGRADED, sequence: 1, lessonPacketId: PACKET_UNGRADED, kind: "step", stepId: STEP_UNGRADED })).persisted).toBe(true);
    const answer = await submitAnswer({
      sessionId: S_UNGRADED,
      sequence: 2,
      lessonPacketId: PACKET_UNGRADED,
      stepId: STEP_UNGRADED,
      questionId: Q_UNGRADED,
      submitted: "free text",
    });
    expect(answer.graded.kind).toBe("ungraded");

    const res = await recordEvent({ sessionId: S_UNGRADED, sequence: 3, lessonPacketId: PACKET_UNGRADED, kind: "complete" });
    expect(res.persisted).toBe(true);
    expect(res.wvll?.countable).toBe(false);
    expect(res.wvll?.checks.answerGraded).toBe(false);
    expect(res.wvll?.checks.readyPacket).toBe(false);
    const packet = (await db.select({ status: schema.lessonPackets.status }).from(schema.lessonPackets).where(eq(schema.lessonPackets.id, PACKET_UNGRADED)))[0];
    expect(packet?.status).toBe("ready");
  });

  it("completes the packet (ready→consumed, WVLL countable) only with a graded answer, and replays idempotently", async () => {
    const before = (await db.select({ status: schema.lessonPackets.status }).from(schema.lessonPackets).where(eq(schema.lessonPackets.id, PACKET)))[0];
    expect(before?.status).toBe("ready");

    const res = await recordEvent({ sessionId: S1, sequence: 4, lessonPacketId: PACKET, kind: "complete" });
    expect(res.persisted).toBe(true);
    // ready→consumed is gated on a graded answer: the WVLL predicate's answerGraded
    // check is what makes the completion countable (ROADMAP §2 / design D10).
    expect(res.wvll?.checks.answerGraded).toBe(true);
    expect(res.wvll?.countable).toBe(true);
    const after = (await db.select({ status: schema.lessonPackets.status }).from(schema.lessonPackets).where(eq(schema.lessonPackets.id, PACKET)))[0];
    expect(after?.status).toBe("consumed");

    // replay: re-fold THIS fixture's events (filtered, so a parallel suite's
    // events can't perturb it) twice in opposite order → identical terminal state.
    const myEvents = (await loadFoldEvents(db)).filter((e) => MY_SESSIONS.includes(e.sessionId));
    expect(myEvents.length).toBeGreaterThan(0);
    const r1 = foldEvents(LEARNER, myEvents);
    const r2 = foldEvents(LEARNER, [...myEvents].reverse());
    expect(r2).toEqual(r1);
    expect(r1.reviewItems.find((x) => x.kpCode === KP1)!.dueDate).toBe(r2.reviewItems.find((x) => x.kpCode === KP1)!.dueDate);
  });

  it("never rewrites imported rows, and the high-completion course reads as maintenance", async () => {
    // the imported question-bank fixture rows are byte-identical post-loop (the
    // loop reads them to grade, but writes only origin=system projection rows).
    expect(await importedContentHash()).toBe(importedHashBefore);
    const q1Row = (await db.select().from(schema.questions).where(eq(schema.questions.id, Q1)))[0];
    expect(q1Row!.origin).toBe("imported");

    // step-driven classroom (not free chat): ordered, typed steps incl. practice.
    const loaded = await loadPacket(PACKET);
    expect(loaded?.source).toBe("db");
    const practice = loaded!.packet.steps.find((s) => s.type === "practice")!;
    expect(practice.questions.some((q) => q.type === "单选题")).toBe(true);

    // the tiny high-completion course (1/1 mastered ≥ 0.8) reads as maintenance.
    const dash = buildDashboard(await loadSeed());
    expect(dash.source).toBe("db");
    expect(dash.maintenanceCourses.map((c) => c.courseCode)).toContain(MAINT_COURSE);
  });
});
