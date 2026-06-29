import { describe, expect, it } from "vitest";
import {
  MASTERY_THRESHOLD,
  REVIEW_LADDER_DAYS,
  REVIEW_WRONG_DAYS,
  foldEvents,
} from "./fold";
import type { FoldEvent } from "./fold";

const LEARNER = "ai-teacher-self";
const COURSE = "C1";

function stepShown(
  sessionId: string,
  sequence: number,
  createdAt: string,
  stepType: "explanation" | "worked_example" | "practice",
  kpCodes: string[],
): FoldEvent {
  return {
    sessionId,
    sequence,
    createdAt: new Date(createdAt),
    eventType: "step_shown",
    courseCode: COURSE,
    payload: { stepType, kpCodes },
  };
}

function answered(
  sessionId: string,
  sequence: number,
  createdAt: string,
  kpCodes: string[],
  correct: boolean,
  questionRef = "question#C1:src:q1",
): FoldEvent {
  return {
    sessionId,
    sequence,
    createdAt: new Date(createdAt),
    eventType: "student_answered",
    courseCode: COURSE,
    payload: {
      kind: "graded",
      gradingResult: {
        questionId: questionRef,
        score: correct ? 1 : 0,
        correct,
        modelCallId: null,
      },
      resolvedKpCodes: kpCodes,
      modelCallId: null,
    },
  };
}

const addDaysISO = (createdAt: string, days: number) =>
  new Date(new Date(createdAt).getTime() + days * 86_400_000).toISOString();

describe("foldEvents — KP state machine", () => {
  it("taught → practiced → mastered with the right review ladder", () => {
    const t0 = "2026-06-29T00:00:00.000Z";
    const t1 = "2026-06-29T01:00:00.000Z";
    const t2 = "2026-06-29T02:00:00.000Z";
    const events = [
      stepShown("s1", 0, t0, "explanation", ["K1"]),
      answered("s1", 1, t1, ["K1"], true),
      answered("s1", 2, t2, ["K1"], true),
    ];
    const r = foldEvents(LEARNER, events);

    expect(r.kpStates).toHaveLength(1);
    expect(r.kpStates[0]).toMatchObject({ kpCode: "K1", state: "mastered", score: 1 });
    expect(r.mistakes).toHaveLength(0);

    expect(r.reviewItems).toHaveLength(1);
    // 2nd correct ⇒ ladder index 1 ⇒ +3 days, anchored at the triggering created_at.
    expect(r.reviewItems[0]!.dueDate).toBe(addDaysISO(t2, REVIEW_LADDER_DAYS[1]!));
    expect(r.reviewItems[0]!.lastAppliedAt.toISOString()).toBe(t2);
    expect(MASTERY_THRESHOLD).toBe(2);
  });

  it("a wrong-only KP gets a mistake + near-tier review but stays unseen", () => {
    const t0 = "2026-06-29T00:00:00.000Z";
    const r = foldEvents(LEARNER, [answered("s1", 0, t0, ["K2"], false, "question#C1:src:q9")]);
    expect(r.kpStates).toHaveLength(0); // never taught/practiced
    expect(r.mistakes).toHaveLength(1);
    expect(r.mistakes[0]).toMatchObject({
      kpCode: "K2",
      questionRef: "question#C1:src:q9",
      sourceSessionId: "s1",
      sourceSequence: 0,
    });
    expect(r.reviewItems).toHaveLength(1);
    expect(r.reviewItems[0]!.dueDate).toBe(addDaysISO(t0, REVIEW_WRONG_DAYS));
  });

  it("ungraded answers produce no state / review / mistake", () => {
    const ev: FoldEvent = {
      sessionId: "s1",
      sequence: 0,
      createdAt: new Date("2026-06-29T00:00:00.000Z"),
      eventType: "student_answered",
      courseCode: COURSE,
      payload: { kind: "ungraded", reason: "subjective", resolvedKpCodes: ["K3"] },
    };
    const r = foldEvents(LEARNER, [ev]);
    expect(r).toEqual({ kpStates: [], mistakes: [], reviewItems: [] });
  });
});

describe("foldEvents — replay consistency (task 2.7)", () => {
  const t0 = "2026-06-29T00:00:00.000Z";
  const t1 = "2026-06-29T01:00:00.000Z";
  const t2 = "2026-06-29T02:00:00.000Z";
  const events = [
    stepShown("s1", 0, t0, "explanation", ["K1"]),
    answered("s1", 1, t1, ["K1"], true),
    answered("s1", 2, t2, ["K1"], false, "question#C1:src:q1"),
    stepShown("s1", 3, t2, "explanation", ["K9"]),
  ];

  it("full re-fold is identical (idempotent) regardless of input order", () => {
    const first = foldEvents(LEARNER, events);
    const second = foldEvents(LEARNER, [...events].reverse());
    expect(second).toEqual(first);
  });
});

describe("foldEvents — equal created_at tiebroken by (session_id, sequence)", () => {
  // two correct answers for K7 at the SAME created_at, in different sessions.
  const tEq = "2026-06-29T00:00:00.000Z";
  const tLater = "2026-06-29T05:00:00.000Z";
  const a = answered("s1", 5, tEq, ["K7"], true);
  const bb = answered("s2", 3, tEq, ["K7"], true);
  // a trailing passive step_shown later ⇒ last_applied_at must move forward (D11).
  const trailing = stepShown("s2", 9, tLater, "explanation", ["K7"]);

  it("orders s1<s2 deterministically and last_applied points to the latest event", () => {
    const forward = foldEvents(LEARNER, [a, bb, trailing]);
    const shuffled = foldEvents(LEARNER, [trailing, bb, a]);
    expect(shuffled).toEqual(forward);

    expect(forward.kpStates).toHaveLength(1);
    expect(forward.kpStates[0]).toMatchObject({ kpCode: "K7", state: "mastered" });

    const review = forward.reviewItems[0]!;
    // trailing step_shown (s2/seq9 @ tLater) is the last folded event for K7.
    expect(review.lastAppliedSessionId).toBe("s2");
    expect(review.lastAppliedSequence).toBe(9);
    expect(review.lastAppliedAt.toISOString()).toBe(tLater);
    // due date was set by the 2nd correct (created_at = tEq), unaffected by the
    // passive trailing step — proving scheduling uses the answer's created_at.
    expect(review.dueDate).toBe(addDaysISO(tEq, REVIEW_LADDER_DAYS[1]!));
  });
});

describe("foldEvents — identical created_at: (session_id, sequence) order decides terminal dueDate", () => {
  // Three answers for K8 at the SAME created_at, ordered ONLY by the
  // (session_id, sequence) tiebreaker. Whether the run terminates on the wrong
  // (near tier +1d) or on the 2nd consecutive correct (far ladder +3d) flips the
  // terminal review dueDate — a genuinely order-sensitive terminal state. The
  // symmetric two-correct case above passes even if compareFoldEvents dropped
  // the tiebreak (returned 0); THIS case fails it: with a 0-returning comparator
  // the sort keeps input order, so forward and reversed inputs would yield
  // different terminal dueDates and the `toEqual` below would break.
  const tEq = "2026-06-29T00:00:00.000Z";
  const c1 = (seq: number) => answered("s1", seq, tEq, ["K8"], true, "question#C1:src:k8c1");
  const c2 = (seq: number) => answered("s1", seq, tEq, ["K8"], true, "question#C1:src:k8c2");
  const wrong = (seq: number) => answered("s1", seq, tEq, ["K8"], false, "question#C1:src:k8w");

  it("wrong sequenced LAST ⇒ run ends wrong ⇒ near tier (+1d)", () => {
    const evs = [c1(1), c2(2), wrong(3)];
    const r = foldEvents(LEARNER, evs);
    expect(foldEvents(LEARNER, [...evs].reverse())).toEqual(r); // total-ordered, not input-order
    const review = r.reviewItems.find((x) => x.kpCode === "K8")!;
    expect(review.dueDate).toBe(addDaysISO(tEq, REVIEW_WRONG_DAYS));
    expect(review.lastAppliedSequence).toBe(3); // the wrong (highest sequence) is terminal
    expect(r.kpStates[0]).toMatchObject({ kpCode: "K8", state: "mastered" });
  });

  it("wrong sequenced FIRST ⇒ run ends on the 2nd consecutive correct ⇒ far ladder (+3d)", () => {
    const evs = [wrong(1), c1(2), c2(3)];
    const r = foldEvents(LEARNER, evs);
    expect(foldEvents(LEARNER, [...evs].reverse())).toEqual(r);
    const review = r.reviewItems.find((x) => x.kpCode === "K8")!;
    // SAME created_at, SAME events — only the (session_id, sequence) order
    // changed — yet a strictly different terminal dueDate than the case above.
    expect(review.dueDate).toBe(addDaysISO(tEq, REVIEW_LADDER_DAYS[1]!));
    expect(review.dueDate).not.toBe(addDaysISO(tEq, REVIEW_WRONG_DAYS));
    expect(review.lastAppliedSequence).toBe(3);
  });
});
