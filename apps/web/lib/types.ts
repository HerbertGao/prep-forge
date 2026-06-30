// View-model + raw-seed types shared by the seed loader, fixture and pages.
// Kept separate so fixture.ts and seed.ts can both import without a value cycle.
import type {
  Chapter,
  Course,
  DailyLogEntry,
  ExamTrack,
  KnowledgePoint,
  LearnerKpState,
  Mistake,
  Question,
  QuestionBankStats,
  QuestionKpLink,
  ReviewItem,
} from "@prep-forge/schemas";

/** Where the rendered numbers come from. Only "db" is acceptance-grade. */
export type SeedSource = "db" | "fixture";

/**
 * A cross-file consistency conflict surfaced on the dashboard. In DB mode these
 * come from the importer's `import_errors` (severity=warning, task 4.11); in
 * fixture mode they are illustrative. `authoritative` names the source we took
 * the value from (progress.md for counts, exam_plan.md for dates).
 */
export type ConflictWarning = {
  kind: string;
  message: string;
  authoritative?: string;
};

/**
 * Phase 1 additive audit columns (design D11/D12) are drizzle-only and absent
 * from the Zod types, but `db.select()` returns them — surface them here so the
 * read-side merge + today-gating can read admin_confirmed_at / last_applied_at.
 * Optional so the fixture (which omits them) still satisfies the type.
 */
export type ReviewItemRow = ReviewItem & {
  adminConfirmedAt?: Date | null;
  lastAppliedAt?: Date | null;
  lastAppliedSessionId?: string | null;
  lastAppliedSequence?: number | null;
};
export type MistakeRow = Mistake & {
  adminConfirmedAt?: Date | null;
  sourceSessionId?: string | null;
  sourceSequence?: number | null;
};

/** Normalized bag of domain rows. DB rows and fixture rows share this shape. */
export type RawSeed = {
  examTracks: ExamTrack[];
  courses: Course[];
  chapters: Chapter[];
  knowledgePoints: KnowledgePoint[];
  learnerKpStates: LearnerKpState[];
  mistakes: MistakeRow[];
  reviewItems: ReviewItemRow[];
  dailyLogs: DailyLogEntry[];
  questionBankStats: QuestionBankStats[];
  questionKpLinks: QuestionKpLink[];
  questions: Question[];
  warnings: ConflictWarning[];
};

export type SeedBundle = { source: SeedSource; raw: RawSeed };

/** Per-course progress, counted from the authoritative source (learner_kp_states). */
export type CourseProgress = {
  course: Course;
  total: number;
  mastered: number;
  practiced: number;
  taught: number;
  pct: number;
  /**
   * High-completion among engaged KPs (mastered / states-present ≥ threshold,
   * task 4.4/6.4) — e.g. 13015 重考. Surfaced as 维护/抗遗忘, not from-scratch.
   */
  maintenance: boolean;
  /** provenance for traceability: source block of the course row (null in fixture). */
  sourceBlockId: string | null;
};

/** One gated 今日任务 row (task 4.3). */
export type TodayReview = {
  id: string;
  origin: string;
  courseCode: string | null;
  courseName: string | null;
  kpCode: string;
  dueDate: string | null;
};
export type TodayMistake = {
  id: string;
  origin: string;
  courseCode: string | null;
  courseName: string | null;
  kpCode: string | null;
  questionRef: string | null;
  category: string | null;
};
/** Recent learning-context entry derived from daily_logs (task 4.4). */
export type ContextLog = { id: string; date: string; summary: string };

export type DashboardData = {
  source: SeedSource;
  examTrack: ExamTrack | null;
  examDate: string | null;
  countdownDays: number | null;
  current: CourseProgress[];
  passed: CourseProgress[];
  other: CourseProgress[];
  /** deduped TOTALS (design D7): per-KP review union, per-event mistake union. */
  reviewDue: number;
  mistakeCount: number;
  /** today-gated lists (design D11) — different cohort than the totals above. */
  todayReviews: TodayReview[];
  activeMistakes: TodayMistake[];
  /** learning-context restore (task 4.4). */
  maintenanceCourses: { courseCode: string; name: string }[];
  recentLogs: ContextLog[];
  weakPoints: { courseCode: string; name: string; pct: number }[];
  conflicts: ConflictWarning[];
};

export type SubjectData = {
  source: SeedSource;
  course: Course;
  chapters: Chapter[];
  kps: (KnowledgePoint & { state: LearnerKpState["state"] | null })[];
  stateSummary: Record<string, number>;
  bank: {
    declared: number | null;
    parsed: number | null;
    typeDistribution: { type: string; count: number }[];
    sources: string[];
    coveredKps: number;
    totalKps: number;
    mismatch: boolean;
  } | null;
};
