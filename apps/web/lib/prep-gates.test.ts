// Pure gate-logic tests (group G7, design D5) — no DB. They pin the three hard
// gates' decision core: Schema (Zod parse of the rebuilt packet), Math (keyed
// step.math), and the Reference gate's confirmation + answer-key binding. The
// IO seams (checkPacketRefs, runGateTx, draft→ready, learner gating) are covered
// in prep.db.test.ts (DB-gated, G8).
import { describe, expect, it } from "vitest";
import { evaluateConfirmations, evaluateStaticGates, type ResolvedRefs } from "./prep";

const validPacket = () => ({
  id: "lesson_packet#prep:job1",
  origin: "ai_generated",
  visibility: "public",
  version: 1,
  status: "validating",
  title: "OS 引论 · AI 草稿",
  kpCodes: ["OS01-02"],
  steps: [
    { id: "s1", type: "explanation", prompt: "操作系统是什么？", mdx: "纯文本讲解。" },
    { id: "s2", type: "practice", questionIds: ["q1"] },
  ],
});

describe("evaluateStaticGates — Schema + Math gates", () => {
  it("a well-formed math-free packet passes both static gates", () => {
    const g = evaluateStaticGates(validPacket());
    expect(g.schemaPassed).toBe(true);
    expect(g.mathRenderPassed).toBe(true);
    expect(g.packet).not.toBeNull();
  });

  it("a malformed packet fails the Schema gate (and yields no parsed packet)", () => {
    const bad = { ...validPacket(), title: undefined };
    const g = evaluateStaticGates(bad);
    expect(g.schemaPassed).toBe(false);
    expect(g.packet).toBeNull();
    expect(g.issues.join(" ")).toMatch(/schema gate/);
  });

  it("a keyed step.math trips the Math gate (no mdx text scan)", () => {
    const withMath = validPacket();
    withMath.steps.push({
      id: "s3",
      type: "math_block",
      // @ts-expect-error crafted math block for the gate
      math: { latex: "x^2", displayMode: "inline" },
    });
    const g = evaluateStaticGates(withMath);
    expect(g.mathRenderPassed).toBe(false);
    expect(g.issues.join(" ")).toMatch(/math gate/);
  });

  it("does NOT scan mdx/prompt text for $…$-like tokens (legitimate math-ish prose passes)", () => {
    const proseMath = validPacket();
    proseMath.steps[0]!.mdx = "成本约为 $5，公式样写法 a$b 不应被误杀。";
    const g = evaluateStaticGates(proseMath);
    expect(g.mathRenderPassed).toBe(true);
  });
});

const resolved = (over: Partial<ResolvedRefs> = {}): ResolvedRefs => ({
  questionsById: new Map([["q1", { type: "单选题", origin: "imported" }]]),
  optionsByQ: new Map([
    [
      "q1",
      [
        { label: "A", isCorrect: false, origin: "imported" },
        { label: "B", isCorrect: true, origin: "imported" },
      ],
    ],
  ]),
  solutionByQ: new Map([["q1", { id: "sol1", answer: "B", origin: "imported" }]]),
  linksByQ: new Map([["q1", [{ id: "link1", kpCode: "OS01-02", origin: "imported" }]]]),
  confirmed: new Set(["question:q1", "answer:sol1", "kp_link:link1"]),
  ...over,
});

describe("evaluateConfirmations — Reference gate confirmation + answer-key binding", () => {
  it("all three axes confirmed + invariant holds ⇒ no issues (→ draft)", () => {
    expect(evaluateConfirmations(["q1"], resolved())).toEqual([]);
  });

  it("unconfirmed question ⇒ quarantine", () => {
    const r = resolved({ confirmed: new Set(["answer:sol1", "kp_link:link1"]) });
    expect(evaluateConfirmations(["q1"], r).join(" ")).toMatch(/question q1 not confirmed/);
  });

  it("no resolvable answer key ⇒ quarantine", () => {
    const r = resolved({
      optionsByQ: new Map([["q1", [{ label: "A", isCorrect: null, origin: "imported" }]]]),
      solutionByQ: new Map(),
    });
    expect(evaluateConfirmations(["q1"], r).join(" ")).toMatch(/no resolvable answer key/);
  });

  it("an answer key that resolves to an empty label set ⇒ quarantine", () => {
    const r = resolved({
      optionsByQ: new Map([
        [
          "q1",
          [
            { label: "A", isCorrect: false, origin: "imported" },
            { label: "B", isCorrect: false, origin: "imported" },
          ],
        ],
      ]),
      solutionByQ: new Map([["q1", { id: "sol1", answer: "无正确选项", origin: "imported" }]]),
    });
    expect(evaluateConfirmations(["q1"], r).join(" ")).toMatch(/no resolvable answer key/);
  });

  it("broken import invariant (solution.answer ≠ option.isCorrect) ⇒ quarantine", () => {
    const r = resolved({ solutionByQ: new Map([["q1", { id: "sol1", answer: "A", origin: "imported" }]]) });
    expect(evaluateConfirmations(["q1"], r).join(" ")).toMatch(/import invariant broken/);
  });

  it("confirmed but non-imported rows ⇒ quarantine", () => {
    const r = resolved({
      questionsById: new Map([["q1", { type: "单选题", origin: "system" }]]),
      optionsByQ: new Map([
        [
          "q1",
          [
            { label: "A", isCorrect: false, origin: "imported" },
            { label: "B", isCorrect: true, origin: "ai_generated" },
          ],
        ],
      ]),
      solutionByQ: new Map([["q1", { id: "sol1", answer: "B", origin: "system" }]]),
      linksByQ: new Map([["q1", [{ id: "link1", kpCode: "OS01-02", origin: "ai_generated" }]]]),
    });
    expect(evaluateConfirmations(["q1"], r).join(" ")).toMatch(/not imported|non-imported/);
  });

  it("unconfirmed answer (solution) ⇒ quarantine", () => {
    const r = resolved({ confirmed: new Set(["question:q1", "kp_link:link1"]) });
    expect(evaluateConfirmations(["q1"], r).join(" ")).toMatch(/answer sol1 .* not confirmed/);
  });

  it("unconfirmed kp_link ⇒ quarantine", () => {
    const r = resolved({ confirmed: new Set(["question:q1", "answer:sol1"]) });
    expect(evaluateConfirmations(["q1"], r).join(" ")).toMatch(/kp_link link1 .* not confirmed/);
  });

  it("question with no kp_links ⇒ quarantine", () => {
    const r = resolved({ linksByQ: new Map() });
    expect(evaluateConfirmations(["q1"], r).join(" ")).toMatch(/no question_kp_links/);
  });
});
