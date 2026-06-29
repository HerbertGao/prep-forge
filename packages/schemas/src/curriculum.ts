import { z } from "zod";
import { CourseExamStatus, baseEntityFields, provenanceFields } from "./common";

// 课程结构 schemas（公共内容库）。自然键见设计决策 2。

/** 考试轨道（exam_track，如 "2026-10"）。自然键 = examTrack。 */
export const ExamTrack = z.object({
  ...baseEntityFields,
  examTrack: z.string().min(1),
  title: z.string().nullable().optional(),
  examDate: z.string().nullable().optional(),
  ...provenanceFields,
});
export type ExamTrack = z.infer<typeof ExamTrack>;

/**
 * 课程（由 exam_plan.md 考试代码表派生）。自然键 = courseCode。
 * examStatus 取真实状态，slug 不在代码表时给 provisional code + unmapped。
 */
export const Course = z.object({
  ...baseEntityFields,
  courseCode: z.string().min(1),
  slug: z.string().nullable().optional(),
  name: z.string().min(1),
  examTrack: z.string().nullable().optional(),
  examStatus: CourseExamStatus,
  ...provenanceFields,
});
export type Course = z.infer<typeof Course>;

/** 学科（slug 维度视图）。自然键 = subjectCode（slug），通过 courseCode 关联课程。 */
export const Subject = z.object({
  ...baseEntityFields,
  subjectCode: z.string().min(1),
  courseCode: z.string().nullable().optional(),
  name: z.string().min(1),
  examTrack: z.string().nullable().optional(),
  ...provenanceFields,
});
export type Subject = z.infer<typeof Subject>;

/** 章节。自然键 = courseCode + chapterNo。 */
export const Chapter = z.object({
  ...baseEntityFields,
  courseCode: z.string().min(1),
  chapterNo: z.string().min(1),
  title: z.string().min(1),
  ...provenanceFields,
});
export type Chapter = z.infer<typeof Chapter>;

/**
 * 知识点目录条目（公共）。自然键 = courseCode + kpCode。
 * 每个学习者的掌握度状态见 LearnerKpState，不在目录对象上。
 */
export const KnowledgePoint = z.object({
  ...baseEntityFields,
  courseCode: z.string().min(1),
  kpCode: z.string().min(1),
  title: z.string().min(1),
  chapterNo: z.string().nullable().optional(),
  examFrequency: z.string().nullable().optional(),
  ...provenanceFields,
});
export type KnowledgePoint = z.infer<typeof KnowledgePoint>;

/** 学习者画像（个人）。自然键 = learnerId。 */
export const LearnerProfile = z.object({
  ...baseEntityFields,
  learnerId: z.string().min(1),
  displayName: z.string().nullable().optional(),
  examTrack: z.string().nullable().optional(),
  preferences: z.unknown().optional(),
  ...provenanceFields,
});
export type LearnerProfile = z.infer<typeof LearnerProfile>;
