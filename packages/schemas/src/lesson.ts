import { z } from "zod";
import {
  ActorType,
  LessonPacketStatus,
  SessionEventType,
  baseEntityFields,
  provenanceFields,
} from "./common";
import { GradingResult } from "./contracts";

// 学习体验 schemas（PRODUCT §6、§7，设计决策 3）。

/** 数学块（PRODUCT §7.1 formula_assets 的运行时形状）。课包内的值对象。 */
export const MathBlock = z.object({
  id: z.string().nullable().optional(),
  latex: z.string().min(1),
  displayMode: z.enum(["inline", "block"]),
  renderStatus: z.enum(["pending", "rendered", "failed"]).optional(),
  altText: z.string().nullable().optional(),
  html: z.string().nullable().optional(),
  svgUrl: z.string().nullable().optional(),
  pngUrl: z.string().nullable().optional(),
  contentHash: z.string().nullable().optional(),
});
export type MathBlock = z.infer<typeof MathBlock>;

/** 课包步骤（PRODUCT §6.3 步骤类型）。 */
export const LessonStep = z.object({
  id: z.string().min(1),
  type: z.enum([
    "diagnostic_question",
    "socratic_question",
    "explanation",
    "math_block",
    "worked_example",
    "practice",
    "hint",
    "summary",
    "review_prompt",
  ]),
  prompt: z.string().nullable().optional(),
  mdx: z.string().nullable().optional(),
  math: MathBlock.nullable().optional(),
  questionIds: z.array(z.string()).optional(),
});
export type LessonStep = z.infer<typeof LessonStep>;

/** 课包（PRODUCT §6）。首版由系统/fixture 提供，origin 通常为 system。 */
export const LessonPacket = z.object({
  ...baseEntityFields,
  version: z.number().int().positive(),
  status: LessonPacketStatus,
  subjectCode: z.string().nullable().optional(),
  courseCode: z.string().nullable().optional(),
  title: z.string().min(1),
  kpCodes: z.array(z.string()),
  prerequisites: z.array(z.string()).optional(),
  estimatedMinutes: z.number().int().nonnegative().nullable().optional(),
  difficulty: z.string().nullable().optional(),
  objectives: z.array(z.string()).optional(),
  steps: z.array(LessonStep),
  ...provenanceFields,
});
export type LessonPacket = z.infer<typeof LessonPacket>;

// --- SessionEvent payload variants (设计决策 2 / D2) ---
// applier reads ONLY the payload, never the live question bank, so each variant
// freezes what the applier needs. Kept as a z.union (NOT a top-level
// discriminatedUnion) so SessionEvent stays a z.object and survives the parity
// test's `.shape` access; eventType↔payload correspondence is pinned by the
// .superRefine below, and lesson_started/lesson_completed allow no payload.

/** step_shown：冻结该步 stepType（让 applier 区分讲解/练习步）+ 覆盖的 kpCodes。 */
export const StepShownPayload = z.object({
  stepType: LessonStep.shape.type,
  kpCodes: z.array(z.string()),
});
export type StepShownPayload = z.infer<typeof StepShownPayload>;

/** student_answered（客观题判分）：自带 GradingResult，applier 不回读题库。 */
export const GradedAnswerPayload = z.object({
  kind: z.literal("graded"),
  gradingResult: GradingResult,
  resolvedKpCodes: z.array(z.string()),
  modelCallId: z.null(),
});
export type GradedAnswerPayload = z.infer<typeof GradedAnswerPayload>;

/** student_answered（主观/未知题型）：不判分、不编造 score。 */
export const UngradedAnswerPayload = z.object({
  kind: z.literal("ungraded"),
  reason: z.string(),
  resolvedKpCodes: z.array(z.string()),
});
export type UngradedAnswerPayload = z.infer<typeof UngradedAnswerPayload>;

export const SessionEventPayload = z.union([
  StepShownPayload,
  GradedAnswerPayload,
  UngradedAnswerPayload,
]);
export type SessionEventPayload = z.infer<typeof SessionEventPayload>;

/**
 * Session event 稳定信封（设计决策 3）。Phase 0 只记录 local/demo 事件，
 * 但信封字段必须先定型，供 Phase 1 事件重放一致性直接基于 Phase 0 数据验证。
 * tenantId 预留（demo 可填占位值，不应用任何派生）。
 */
export const SessionEvent = z
  .object({
    id: z.string().min(1),
    // session identity the table's unique(session_id, sequence|idempotency_key)
    // constraints are scoped by. enrollmentId reserved for Phase 1 (nullable now).
    sessionId: z.string().min(1),
    enrollmentId: z.string().nullable().optional(),
    eventType: SessionEventType,
    eventVersion: z.number().int().positive(),
    sequence: z.number().int().nonnegative(),
    actorType: ActorType,
    idempotencyKey: z.string().min(1),
    // Producers pass new Date().toISOString(); reject malformed timestamps at the
    // envelope boundary instead of at the DB/replay layer.
    occurredAt: z.iso.datetime(),
    tenantId: z.string().nullable().optional(),
    lessonPacketId: z.string().nullable().optional(),
    stepId: z.string().nullable().optional(),
    // payload stays optional+nullable: lesson_started/lesson_completed carry none.
    payload: SessionEventPayload.optional().nullable(),
  })
  .superRefine((evt, ctx) => {
    // step_shown / student_answered require payload; lifecycle events must not
    // carry one, while still allowing absent/null payload fixtures.
    if (evt.eventType === "step_shown") {
      if (!StepShownPayload.safeParse(evt.payload).success) {
        ctx.addIssue({
          code: "custom",
          path: ["payload"],
          message: "step_shown payload must be { stepType, kpCodes }",
        });
      }
    } else if (evt.eventType === "student_answered") {
      const ok =
        GradedAnswerPayload.safeParse(evt.payload).success ||
        UngradedAnswerPayload.safeParse(evt.payload).success;
      if (!ok) {
        ctx.addIssue({
          code: "custom",
          path: ["payload"],
          message: "student_answered payload must be a graded|ungraded variant",
        });
      }
    } else if (evt.payload != null) {
      ctx.addIssue({
        code: "custom",
        path: ["payload"],
        message: "lesson lifecycle events must not carry payload",
      });
    }
  });
export type SessionEvent = z.infer<typeof SessionEvent>;
