import { z } from "zod";
import {
  ActorType,
  LessonPacketStatus,
  SessionEventType,
  baseEntityFields,
  provenanceFields,
} from "./common";

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

/**
 * Session event 稳定信封（设计决策 3）。Phase 0 只记录 local/demo 事件，
 * 但信封字段必须先定型，供 Phase 1 事件重放一致性直接基于 Phase 0 数据验证。
 * tenantId 预留（demo 可填占位值，不应用任何派生）。
 */
export const SessionEvent = z.object({
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
  occurredAt: z.string().min(1),
  tenantId: z.string().nullable().optional(),
  lessonPacketId: z.string().nullable().optional(),
  stepId: z.string().nullable().optional(),
  payload: z.unknown().optional(),
});
export type SessionEvent = z.infer<typeof SessionEvent>;
