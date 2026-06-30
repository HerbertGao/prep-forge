import { z } from "zod";
import { LessonPacket } from "./lesson";

// Phase 2 AI 内容加工的 transport 信封 + provenance 契约（D1/D9）。
// 注：放在独立文件而非 contracts.ts —— PrepGenerateResult 内嵌 LessonPacket，而 lesson.ts
// 已 import contracts.ts；若 contracts.ts 反向 import lesson.ts 会形成模块求值期循环。
// 信封类（PrepGenerate*）是 transport，**不进** schema.parity PAIRS（D1）。

/**
 * AI 生成内容的结构化来源（D9）。仅作审计，确认依据由门取实际解析（不取本字段）。
 * 删 kp/role/daily_log（薄主干 scope）；无 superRefine（z.toJSONSchema 会静默丢弃）。
 */
export const GenerationSource = z.object({
  sourceType: z.enum(["question", "question_solution"]),
  sourceId: z.string().min(1),
  modelCallIds: z.array(z.string()),
  promptVersion: z.string().min(1),
});
export type GenerationSource = z.infer<typeof GenerationSource>;

// schemaVersion 固定为本版本字面量，跨语言信封不一致即在 parse 期暴露（Phase 2.x 升版改字面量）。
// tenantId 为单租户常量（值由部署侧固定传入，schema 只要求非空，沿用 SessionEvent 的预留约定）。
const ENVELOPE_VERSION = z.literal("1");
const tenantId = z.string().min(1);

/** BFF → worker 的生成请求信封（D3 步 2：POST /v1/prep/generate {jobId, kpCode}）。 */
export const PrepGenerateRequest = z.object({
  schemaVersion: ENVELOPE_VERSION,
  tenantId,
  jobId: z.string().min(1),
  kpCode: z.string().min(1),
});
export type PrepGenerateRequest = z.infer<typeof PrepGenerateRequest>;

/**
 * worker → BFF 的生成结果信封（单态：成功一种形状，失败走 HTTP 层）。
 * BFF 对本信封的 parse 是独立的 transport 存活检查；门输入另从 DB 重建（D3）。
 */
export const PrepGenerateResult = z.object({
  schemaVersion: ENVELOPE_VERSION,
  tenantId,
  jobId: z.string().min(1),
  lessonPacket: LessonPacket,
  generationSources: z.array(GenerationSource),
});
export type PrepGenerateResult = z.infer<typeof PrepGenerateResult>;
