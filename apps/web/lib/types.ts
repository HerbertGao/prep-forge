// View-model + raw-seed types shared by the seed loader, fixture and pages.
// Kept separate so fixture.ts and seed.ts can both import without a value cycle.
import type {
  Chapter,
  Course,
  ExamTrack,
  KnowledgePoint,
  LearnerKpState,
  Mistake,
  Question,
  QuestionBankStats,
  QuestionKpLink,
  QuestionSolution,
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

/** Normalized bag of domain rows. DB rows and fixture rows share this shape. */
export type RawSeed = {
  examTracks: ExamTrack[];
  courses: Course[];
  chapters: Chapter[];
  knowledgePoints: KnowledgePoint[];
  learnerKpStates: LearnerKpState[];
  mistakes: Mistake[];
  reviewItems: ReviewItem[];
  questionBankStats: QuestionBankStats[];
  questionKpLinks: QuestionKpLink[];
  questions: Question[];
  questionSolutions: QuestionSolution[];
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
  /** provenance for traceability: source block of the course row (null in fixture). */
  sourceBlockId: string | null;
};

export type DashboardData = {
  source: SeedSource;
  examTrack: ExamTrack | null;
  examDate: string | null;
  countdownDays: number | null;
  current: CourseProgress[];
  passed: CourseProgress[];
  other: CourseProgress[];
  reviewDue: number;
  mistakeCount: number;
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
