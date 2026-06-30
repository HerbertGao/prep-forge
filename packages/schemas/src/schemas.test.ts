import { describe, it, expect } from "vitest";
import {
  SourceBlock,
  Course,
  Question,
  KnowledgePoint,
  SessionEvent,
  LessonPacket,
  Mistake,
} from "./index";

// 聚焦单元测试（task 2.8）：每个核心 schema 覆盖有效数据、缺字段、类型错误。

describe("SourceBlock", () => {
  const valid = {
    id: "sb-1",
    importRunId: "run-1",
    sourceDocumentId: "doc-1",
    sourcePath: "teacher/subjects/advanced_math/syllabus.md",
    headingPath: ["第二章", "偏导数"],
    normalizedKey: "row-3",
    lineRange: { start: 10, end: 20 },
    rawBlock: "| AM02-03 | 偏导数 |",
    contentHash: "abc123",
  };

  it("accepts a valid block", () => {
    expect(SourceBlock.safeParse(valid).success).toBe(true);
  });

  it("rejects missing normalizedKey (stable identity field)", () => {
    const { normalizedKey, ...rest } = valid;
    expect(SourceBlock.safeParse(rest).success).toBe(false);
  });

  it("rejects wrong-typed headingPath", () => {
    expect(SourceBlock.safeParse({ ...valid, headingPath: "第二章" }).success).toBe(false);
  });
});

describe("Course", () => {
  const valid = {
    id: "course-00023",
    origin: "imported" as const,
    visibility: "public" as const,
    courseCode: "00023",
    name: "高等数学（工本）",
    examStatus: "在考" as const,
  };

  it("accepts a valid course", () => {
    expect(Course.safeParse(valid).success).toBe(true);
  });

  it("rejects missing courseCode (natural key)", () => {
    const { courseCode, ...rest } = valid;
    expect(Course.safeParse(rest).success).toBe(false);
  });

  it("rejects examStatus outside the enum", () => {
    expect(Course.safeParse({ ...valid, examStatus: "pending" }).success).toBe(false);
  });
});

describe("Question", () => {
  const valid = {
    id: "q-1",
    origin: "imported" as const,
    visibility: "public" as const,
    courseCode: "00023",
    src: "chapter_3",
    questionId: "Q-31",
    stem: "求偏导数",
    type: "single_choice",
  };

  it("accepts a valid question", () => {
    expect(Question.safeParse(valid).success).toBe(true);
  });

  it("rejects missing src (part of course+src+id natural key)", () => {
    const { src, ...rest } = valid;
    expect(Question.safeParse(rest).success).toBe(false);
  });

  it("rejects non-integer sequence fallback key", () => {
    expect(Question.safeParse({ ...valid, sequence: 1.5 }).success).toBe(false);
  });
});

describe("KnowledgePoint", () => {
  const valid = {
    id: "kp-1",
    origin: "imported" as const,
    visibility: "public" as const,
    courseCode: "00023",
    kpCode: "AM02-03",
    title: "偏导数的定义",
  };

  it("accepts a valid knowledge point", () => {
    expect(KnowledgePoint.safeParse(valid).success).toBe(true);
  });

  it("rejects missing kpCode (natural key)", () => {
    const { kpCode, ...rest } = valid;
    expect(KnowledgePoint.safeParse(rest).success).toBe(false);
  });

  it("rejects wrong-typed courseCode", () => {
    expect(KnowledgePoint.safeParse({ ...valid, courseCode: 23 }).success).toBe(false);
  });
});

describe("SessionEvent", () => {
  const valid = {
    id: "evt-1",
    sessionId: "sess-1",
    eventType: "lesson_started" as const,
    eventVersion: 1,
    sequence: 0,
    actorType: "student" as const,
    idempotencyKey: "idem-1",
    occurredAt: "2026-06-29T10:00:00Z",
  };

  it("accepts a valid envelope (tenantId reserved/optional)", () => {
    expect(SessionEvent.safeParse(valid).success).toBe(true);
  });

  it("rejects missing sessionId (envelope field)", () => {
    const { sessionId, ...rest } = valid;
    expect(SessionEvent.safeParse(rest).success).toBe(false);
  });

  it("rejects missing idempotencyKey (envelope field)", () => {
    const { idempotencyKey, ...rest } = valid;
    expect(SessionEvent.safeParse(rest).success).toBe(false);
  });

  it("rejects eventType outside the spec set", () => {
    expect(SessionEvent.safeParse({ ...valid, eventType: "graded" }).success).toBe(false);
  });

  it("accepts lesson_started / lesson_completed with NO payload", () => {
    // D2: lifecycle events legitimately carry no payload.
    expect(SessionEvent.safeParse(valid).success).toBe(true);
    expect(
      SessionEvent.safeParse({ ...valid, eventType: "lesson_completed" }).success,
    ).toBe(true);
  });

  it("rejects lesson lifecycle events with a payload", () => {
    const payload = { stepType: "explanation", kpCodes: ["AM02-03"] };
    expect(SessionEvent.safeParse({ ...valid, payload }).success).toBe(false);
    expect(
      SessionEvent.safeParse({ ...valid, eventType: "lesson_completed", payload }).success,
    ).toBe(false);
  });

  it("accepts step_shown with a { stepType, kpCodes } payload", () => {
    const evt = {
      ...valid,
      eventType: "step_shown" as const,
      payload: { stepType: "explanation", kpCodes: ["AM02-03"] },
    };
    expect(SessionEvent.safeParse(evt).success).toBe(true);
  });

  it("rejects step_shown whose payload is missing stepType", () => {
    const evt = { ...valid, eventType: "step_shown" as const, payload: { kpCodes: [] } };
    expect(SessionEvent.safeParse(evt).success).toBe(false);
  });

  it("accepts student_answered graded variant (gradingResult + modelCallId:null)", () => {
    const evt = {
      ...valid,
      eventType: "student_answered" as const,
      actorType: "student" as const,
      payload: {
        kind: "graded",
        gradingResult: { questionId: "q-1", score: 1, correct: true },
        resolvedKpCodes: ["AM02-03"],
        modelCallId: null,
      },
    };
    expect(SessionEvent.safeParse(evt).success).toBe(true);
  });

  it("accepts student_answered ungraded variant (reason, no score)", () => {
    const evt = {
      ...valid,
      eventType: "student_answered" as const,
      payload: { kind: "ungraded", reason: "subjective", resolvedKpCodes: ["AM02-03"] },
    };
    expect(SessionEvent.safeParse(evt).success).toBe(true);
  });

  it("rejects student_answered with a step_shown-shaped payload", () => {
    const evt = {
      ...valid,
      eventType: "student_answered" as const,
      payload: { stepType: "explanation", kpCodes: [] },
    };
    expect(SessionEvent.safeParse(evt).success).toBe(false);
  });
});

describe("LessonPacket", () => {
  const valid = {
    id: "LP-AM02-03-001",
    origin: "system" as const,
    visibility: "public" as const,
    version: 1,
    status: "ready" as const,
    title: "偏导数的定义与基本计算",
    kpCodes: ["AM02-03"],
    steps: [{ id: "diagnostic-001", type: "diagnostic_question", prompt: "?" }],
  };

  it("accepts a valid packet", () => {
    expect(LessonPacket.safeParse(valid).success).toBe(true);
  });

  it("rejects status outside draft|ready|consumed|quarantine", () => {
    expect(LessonPacket.safeParse({ ...valid, status: "archived" }).success).toBe(false);
  });

  it("rejects non-integer version", () => {
    expect(LessonPacket.safeParse({ ...valid, version: 0 }).success).toBe(false);
  });
});

describe("Mistake (personal state, must link course or kp)", () => {
  const valid = {
    id: "m-1",
    origin: "imported" as const,
    visibility: "personal" as const,
    kpCode: "AM02-03",
    category: "concept_confusion",
  };

  it("accepts a mistake linked to a knowledge point", () => {
    expect(Mistake.safeParse(valid).success).toBe(true);
  });

  it("rejects a mistake with neither course nor kp", () => {
    const { kpCode, ...rest } = valid;
    expect(Mistake.safeParse(rest).success).toBe(false);
  });

  it("rejects wrong-typed visibility", () => {
    expect(Mistake.safeParse({ ...valid, visibility: "private" }).success).toBe(false);
  });
});
