import { describe, expect, it } from "vitest";
import { SessionEvent } from "@prep-forge/schemas";
import { LessonSessionBuilder } from "./session";

const clock = () => "2026-06-29T00:00:00.000Z";

describe("LessonSessionBuilder", () => {
  it("emits validated lifecycle + step events with monotonic sequence", () => {
    const b = new LessonSessionBuilder({
      sessionId: "s1",
      lessonPacketId: "lp1",
      packetKpCodes: ["K1", "K2"],
      now: clock,
    });
    const started = b.start();
    const shown = b.showStep({ id: "step-a", type: "explanation" }, ["K1"]);
    const done = b.complete();

    // every envelope already passed SessionEvent.parse inside the builder;
    // re-parse to assert it is independently valid.
    for (const ev of [started, shown, done]) expect(() => SessionEvent.parse(ev)).not.toThrow();

    expect([started.sequence, shown.sequence, done.sequence]).toEqual([0, 1, 2]);
    expect(started.eventType).toBe("lesson_started");
    expect(started.payload).toBeNull(); // lifecycle event, no payload
    expect(done.payload).toBeNull();
  });

  it("freezes stepType + kpCodes on step_shown", () => {
    const b = new LessonSessionBuilder({ sessionId: "s1", packetKpCodes: ["P1"], now: clock });
    const shown = b.showStep({ id: "step-a", type: "worked_example" }, ["K9"]);
    expect(shown.eventType).toBe("step_shown");
    expect(shown.payload).toEqual({ stepType: "worked_example", kpCodes: ["K9"] });
  });

  it("falls back to packet kpCodes when a step carries none", () => {
    const b = new LessonSessionBuilder({ sessionId: "s1", packetKpCodes: ["P1", "P2"], now: clock });
    const shown = b.showStep({ id: "step-a", type: "explanation" });
    expect(shown.payload).toEqual({ stepType: "explanation", kpCodes: ["P1", "P2"] });
  });

  it("envelopes a grader payload on answer with a stable idempotencyKey", () => {
    const b = new LessonSessionBuilder({ sessionId: "s1", now: clock });
    const ev = b.answer("step-a", "question#C1:src:q1", {
      kind: "graded",
      gradingResult: { questionId: "question#C1:src:q1", score: 1, correct: true, modelCallId: null },
      resolvedKpCodes: ["K1"],
      modelCallId: null,
    });
    expect(ev.eventType).toBe("student_answered");
    expect(ev.idempotencyKey).toBe("s1:answer:step-a:question#C1:src:q1");
    expect(() => SessionEvent.parse(ev)).not.toThrow();
  });
});
