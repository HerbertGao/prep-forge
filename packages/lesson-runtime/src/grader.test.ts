import { describe, expect, it } from "vitest";
import { OBJECTIVE_TYPES, gradeAnswer, isObjectiveType } from "./grader";
import type { QuestionGradingInput } from "./grader";

const base = (over: Partial<QuestionGradingInput>): QuestionGradingInput => ({
  questionId: "question#C1:src1:q1",
  type: "单选题",
  options: [],
  solutionAnswer: null,
  kpCodes: ["K1"],
  ...over,
});

describe("objective allowlist", () => {
  it("recognizes all three 单选 unicode variants + 多选题, not 判断题", () => {
    expect(isObjectiveType("单选题")).toBe(true);
    expect(isObjectiveType("単選題")).toBe(true);
    expect(isObjectiveType("单选題")).toBe(true);
    expect(isObjectiveType("多选题")).toBe(true);
    expect(isObjectiveType("判断题")).toBe(false);
    expect(OBJECTIVE_TYPES.size).toBe(4);
  });
});

describe("gradeAnswer — options path (isCorrect preferred)", () => {
  const single = base({
    options: [
      { label: "A", isCorrect: false },
      { label: "B", isCorrect: true },
      { label: "C", isCorrect: false },
    ],
  });

  it("scores 1 / correct=true on a match", () => {
    const p = gradeAnswer(single, "B");
    expect(p.kind).toBe("graded");
    if (p.kind !== "graded") throw new Error("expected graded");
    expect(p.gradingResult.score).toBe(1);
    expect(p.gradingResult.correct).toBe(true);
    expect(p.gradingResult.questionId).toBe("question#C1:src1:q1");
    expect(p.resolvedKpCodes).toEqual(["K1"]);
    expect(p.modelCallId).toBeNull();
  });

  it("scores 0 / correct=false on a mismatch", () => {
    const p = gradeAnswer(single, "A");
    if (p.kind !== "graded") throw new Error("expected graded");
    expect(p.gradingResult.score).toBe(0);
    expect(p.gradingResult.correct).toBe(false);
  });

  it("grades 多选 as a set (order-independent)", () => {
    const multi = base({
      type: "多选题",
      options: [
        { label: "A", isCorrect: true },
        { label: "B", isCorrect: false },
        { label: "C", isCorrect: true },
      ],
    });
    expect((gradeAnswer(multi, ["C", "A"]) as { gradingResult: { correct: boolean } }).gradingResult.correct).toBe(true);
    expect((gradeAnswer(multi, "AC") as { gradingResult: { correct: boolean } }).gradingResult.correct).toBe(true);
    expect((gradeAnswer(multi, ["A"]) as { gradingResult: { correct: boolean } }).gradingResult.correct).toBe(false);
  });

  it("treats populated all-false options as ungraded, not graded-wrong", () => {
    const p = gradeAnswer(
      base({
        options: [
          { label: "A", isCorrect: false },
          { label: "B", isCorrect: false },
        ],
      }),
      "A",
    );
    expect(p.kind).toBe("ungraded");
  });
});

describe("gradeAnswer — solution fallback (isCorrect all null)", () => {
  it("uses question_solutions.answer when no option.isCorrect is set", () => {
    const q = base({
      options: [
        { label: "A", isCorrect: null },
        { label: "B", isCorrect: null },
      ],
      solutionAnswer: "B",
    });
    expect((gradeAnswer(q, "B") as { gradingResult: { score: number } }).gradingResult.score).toBe(1);
    expect((gradeAnswer(q, "A") as { gradingResult: { score: number } }).gradingResult.score).toBe(0);
  });

  it("parses leading solution labels without grading prose letters", () => {
    const q = base({
      options: [
        { label: "A", isCorrect: null },
        { label: "B", isCorrect: null },
        { label: "C", isCorrect: null },
      ],
      solutionAnswer: "B (correct)",
    });
    expect((gradeAnswer(q, "B") as { gradingResult: { score: number } }).gradingResult.score).toBe(1);
    expect((gradeAnswer(q, "C") as { gradingResult: { score: number } }).gradingResult.score).toBe(0);
  });

  it("keeps common multi-label solution prose like A、B correct", () => {
    const q = base({
      type: "多选题",
      options: [
        { label: "A", isCorrect: null },
        { label: "B", isCorrect: null },
        { label: "C", isCorrect: null },
      ],
      solutionAnswer: "A、B",
    });
    expect((gradeAnswer(q, ["B", "A"]) as { gradingResult: { score: number } }).gradingResult.score).toBe(1);
  });

  it("solution-fallback with a non-letter prefix (e.g. 选B) → ungraded, never a fabricated verdict", () => {
    // Pins the leadingSolutionLetters fallback behavior. NOTE: in the real
    // snapshot this branch is unreachable — all 30787 question_options carry
    // isCorrect (0 of 8272 questions rely on the solution-answer fallback), so
    // objective grading always uses the isCorrect path. This guards the edge if
    // a future import ever lacks isCorrect: a Chinese-prefixed answer yields no
    // leading label → ungraded (safe, non-fabricating), not a wrong verdict.
    const q = base({
      options: [
        { label: "A", isCorrect: null },
        { label: "B", isCorrect: null },
      ],
      solutionAnswer: "选B",
    });
    expect(gradeAnswer(q, "B").kind).toBe("ungraded");
  });

  it("ungraded when objective but no answer key at all", () => {
    const q = base({ options: [{ label: "A", isCorrect: null }], solutionAnswer: null });
    const p = gradeAnswer(q, "A");
    expect(p.kind).toBe("ungraded");
  });
});

describe("gradeAnswer — subjective / unknown", () => {
  it("never fabricates a score for an unsupported type", () => {
    const p = gradeAnswer(base({ type: "简答题" }), "anything");
    expect(p.kind).toBe("ungraded");
    if (p.kind !== "ungraded") throw new Error("expected ungraded");
    expect(p.reason).toContain("简答题");
    expect(p.resolvedKpCodes).toEqual(["K1"]);
    expect("score" in p).toBe(false);
  });
});
