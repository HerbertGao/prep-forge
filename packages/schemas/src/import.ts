import { z } from "zod";
import { baseEntityFields } from "./common";

// Legacy import provenance schemas (设计决策 2，PRODUCT §8.0)。
// 来源块稳定身份 = sourcePath + headingPath + normalizedKey；content_hash 仅作变化检测。

/** 行号范围。 */
export const LineRange = z.object({
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
});
export type LineRange = z.infer<typeof LineRange>;

/** 一次导入批次（import_runs）。 */
export const ImportRun = z.object({
  id: z.string().min(1),
  sourceRepo: z.string().nullable().optional(),
  sourceRef: z.string().nullable().optional(),
  sourceRootPath: z.string().min(1),
  dryRun: z.boolean(),
  status: z.enum(["running", "completed", "failed"]),
  startedAt: z.string().min(1),
  finishedAt: z.string().nullable().optional(),
});
export type ImportRun = z.infer<typeof ImportRun>;

/** 扫描到的源文件（source_documents）。无 parser 的文件记 status=unsupported。 */
export const SourceDocument = z.object({
  id: z.string().min(1),
  importRunId: z.string().min(1),
  sourcePath: z.string().min(1),
  sourceRepo: z.string().nullable().optional(),
  sourceRef: z.string().nullable().optional(),
  status: z.enum(["parsed", "unsupported", "skipped", "error"]),
  contentHash: z.string().nullable().optional(),
});
export type SourceDocument = z.infer<typeof SourceDocument>;

/** 源内容块（source_blocks）。稳定身份三件套见下；contentHash 仅作变化检测。 */
export const SourceBlock = z.object({
  id: z.string().min(1),
  importRunId: z.string().min(1),
  sourceDocumentId: z.string().min(1),
  // --- 稳定自然键 ---
  sourcePath: z.string().min(1),
  headingPath: z.array(z.string()),
  normalizedKey: z.string().min(1),
  // --- 内容与位置 ---
  lineRange: LineRange,
  rawBlock: z.string(),
  contentHash: z.string().min(1),
  sourceRepo: z.string().nullable().optional(),
  sourceRef: z.string().nullable().optional(),
});
export type SourceBlock = z.infer<typeof SourceBlock>;

/** Staging 实体（imported_entities）：包裹一个候选领域实体，带 origin + 公共/个人分类。 */
export const ImportedEntity = z.object({
  ...baseEntityFields,
  importRunId: z.string().min(1),
  sourceBlockId: z.string().min(1),
  entityType: z.string().min(1),
  // 该实体的稳定自然键字符串（如 course_code、course+src+id），用于幂等去重。
  naturalKey: z.string().min(1),
  contentHash: z.string().min(1),
  status: z.enum(["staged", "published", "quarantine", "error"]),
  // 结构化候选 payload，由对应领域 schema 单独校验，这里不耦合具体形状。
  payload: z.unknown().optional(),
});
export type ImportedEntity = z.infer<typeof ImportedEntity>;

/** 导入错误 / 警告 / quarantine（import_errors）。severity 区分三态。 */
export const ImportError = z.object({
  id: z.string().min(1),
  importRunId: z.string().min(1),
  sourceDocumentId: z.string().nullable().optional(),
  sourceBlockId: z.string().nullable().optional(),
  sourcePath: z.string().nullable().optional(),
  headingPath: z.array(z.string()).optional(),
  rawBlock: z.string().nullable().optional(),
  severity: z.enum(["error", "warning", "quarantine"]),
  kind: z.string().min(1),
  message: z.string().min(1),
});
export type ImportError = z.infer<typeof ImportError>;

/** 导入报告（task 4.8 统计口径）。 */
export const ImportReport = z.object({
  id: z.string().min(1),
  importRunId: z.string().min(1),
  generatedAt: z.string().min(1),
  dryRun: z.boolean(),
  counts: z.object({
    scanned: z.number().int().nonnegative(),
    parsed: z.number().int().nonnegative(),
    created: z.number().int().nonnegative(),
    updated: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    quarantined: z.number().int().nonnegative(),
    warnings: z.number().int().nonnegative(),
  }),
  warnings: z.array(z.string()).optional(),
});
export type ImportReport = z.infer<typeof ImportReport>;
