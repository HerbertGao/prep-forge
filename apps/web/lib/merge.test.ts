import { describe, expect, it } from "vitest";
import {
  isMistakeActive,
  isReviewDueToday,
  mergeKpStateByMax,
  mergeReviews,
  reviewPassesAdminGate,
  wvllCountable,
} from "./merge";

describe("mergeKpStateByMax (per-KP monotonic max, design D7)", () => {
  it("takes the max rank when imported and system disagree", () => {
    const m = mergeKpStateByMax([
      { kpCode: "K1", state: "taught" }, // imported
      { kpCode: "K1", state: "mastered" }, // system
      { kpCode: "K2", state: "practiced" },
      { kpCode: "K2", state: "unseen" },
    ]);
    expect(m.get("K1")).toBe("mastered");
    expect(m.get("K2")).toBe("practiced");
  });
});

describe("mergeReviews (per-KP, system due_date wins, design D7)", () => {
  it("system row wins over imported for the same (learner,kp)", () => {
    const merged = mergeReviews([
      { id: "imp", learnerId: "L", courseCode: "C", kpCode: "K", origin: "imported", dueDate: "2026-01-01" },
      { id: "sys", learnerId: "L", courseCode: "C", kpCode: "K", origin: "system", dueDate: "2026-09-01" },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.id).toBe("sys");
    expect(merged[0]!.dueDate).toBe("2026-09-01");
  });

  it("imported-only collapses to its max non-null due_date", () => {
    const merged = mergeReviews([
      { id: "a", learnerId: "L", courseCode: null, kpCode: "K", origin: "imported", dueDate: "2026-03-05" },
      { id: "b", learnerId: "L", courseCode: "C", kpCode: "K", origin: "imported", dueDate: null },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.dueDate).toBe("2026-03-05");
    expect(merged[0]!.courseCode).toBe("C"); // course coalesced from the non-null row
  });

  it("keeps distinct non-null courses separate even when kpCode matches", () => {
    const merged = mergeReviews([
      { id: "c1", learnerId: "L", courseCode: "C1", kpCode: "K", origin: "imported", dueDate: "2026-03-05" },
      { id: "c2", learnerId: "L", courseCode: "C2", kpCode: "K", origin: "imported", dueDate: "2026-03-06" },
    ]);
    expect(merged).toHaveLength(2);
    expect(new Set(merged.map((r) => r.courseCode))).toEqual(new Set(["C1", "C2"]));
  });
});

describe("isReviewDueToday (gate, design D11)", () => {
  const now = new Date("2026-06-29T12:00:00.000Z");
  const base = { id: "x", learnerId: "L", courseCode: "C", kpCode: "K", origin: "system" as const };

  it("past due + unconfirmed → due", () => {
    expect(
      isReviewDueToday({ ...base, dueDate: "2026-03-05", adminConfirmedAt: null, lastAppliedAt: null }, now),
    ).toBe(true);
  });

  it("future due → not due", () => {
    expect(
      isReviewDueToday({ ...base, dueDate: "2026-12-01", adminConfirmedAt: null, lastAppliedAt: null }, now),
    ).toBe(false);
  });

  it("confirmed after last activity → leaves the list this cycle", () => {
    expect(
      reviewPassesAdminGate({
        adminConfirmedAt: new Date("2026-06-20"),
        lastAppliedAt: new Date("2026-06-10"),
      }),
    ).toBe(false);
  });

  it("a later wrong answer (last_applied_at > confirm) resurfaces it", () => {
    expect(
      reviewPassesAdminGate({
        adminConfirmedAt: new Date("2026-06-10"),
        lastAppliedAt: new Date("2026-06-20"),
      }),
    ).toBe(true);
  });
});

describe("isMistakeActive (per-event, design D11)", () => {
  it("active iff admin_confirmed_at is null", () => {
    expect(isMistakeActive({ adminConfirmedAt: null })).toBe(true);
    expect(isMistakeActive({ adminConfirmedAt: new Date() })).toBe(false);
  });
});

describe("wvllCountable (ROADMAP §2, design D10)", () => {
  it("counts a completed ready packet with a graded answer", () => {
    const r = wvllCountable({
      readyPacketConsumed: true,
      sessionEventCount: 5,
      gradedAnswerCount: 1,
      deterministicUpdate: true,
    });
    expect(r.countable).toBe(true);
  });

  it("does NOT count when no answer was graded", () => {
    const r = wvllCountable({
      readyPacketConsumed: true,
      sessionEventCount: 5,
      gradedAnswerCount: 0,
      deterministicUpdate: false,
    });
    expect(r.countable).toBe(false);
    expect(r.checks.answerGraded).toBe(false);
  });

  it("does NOT count without a ready→consumed transition", () => {
    const r = wvllCountable({
      readyPacketConsumed: false,
      sessionEventCount: 5,
      gradedAnswerCount: 1,
      deterministicUpdate: true,
    });
    expect(r.countable).toBe(false);
    expect(r.checks.notQuarantined).toBe(false);
  });
});
