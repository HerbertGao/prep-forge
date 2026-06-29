import { z } from "zod";

// 契约占位 schemas（Phase 0 只定义类型与校验，不接真实运行时）。
// 字段参考 PRODUCT §4.2 / §6.2 / §9.1。

/** 批改结果（PRODUCT §4.2 graded 事件）。 */
export const GradingResult = z.object({
  id: z.string().nullable().optional(),
  questionId: z.string().min(1),
  kpCode: z.string().nullable().optional(),
  score: z.number().min(0).max(1),
  correct: z.boolean().nullable().optional(),
  errorCategory: z.string().nullable().optional(),
  feedback: z.string().nullable().optional(),
  modelCallId: z.string().nullable().optional(),
});
export type GradingResult = z.infer<typeof GradingResult>;

/** 质量门禁结果（PRODUCT §5.6 / §6.2 quality）。 */
export const QualityGateResult = z.object({
  id: z.string().nullable().optional(),
  lessonPacketId: z.string().nullable().optional(),
  schemaPassed: z.boolean(),
  mathRenderPassed: z.boolean(),
  questionRefsPassed: z.boolean(),
  score: z.number().min(0).max(1).nullable().optional(),
  passed: z.boolean(),
  issues: z.array(z.string()).optional(),
});
export type QualityGateResult = z.infer<typeof QualityGateResult>;

/** 模型调用日志（PRODUCT §9.1 model_calls）。商业 AI 产品必须从一开始追踪成本。 */
export const ModelCall = z.object({
  id: z.string().min(1),
  provider: z.string().min(1),
  model: z.string().min(1),
  taskType: z.string().min(1),
  userId: z.string().nullable().optional(),
  lessonPacketId: z.string().nullable().optional(),
  inputTokens: z.number().int().nonnegative().nullable().optional(),
  outputTokens: z.number().int().nonnegative().nullable().optional(),
  estimatedCost: z.number().nonnegative().nullable().optional(),
  latencyMs: z.number().int().nonnegative().nullable().optional(),
  status: z.string().min(1),
  errorMessage: z.string().nullable().optional(),
  createdAt: z.string().nullable().optional(),
});
export type ModelCall = z.infer<typeof ModelCall>;
