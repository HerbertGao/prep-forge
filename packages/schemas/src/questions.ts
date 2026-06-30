import { z } from "zod";
import { baseEntityFields, provenanceFields } from "./common";

// 题库 schemas（公共内容库）。

/**
 * 题目。自然键优先 course + src + questionId；
 * 缺失时退化为 stemHash + chapterNo + sequence（设计决策 2）。
 */
export const Question = z.object({
  ...baseEntityFields,
  courseCode: z.string().min(1),
  src: z.string().min(1),
  // All real snapshot questions carry a source questionId, so it stays required.
  // ponytail: making it optional + accepting the stemHash/chapterNo/sequence
  // fallback key is a future extension (needs the Drizzle column + migration too).
  questionId: z.string().min(1),
  // fallback 自然键字段
  stemHash: z.string().nullable().optional(),
  chapterNo: z.string().nullable().optional(),
  sequence: z.number().int().nonnegative().nullable().optional(),
  stem: z.string().min(1),
  type: z.string().min(1),
  ...provenanceFields,
});
export type Question = z.infer<typeof Question>;

/** 题目选项。 */
export const QuestionOption = z.object({
  ...baseEntityFields,
  questionId: z.string().min(1),
  label: z.string().min(1),
  content: z.string(),
  isCorrect: z.boolean().nullable().optional(),
  ...provenanceFields,
});
export type QuestionOption = z.infer<typeof QuestionOption>;

/** 官方答案与解析。 */
export const QuestionSolution = z.object({
  ...baseEntityFields,
  questionId: z.string().min(1),
  answer: z.string(),
  explanation: z.string().nullable().optional(),
  ...provenanceFields,
});
export type QuestionSolution = z.infer<typeof QuestionSolution>;

/** 题库统计。declaredCount 来自 stats.md，与 parsedCount 不一致时上层记 warning。 */
export const QuestionBankStats = z.object({
  ...baseEntityFields,
  courseCode: z.string().min(1),
  src: z.string().nullable().optional(),
  declaredCount: z.number().int().nonnegative().nullable().optional(),
  parsedCount: z.number().int().nonnegative().nullable().optional(),
  typeDistribution: z
    .array(z.object({ type: z.string().min(1), count: z.number().int().nonnegative() }))
    .optional(),
  ...provenanceFields,
});
export type QuestionBankStats = z.infer<typeof QuestionBankStats>;

/** 题目—知识点链接。 */
export const QuestionKpLink = z.object({
  ...baseEntityFields,
  questionId: z.string().min(1),
  courseCode: z.string().min(1),
  kpCode: z.string().min(1),
  ...provenanceFields,
});
export type QuestionKpLink = z.infer<typeof QuestionKpLink>;

/**
 * 客观题型允许清单（design "Apply 调查记录" task 1.1）：单选 3 个 Unicode 变体 + 多选；
 * 真实快照无判断题。共享单一事实来源——grader（判分）与 seed-packets（"≥1 客观题"校验）
 * 都从这里取，避免 db ↔ lesson-runtime 循环依赖。
 */
export const OBJECTIVE_QUESTION_TYPES: ReadonlySet<string> = new Set([
  "单选题", // U+5355 U+9009 U+9898
  "単選題", // 日文/繁体字 variant
  "单选題", // mixed variant
  "多选题",
]);
