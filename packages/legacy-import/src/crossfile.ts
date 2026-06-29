import type { Issue } from "./types";
import type { SubjectStat } from "./parsers/subjects";
import type { DashboardData } from "./parsers/core";
import { slugFromLabel } from "./util";

export interface QbankStat {
  courseCode: string;
  declared: number | null;
  parsed: number;
}

/** Normalize a date token ("10/24 周六", "2026-10-24") to "MM-DD". */
function monthDay(text: string): string | null {
  const iso = /\d{4}-(\d{2})-(\d{2})/.exec(text);
  if (iso) return `${iso[1]}-${iso[2]}`;
  const slash = /(\d{1,2})\/(\d{1,2})/.exec(text);
  if (slash) return `${slash[1]!.padStart(2, "0")}-${slash[2]!.padStart(2, "0")}`;
  return null;
}

/**
 * Cross-file consistency warnings (spec 4.11), never silent:
 *  - KP total / mastered drift across dashboard, progress, syllabus
 *  - exam-date conflicts across dashboard / study_plan
 *  - stats.md declared count vs actually-parsed question count
 */
export function crossFileWarnings(args: {
  dashboard?: DashboardData;
  subjectStats: SubjectStat[];
  qbankStats: QbankStat[];
  slugToCourse: Map<string, string>;
  studyPlanContent?: string;
}): Issue[] {
  const issues: Issue[] = [];
  const courseToSlug = new Map<string, string>();
  for (const [slug, code] of args.slugToCourse) courseToSlug.set(code, slug);

  // 1. KP totals / mastered drift
  for (const stat of args.subjectStats) {
    const dash = args.dashboard?.totals.get(stat.slug);
    const totals = [
      ["syllabus", stat.syllabusKpCount ?? null],
      ["progress", stat.progressTotal],
      ["dashboard", dash?.total ?? null],
    ].filter(([, v]) => v != null) as [string, number][];
    const distinct = new Set(totals.map(([, v]) => v));
    if (distinct.size > 1) {
      issues.push({
        severity: "warning",
        kind: "kp_total_drift",
        message: `知识点总数漂移 ${stat.slug}: ${totals.map(([s, v]) => `${s}=${v}`).join(", ")}`,
        sourcePath: `teacher/subjects/${stat.slug}`,
      });
    }
    if (dash && stat.progressMastered != null && dash.mastered !== stat.progressMastered) {
      issues.push({
        severity: "warning",
        kind: "kp_mastered_drift",
        message: `已掌握数漂移 ${stat.slug}: dashboard=${dash.mastered}, progress=${stat.progressMastered}`,
        sourcePath: `teacher/subjects/${stat.slug}`,
      });
    }
  }

  // 2. exam-date conflicts: dashboard countdown vs study_plan 考试日期 line.
  // Restrict to the 考试日期 line so rebase/baseline dates (e.g. 2026-06-09) in
  // the body don't masquerade as exam dates.
  if (args.dashboard && args.studyPlanContent) {
    const examLine = args.studyPlanContent.split(/\r?\n/).find((l) => l.includes("考试日期")) ?? "";
    const planDates = new Map<string, string>(); // slug -> MM-DD
    for (const seg of examLine.split(/[；;]/)) {
      const md = monthDay(seg);
      if (!md) continue;
      // crude: assign this segment's date to every subject label it mentions
      for (const label of ["离散", "高数", "高等数学", "操作系统", "OS", "CS", "计算机"]) {
        if (seg.includes(label)) {
          const slug = slugFromLabel(label);
          if (slug) planDates.set(slug, md);
        }
      }
    }
    for (const [code, dateText] of args.dashboard.examDates) {
      const slug = courseToSlug.get(code);
      const dMd = monthDay(dateText);
      if (!slug || !dMd) continue;
      const planMd = planDates.get(slug);
      if (planMd && planMd !== dMd) {
        issues.push({
          severity: "warning",
          kind: "exam_date_conflict",
          message: `考试日期冲突 ${slug}: dashboard=${dMd}, study_plan=${planMd}`,
          sourcePath: "teacher/dashboard.md",
        });
      }
    }
  }

  // 3. stats declared vs parsed
  for (const q of args.qbankStats) {
    if (q.declared != null && q.declared !== q.parsed) {
      issues.push({
        severity: "warning",
        kind: "stats_count_mismatch",
        message: `stats.md 声称题量与实际解析不一致 ${q.courseCode}: declared=${q.declared}, parsed=${q.parsed}`,
        sourcePath: `materials/${courseToSlug.get(q.courseCode) ?? q.courseCode}/question_bank/stats.md`,
      });
    }
  }

  return issues;
}
