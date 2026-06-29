import { z } from "zod";

// --- Shared enums (design 决策 4) ---

/** 数据来源类型：人工导入 / 系统生成 / AI 生成。 */
export const Origin = z.enum(["imported", "system", "ai_generated"]);
export type Origin = z.infer<typeof Origin>;

/** 公共内容库 vs 个人学习状态（4.7 实体级分类）。 */
export const Visibility = z.enum(["public", "personal"]);
export type Visibility = z.infer<typeof Visibility>;

/** 课程在考期内的真实状态（来自 exam_plan.md / 历史已通过清单）。 */
export const CourseExamStatus = z.enum([
  "未开始",
  "缺考",
  "重考",
  "在考",
  "已通过",
  "unmapped",
]);
export type CourseExamStatus = z.infer<typeof CourseExamStatus>;

/** 知识点掌握度状态机（PRODUCT §4.1）。 */
export const KpState = z.enum(["unseen", "taught", "practiced", "mastered"]);
export type KpState = z.infer<typeof KpState>;

/** 课包生命周期（PRODUCT §6.1）。 */
export const LessonPacketStatus = z.enum([
  "draft",
  "ready",
  "consumed",
  "quarantine",
]);
export type LessonPacketStatus = z.infer<typeof LessonPacketStatus>;

/** Phase 0 课堂骨架记录的 local/demo 事件类型（设计决策 7）。 */
export const SessionEventType = z.enum([
  "lesson_started",
  "step_shown",
  "student_answered",
  "lesson_completed",
]);
export type SessionEventType = z.infer<typeof SessionEventType>;

// ponytail: 三个值覆盖 Phase 0 课堂骨架；接入真实 agent 时再扩枚举。
/** session event 的行为主体类型。 */
export const ActorType = z.enum(["student", "system", "tutor"]);
export type ActorType = z.infer<typeof ActorType>;

// --- Reusable field bags (spread into z.object, not an abstraction) ---

/** 每个领域对象都带稳定 id、origin 和 public/personal 标记（设计决策 4）。 */
export const baseEntityFields = {
  id: z.string().min(1),
  origin: Origin,
  visibility: Visibility,
};

/**
 * 来源追踪链：导入实体回指产生它的 source block + content hash。
 * 系统/AI 生成对象无 source block，故可空。
 */
export const provenanceFields = {
  sourceBlockId: z.string().min(1).nullable().optional(),
  contentHash: z.string().min(1).nullable().optional(),
};
