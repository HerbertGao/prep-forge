// Server-only seed data-access layer (task 5.1).
//
// DB-first: read the legacy import published into PostgreSQL via createDb().
// Falls back to the local fixture (non-acceptance) when the DB is unreachable
// OR empty, so `next build` and `next dev` work with no database. Acceptance
// (Phase 0) requires source==="db", traceable to import run / source block.
import { eq } from "drizzle-orm";
import { createDb, schema } from "@prep-forge/db";
import type { Course } from "@prep-forge/schemas";
import { FIXTURE } from "./fixture";
import type {
  ConflictWarning,
  CourseProgress,
  DashboardData,
  RawSeed,
  SeedBundle,
  SubjectData,
} from "./types";

async function readAll(db: ReturnType<typeof createDb>): Promise<RawSeed> {
  const [
    examTracks,
    courses,
    chapters,
    knowledgePoints,
    learnerKpStates,
    mistakes,
    reviewItems,
    questionBankStats,
    questionKpLinks,
    questions,
    questionSolutions,
    importErrorRows,
  ] = await Promise.all([
    db.select().from(schema.examTracks),
    db.select().from(schema.courses),
    db.select().from(schema.chapters),
    db.select().from(schema.knowledgePoints),
    db.select().from(schema.learnerKpStates),
    db.select().from(schema.mistakes),
    db.select().from(schema.reviewItems),
    db.select().from(schema.questionBankStats),
    db.select().from(schema.questionKpLinks),
    db.select().from(schema.questions),
    db.select().from(schema.questionSolutions),
    db
      .select({ kind: schema.importErrors.kind, message: schema.importErrors.message })
      .from(schema.importErrors)
      .where(eq(schema.importErrors.severity, "warning")),
  ]);

  // ponytail: DB rows already match the Zod-derived shape (parity test in
  // @prep-forge/db guarantees it); cast at this boundary instead of re-parsing.
  return {
    examTracks,
    courses,
    chapters,
    knowledgePoints,
    learnerKpStates,
    mistakes,
    reviewItems,
    questionBankStats,
    questionKpLinks,
    questions,
    questionSolutions,
    warnings: importErrorRows.map((w) => ({
      kind: w.kind,
      message: w.message,
      authoritative: authoritativeFor(w.kind),
    })),
  } as unknown as RawSeed;
}

/**
 * Which source we took the value from for a cross-file conflict (drives the
 * dashboard "取值：…" line). import_errors only carry kind+message, so the
 * authoritative source is derived from the conflict kind (types.ts: counts←
 * progress.md, dates←exam_plan.md, declared-vs-parsed←实际解析).
 */
function authoritativeFor(kind: string): string | undefined {
  if (kind === "kp_total_drift" || kind === "kp_mastered_drift") return "progress.md";
  if (kind === "exam_date_conflict") return "exam_plan.md";
  if (kind === "stats_count_mismatch") return "实际解析";
  return undefined;
}

export async function loadSeed(): Promise<SeedBundle> {
  try {
    const db = createDb(); // throws if DATABASE_URL unset (the common no-DB case)
    const raw = await readAll(db);
    if (raw.courses.length === 0) return { source: "fixture", raw: FIXTURE };
    return { source: "db", raw };
  } catch (e) {
    // DB unreachable / bad URL / empty -> non-acceptance fixture render. Log so a
    // broken/partial DB is diagnosable instead of silently masked by the fixture.
    console.error("[seed] DB read failed, falling back to fixture:", e);
    return { source: "fixture", raw: FIXTURE };
  }
}

// --- view builders (shared by DB + fixture branches) ---

const CURRENT_STATUSES: Course["examStatus"][] = ["在考", "重考", "缺考"];

function progressFor(raw: RawSeed, course: Course): CourseProgress {
  const total = raw.knowledgePoints.filter((k) => k.courseCode === course.courseCode).length;
  const states = raw.learnerKpStates.filter((s) => s.courseCode === course.courseCode);
  const mastered = states.filter((s) => s.state === "mastered").length;
  const practiced = states.filter((s) => s.state === "practiced").length;
  const taught = states.filter((s) => s.state === "taught").length;
  const pct = total > 0 ? Math.round((mastered / total) * 100) : 0;
  return {
    course,
    total,
    mastered,
    practiced,
    taught,
    pct,
    sourceBlockId: course.sourceBlockId ?? null,
  };
}

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const target = new Date(dateStr).getTime();
  if (Number.isNaN(target)) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((target - today) / 86_400_000);
}

export function buildDashboard(bundle: SeedBundle): DashboardData {
  const { raw, source } = bundle;
  const examTrack =
    raw.examTracks.find((t) => t.examTrack === "2026-10") ?? raw.examTracks[0] ?? null;
  // 日期取 exam_plan.md（权威来源）→ exam_tracks.examDate
  const examDate = examTrack?.examDate ?? null;

  const all = raw.courses.map((c) => progressFor(raw, c));
  const current = all.filter((p) => CURRENT_STATUSES.includes(p.course.examStatus));
  const passed = all.filter((p) => p.course.examStatus === "已通过");
  const other = all.filter(
    (p) => !CURRENT_STATUSES.includes(p.course.examStatus) && p.course.examStatus !== "已通过",
  );

  const weakPoints = current
    .filter((p) => p.total > 0 && p.pct < 34)
    .sort((a, b) => a.pct - b.pct)
    .map((p) => ({ courseCode: p.course.courseCode, name: p.course.name, pct: p.pct }));

  const conflicts: ConflictWarning[] = raw.warnings;

  return {
    source,
    examTrack,
    examDate,
    countdownDays: daysUntil(examDate),
    current,
    passed,
    other,
    reviewDue: raw.reviewItems.length,
    mistakeCount: raw.mistakes.length,
    weakPoints,
    conflicts,
  };
}

export function buildSubject(bundle: SeedBundle, param: string): SubjectData | null {
  const { raw, source } = bundle;
  // Resolve by course_code, subject_code (slug) or course slug — dashboard links
  // use course_code; PRODUCT route is /subjects/[subjectCode].
  const decoded = decodeURIComponent(param);
  const course =
    raw.courses.find((c) => c.courseCode === decoded || c.slug === decoded) ?? null;
  if (!course) return null;
  const code = course.courseCode;

  const stateByKp = new Map(
    raw.learnerKpStates.filter((s) => s.courseCode === code).map((s) => [s.kpCode, s.state]),
  );
  const kps = raw.knowledgePoints
    .filter((k) => k.courseCode === code)
    .map((k) => ({ ...k, state: stateByKp.get(k.kpCode) ?? null }));

  const stateSummary: Record<string, number> = {
    unseen: 0,
    taught: 0,
    practiced: 0,
    mastered: 0,
  };
  for (const k of kps) {
    const s = k.state ?? "unseen";
    stateSummary[s] = (stateSummary[s] ?? 0) + 1;
  }

  const statsRows = raw.questionBankStats.filter((s) => s.courseCode === code);
  const links = raw.questionKpLinks.filter((l) => l.courseCode === code);
  let bank: SubjectData["bank"] = null;
  if (statsRows.length > 0) {
    const declared = statsRows.reduce<number | null>(
      (acc, s) => (s.declaredCount != null ? (acc ?? 0) + s.declaredCount : acc),
      null,
    );
    const parsed = statsRows.reduce<number | null>(
      (acc, s) => (s.parsedCount != null ? (acc ?? 0) + s.parsedCount : acc),
      null,
    );
    const typeDistribution = statsRows.flatMap(
      (s) =>
        (s.typeDistribution as { type: string; count: number }[] | null | undefined) ?? [],
    );
    // 来源范围 = the distinct src values of the course's questions (each question
    // carries a real src). Fall back to the stats row src when no questions are
    // loaded (fixture mode keeps questions: []).
    const courseQuestionSrcs = raw.questions.filter((q) => q.courseCode === code).map((q) => q.src);
    const sources =
      courseQuestionSrcs.length > 0
        ? [...new Set(courseQuestionSrcs)].sort()
        : [...new Set(statsRows.map((s) => s.src).filter((v): v is string => Boolean(v)))];
    const coveredKps = new Set(links.map((l) => l.kpCode)).size;
    bank = {
      declared,
      parsed,
      typeDistribution,
      sources,
      coveredKps,
      totalKps: kps.length,
      mismatch: declared != null && parsed != null && declared !== parsed,
    };
  }

  return { source, course, chapters: raw.chapters.filter((c) => c.courseCode === code), kps, stateSummary, bank };
}
