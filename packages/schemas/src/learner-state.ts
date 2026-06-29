import { z } from "zod";
import { KpState, baseEntityFields, provenanceFields } from "./common";

// 个人学习状态 schemas（visibility = personal）。
// 稳定 ID 由所属课程/知识点自然键 + 来源块身份派生（设计决策 2）。

/** 学习者在某知识点上的掌握度状态（progress）。 */
export const LearnerKpState = z.object({
  ...baseEntityFields,
  learnerId: z.string().min(1),
  courseCode: z.string().min(1),
  kpCode: z.string().min(1),
  state: KpState,
  score: z.number().nullable().optional(),
  ...provenanceFields,
});
export type LearnerKpState = z.infer<typeof LearnerKpState>;

/**
 * 错题。必须能关联到课程或知识点（二者皆缺为 import error，故 schema 强制至少一项）。
 */
export const Mistake = z
  .object({
    ...baseEntityFields,
    learnerId: z.string().nullable().optional(),
    courseCode: z.string().nullable().optional(),
    kpCode: z.string().nullable().optional(),
    questionRef: z.string().nullable().optional(),
    category: z.string().nullable().optional(),
    note: z.string().nullable().optional(),
    ...provenanceFields,
  })
  .refine((m) => Boolean(m.courseCode) || Boolean(m.kpCode), {
    message: "错题必须关联到课程或知识点",
    path: ["kpCode"],
  });
export type Mistake = z.infer<typeof Mistake>;

/** 复习项。必须映射到知识点（无法映射的 review_queue 条目进 import_errors，不在此）。 */
export const ReviewItem = z.object({
  ...baseEntityFields,
  learnerId: z.string().nullable().optional(),
  courseCode: z.string().nullable().optional(),
  kpCode: z.string().min(1),
  dueDate: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  ...provenanceFields,
});
export type ReviewItem = z.infer<typeof ReviewItem>;

/** 学习计划时段。 */
export const StudyPlanSlot = z.object({
  subjectCode: z.string().nullable().optional(),
  kpCodes: z.array(z.string()).optional(),
  mode: z.string().nullable().optional(),
  estimatedMinutes: z.number().int().nonnegative().nullable().optional(),
  date: z.string().nullable().optional(),
});
export type StudyPlanSlot = z.infer<typeof StudyPlanSlot>;

/** 学习计划。 */
export const StudyPlan = z.object({
  ...baseEntityFields,
  learnerId: z.string().nullable().optional(),
  examTrack: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  slots: z.array(StudyPlanSlot).optional(),
  ...provenanceFields,
});
export type StudyPlan = z.infer<typeof StudyPlan>;

/** 每日学习日志条目。按日期 / source block 导入，不要求知识点映射。 */
export const DailyLogEntry = z.object({
  ...baseEntityFields,
  learnerId: z.string().nullable().optional(),
  date: z.string().min(1),
  content: z.string(),
  ...provenanceFields,
});
export type DailyLogEntry = z.infer<typeof DailyLogEntry>;
