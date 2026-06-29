// Minimal local/test fixture — NOT an acceptance source.
//
// Phase 0 acceptance requires dashboard data to come from the legacy import
// published into PostgreSQL (traceable to import run / source block). This
// fixture only lets the UI render (and `next build`) when no DB is reachable.
// Every row has sourceBlockId=null on purpose: fixture data is not traceable
// and the UI labels it as such (see SourceBanner).
import type { Course } from "@prep-forge/schemas";
import type { RawSeed } from "./types";

const sys = { origin: "imported" as const, sourceBlockId: null, contentHash: null };
// ponytail: fixture marks rows origin="imported" to mirror real seed shape, but
// the UI banner makes clear the *source* is fixture, not a real import.

function course(
  courseCode: string,
  name: string,
  examStatus: Course["examStatus"],
  examTrack: string | null,
): Course {
  return {
    id: `course:${courseCode}`,
    visibility: "public",
    courseCode,
    slug: null,
    name,
    examTrack,
    examStatus,
    ...sys,
  };
}

const courses: Course[] = [
  course("00023", "高等数学（工本）", "在考", "2026-10"),
  course("02324", "离散数学", "在考", "2026-10"),
  course("13180", "操作系统", "在考", "2026-10"),
  course("13015", "计算机系统原理", "重考", "2026-10"),
  course("15044", "马克思主义基本原理", "已通过", "2026-04"),
  course("03708", "中国近现代史纲要", "已通过", null),
  course("00015", "英语（二）", "已通过", null),
  course("00840", "第二外语（日语）", "未开始", "2027-10"),
];

// 离散数学 (02324) — 30 KP total, matches fixture progress.md (1 mastered).
const dmChapters = [
  { chapterNo: "01", title: "数理逻辑" },
  { chapterNo: "02", title: "集合论" },
  { chapterNo: "03", title: "图论" },
];
const dmKps = [
  { kpCode: "DM01-01", title: "命题与命题联结词", chapterNo: "01", examFrequency: "★★★", state: "mastered" as const },
  { kpCode: "DM01-02", title: "命题公式的等值演算", chapterNo: "01", examFrequency: "★★★", state: "taught" as const },
  { kpCode: "DM01-03", title: "范式", chapterNo: "01", examFrequency: "★★", state: "practiced" as const },
  { kpCode: "DM02-01", title: "集合的基本概念", chapterNo: "02", examFrequency: "★★", state: "unseen" as const },
  { kpCode: "DM02-02", title: "关系与映射", chapterNo: "02", examFrequency: "★★★", state: "unseen" as const },
  { kpCode: "DM03-01", title: "图的基本概念", chapterNo: "03", examFrequency: "★★", state: "unseen" as const },
];

const knowledgePoints = dmKps.map((k) => ({
  id: `kp:02324:${k.kpCode}`,
  visibility: "public" as const,
  courseCode: "02324",
  kpCode: k.kpCode,
  title: k.title,
  chapterNo: k.chapterNo,
  examFrequency: k.examFrequency,
  ...sys,
}));

const learnerKpStates = dmKps
  .filter((k) => k.state !== "unseen")
  .map((k) => ({
    id: `lkp:learner-1:02324:${k.kpCode}`,
    visibility: "personal" as const,
    learnerId: "learner-1",
    courseCode: "02324",
    kpCode: k.kpCode,
    state: k.state,
    score: null,
    ...sys,
  }));

export const FIXTURE: RawSeed = {
  examTracks: [
    {
      id: "track:2026-10",
      visibility: "public",
      examTrack: "2026-10",
      title: "2026 年 10 月自考",
      examDate: "2026-10-24",
      ...sys,
    },
  ],
  courses,
  chapters: dmChapters.map((c) => ({
    id: `ch:02324:${c.chapterNo}`,
    visibility: "public" as const,
    courseCode: "02324",
    chapterNo: c.chapterNo,
    title: c.title,
    ...sys,
  })),
  knowledgePoints,
  learnerKpStates,
  mistakes: [
    {
      id: "mistake:1",
      visibility: "personal",
      learnerId: "learner-1",
      courseCode: "02324",
      kpCode: "DM01-02",
      questionRef: "Q-DM01-012",
      category: "concept_confusion",
      note: "等值演算与永真式混淆",
      ...sys,
    },
    {
      id: "mistake:2",
      visibility: "personal",
      learnerId: "learner-1",
      courseCode: "00023",
      kpCode: null,
      questionRef: "Q-AM02-044",
      category: "calculation",
      note: "偏导计算符号错误",
      ...sys,
    },
  ],
  reviewItems: [
    {
      id: "review:1",
      visibility: "personal",
      learnerId: "learner-1",
      courseCode: "02324",
      kpCode: "DM01-01",
      dueDate: "2026-01-02",
      status: "due",
      ...sys,
    },
    {
      id: "review:2",
      visibility: "personal",
      learnerId: "learner-1",
      courseCode: "02324",
      kpCode: "DM01-03",
      dueDate: "2026-07-05",
      status: "due",
      ...sys,
    },
  ],
  dailyLogs: [
    {
      id: "daily:fixture-1",
      visibility: "personal",
      learnerId: "learner-1",
      date: "2026-06-28",
      content: "复习离散数学命题逻辑，做了 10 道选择题，错 2。",
      ...sys,
    },
  ],
  questionBankStats: [
    {
      id: "stats:02324",
      visibility: "public",
      courseCode: "02324",
      src: "question_bank",
      declaredCount: 120,
      parsedCount: 118,
      typeDistribution: [
        { type: "选择题", count: 40 },
        { type: "判断题", count: 30 },
        { type: "计算题", count: 48 },
      ],
      ...sys,
    },
  ],
  questionKpLinks: [
    { id: "qkp:1", visibility: "public", questionId: "Q-DM01-012", courseCode: "02324", kpCode: "DM01-01", ...sys },
    { id: "qkp:2", visibility: "public", questionId: "Q-DM01-013", courseCode: "02324", kpCode: "DM01-02", ...sys },
    { id: "qkp:3", visibility: "public", questionId: "Q-DM01-021", courseCode: "02324", kpCode: "DM01-03", ...sys },
  ],
  questions: [],
  warnings: [
    {
      kind: "progress_drift",
      message: "离散数学(02324) 完成数：dashboard.md 记 0 掌握，progress.md 记 1 已掌握。",
      authoritative: "progress.md → 1",
    },
    {
      kind: "exam_date_conflict",
      message: "计算机系统原理(13015) 考试日期：dashboard.md 10/25，exam_plan.md 2026-10-25。",
      authoritative: "exam_plan.md → 2026-10-25",
    },
    {
      kind: "stats_mismatch",
      message: "离散数学(02324) stats.md 声称 120 题，实际解析 118 题。",
      authoritative: "实际解析 → 118",
    },
  ],
};
