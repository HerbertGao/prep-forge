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
import {
  isMistakeActive,
  isReviewDueToday,
  mergeKpStateByMax,
  mergeReviews,
  type KpRank,
} from "./merge";
import type {
  ConflictWarning,
  CourseProgress,
  DashboardData,
  RawSeed,
  SeedBundle,
  SubjectData,
} from "./types";

/**
 * 维护/抗遗忘阈值 (task 4.4/6.4): a course whose ENGAGED KPs (those with a
 * learner_kp_state) are ≥ this fraction mastered is in maintenance mode — e.g.
 * 13015 重考 (3/3 mastered = 1.0). Backed by the apply 调查 (design 开放问题);
 * tune here, not scattered through the read model.
 */
export const MAINTENANCE_MASTERY_RATIO = 0.8;

async function readAll(db: ReturnType<typeof createDb>): Promise<RawSeed> {
  const [
    examTracks,
    courses,
    chapters,
    knowledgePoints,
    learnerKpStates,
    mistakes,
    reviewItems,
    dailyLogs,
    questionBankStats,
    questionKpLinks,
    questions,
    importErrorRows,
  ] = await Promise.all([
    db.select().from(schema.examTracks),
    db.select().from(schema.courses),
    db.select().from(schema.chapters),
    db.select().from(schema.knowledgePoints),
    db.select().from(schema.learnerKpStates),
    db.select().from(schema.mistakes),
    db.select().from(schema.reviewItems),
    db.select().from(schema.dailyLogs),
    db.select().from(schema.questionBankStats),
    db.select().from(schema.questionKpLinks),
    db.select().from(schema.questions),
    db
      .select({ kind: schema.importErrors.kind, message: schema.importErrors.message })
      .from(schema.importErrors)
      .where(eq(schema.importErrors.severity, "warning")),
  ]);

  return {
    examTracks,
    courses,
    chapters,
    knowledgePoints,
    learnerKpStates,
    mistakes,
    reviewItems,
    dailyLogs,
    questionBankStats: questionBankStats as RawSeed["questionBankStats"],
    questionKpLinks,
    questions,
    warnings: importErrorRows.map((w) => ({
      kind: w.kind,
      message: w.message,
      authoritative: authoritativeFor(w.kind),
    })),
  };
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
  // per-KP merge of imported+system rows by monotonic MAX rank (design D7) —
  // a KP with both an imported and a system state counts once, at the higher.
  const merged = mergeKpStateByMax(
    raw.learnerKpStates
      .filter((s) => s.courseCode === course.courseCode)
      .map((s) => ({ kpCode: s.kpCode, state: s.state as KpRank })),
  );
  let mastered = 0;
  let practiced = 0;
  let taught = 0;
  for (const st of merged.values()) {
    if (st === "mastered") mastered += 1;
    else if (st === "practiced") practiced += 1;
    else if (st === "taught") taught += 1;
  }
  const pct = total > 0 ? Math.round((mastered / total) * 100) : 0;
  // maintenance = high mastery among ENGAGED KPs (states present), not all KPs
  // (task 4.4): 13015 重考 has 3/3 mastered ⇒ maintenance even at low overall pct.
  const engaged = merged.size;
  const maintenance = engaged > 0 && mastered / engaged >= MAINTENANCE_MASTERY_RATIO;
  return {
    course,
    total,
    mastered,
    practiced,
    taught,
    pct,
    maintenance,
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

  const courseName = new Map(raw.courses.map((c) => [c.courseCode, c.name]));

  // per-KP review merge (design D7): imported+system collapse per (learner,kp);
  // the deduped count is the dashboard TOTAL, the today list is the gated subset.
  const mergedReviews = mergeReviews(
    raw.reviewItems.map((r) => ({
      id: r.id,
      learnerId: r.learnerId ?? null,
      courseCode: r.courseCode ?? null,
      kpCode: r.kpCode,
      origin: r.origin,
      dueDate: r.dueDate ?? null,
      adminConfirmedAt: r.adminConfirmedAt ?? null,
      lastAppliedAt: r.lastAppliedAt ?? null,
    })),
  );
  const todayReviews = mergedReviews
    .filter((r) => isReviewDueToday(r))
    .map((r) => ({
      id: r.id,
      origin: r.origin,
      courseCode: r.courseCode,
      courseName: r.courseCode ? (courseName.get(r.courseCode) ?? null) : null,
      kpCode: r.kpCode,
      dueDate: r.dueDate,
    }));

  // per-event mistakes are NOT KP-collapsed (design D7): each row is its own
  // mistake; active = admin_confirmed_at IS NULL.
  const activeMistakes = raw.mistakes
    .filter((m) => isMistakeActive(m))
    .map((m) => ({
      id: m.id,
      origin: m.origin,
      courseCode: m.courseCode ?? null,
      courseName: m.courseCode ? (courseName.get(m.courseCode) ?? null) : null,
      kpCode: m.kpCode ?? null,
      questionRef: m.questionRef ?? null,
      category: m.category ?? null,
    }));

  const maintenanceCourses = current
    .filter((p) => p.maintenance)
    .map((p) => ({ courseCode: p.course.courseCode, name: p.course.name }));

  const recentLogs = [...raw.dailyLogs]
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 5)
    .map((l) => ({ id: l.id, date: l.date, summary: logSummary(l.content) }));

  return {
    source,
    examTrack,
    examDate,
    countdownDays: daysUntil(examDate),
    current,
    passed,
    other,
    // deduped totals (design D7): merged per-KP reviews; per-event mistake union
    // (mistake ids are unique PKs, so length is already the deduped union).
    reviewDue: mergedReviews.length,
    mistakeCount: raw.mistakes.length,
    todayReviews,
    activeMistakes,
    maintenanceCourses,
    recentLogs,
    weakPoints,
    conflicts,
  };
}

/** First non-heading line of a daily-log markdown block, trimmed for context. */
function logSummary(content: string): string {
  const line =
    content
      .split("\n")
      .map((l) => l.replace(/^[#>\s*-]+/, "").trim())
      .find((l) => l.length > 0) ?? "";
  return line.length > 80 ? `${line.slice(0, 80)}…` : line || "（无摘要）";
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

  // per-KP merge by monotonic MAX rank (design D7), not last-wins: a KP with
  // both an imported and a system row shows the higher mastery, never double.
  const stateByKp = mergeKpStateByMax(
    raw.learnerKpStates
      .filter((s) => s.courseCode === code)
      .map((s) => ({ kpCode: s.kpCode, state: s.state as KpRank })),
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
