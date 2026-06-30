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
  // 薄主干语义 = 「无禁止公式」（step.math == null）；KaTeX 桥上线后（Phase 2.x）才转为
  // 「渲染成功」。净化门已删（mdx/prompt 自动转义、无 sink），故不加第 4 个净化布尔（D1/D5）。
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
  // Phase 2 (D1): 关联 prep job（grading 等调用无 job → nullable FK）；cost_basis 为 text 列，
  // 取值 metered | subscription_amortized（订阅经 Claude CLI，记 API-等价摊销成本，见 D6）。
  prepJobId: z.string().nullable().optional(),
  costBasis: z.string().min(1).nullable().optional(),
  promptVersion: z.string().nullable().optional(),
  requestHash: z.string().nullable().optional(),
});
export type ModelCall = z.infer<typeof ModelCall>;

/** prep job 生命周期（Phase 2 D3）：全程由 BFF 写，worker 禁读/写。不含 ready。 */
export const PrepJobStatus = z.enum([
  "pending",
  "running",
  "validating",
  "done",
  "failed",
]);
export type PrepJobStatus = z.infer<typeof PrepJobStatus>;

/**
 * prep_jobs 行（DB-row 契约，Phase 2 D3）。无 transport 字段。
 * 活跃去重靠 (kpCode, promptVersion) 部分唯一索引；attemptCount 持久化跨请求兜超时（D4）；
 * idempotencyKey 为非唯一审计列。
 */
export const PrepJobRecord = z.object({
  id: z.string().min(1),
  status: PrepJobStatus,
  kpCode: z.string().min(1),
  promptVersion: z.string().min(1),
  idempotencyKey: z.string().min(1),
  attemptCount: z.number().int().nonnegative(),
  failureReason: z.string().nullable().optional(),
  lessonPacketId: z.string().nullable().optional(),
  createdAt: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
});
export type PrepJobRecord = z.infer<typeof PrepJobRecord>;
