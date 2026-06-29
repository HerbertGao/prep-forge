import { readFileSync } from "node:fs";
import type { BlockDraft, Candidate, ParseResult } from "./types";
import { emptyResult } from "./types";
import { colIndex, findTables, makeBlock, splitLines } from "./markdown";
import {
  CURRENT_EXAM_TRACK,
  PASSED_EXAM_TRACK,
  dashboardDateToIso,
  entityContentHash,
  termToTrack,
} from "./util";

export interface CourseInfo {
  code: string;
  name: string;
  statusText: string;
  termText: string;
  examTrack: string | null;
  examStatus: "未开始" | "缺考" | "重考" | "在考" | "已通过" | "unmapped";
}

export interface ExamPlanContext {
  courses: CourseInfo[];
  /** resolve a course_code from a subject keyword (exam_plan is the SoT). */
  resolveCode(keyword: string): CourseInfo | null;
  block: BlockDraft;
}

const LEARNER_ID = "ai-teacher-self";

function publicEntity(
  entityType: string,
  naturalKey: string,
  fields: Record<string, unknown>,
  block: BlockDraft,
): Candidate {
  const id = `${entityType}#${naturalKey}`;
  const payload: Record<string, unknown> = {
    id,
    origin: "imported",
    visibility: "public",
    sourceBlockId: block.id,
    ...fields,
  };
  payload.contentHash = entityContentHash(payload);
  return { entityType, naturalKey, visibility: "public", payload, block };
}

function deriveStatus(
  code: string,
  statusText: string,
  passed: Set<string>,
  currentTermCodes: Set<string>,
): CourseInfo["examStatus"] {
  if (passed.has(code) || /合格|已通过|通过/.test(statusText)) return "已通过";
  if (/缺考/.test(statusText) && !/重考/.test(statusText)) return "缺考";
  if (/重考/.test(statusText)) return "重考";
  if (currentTermCodes.has(code)) return "在考";
  return "未开始";
}

function deriveTrack(
  status: CourseInfo["examStatus"],
  termText: string,
  currentTermCodes: Set<string>,
  code: string,
): string | null {
  if (status === "已通过") return PASSED_EXAM_TRACK;
  if (status === "在考" || status === "重考" || currentTermCodes.has(code)) return CURRENT_EXAM_TRACK;
  return termToTrack(termText);
}

/**
 * Parse exam_plan.md: the code table (SoT for course_code), the 成绩记录 table
 * (passed history), producing public Course + ExamTrack entities and the
 * personal multi-期 plan (StudyPlan). `currentTermCodes` are the in-exam course
 * codes (from dashboard countdown).
 */
export function parseExamPlan(
  absPath: string,
  relPath: string,
  currentTermCodes: Set<string>,
  /** course_code -> dashboard countdown 日期 string (the only concrete exam date in source). */
  examDates: Map<string, string> = new Map(),
): { result: ParseResult; ctx: ExamPlanContext } {
  const result = emptyResult();
  const lines = splitLines(readFileSync(absPath, "utf8"));
  const tables = findTables(lines);

  // passed history: 课程代码 + 结果(合格)
  const passed = new Set<string>();
  for (const t of tables) {
    const cCode = colIndex(t.header, /课程代码|代码/);
    const cResult = colIndex(t.header, /结果/);
    if (cCode < 0 || cResult < 0) continue;
    for (const row of t.rows) {
      const code = (row[cCode] ?? "").replace(/[^0-9]/g, "");
      if (code && /合格|通过/.test(row[cResult] ?? "")) passed.add(code);
    }
  }

  const block = makeBlock(relPath, [], "exam_plan_code_table", { start: 0, end: lines.length - 1 }, lines.join("\n"));
  result.blocks.push(block);

  // Accumulate per-code facts across ALL course-like tables (成绩记录 +
  // 全部所需科目). A code can appear in several tables with complementary fields
  // (成绩记录 has no 状态/考期; 全部所需科目 has them) — merge, preferring non-empty.
  // NB: 课程代码 column also contains "课程", so the name regex must NOT match it.
  const acc = new Map<string, { name: string; statusText: string; termText: string }>();
  for (const t of tables) {
    const cName = colIndex(t.header, /科目|课程名称/);
    const cCode = colIndex(t.header, /代码/);
    const cStatus = colIndex(t.header, /状态/);
    const cTerm = colIndex(t.header, /计划考期|考期/);
    if (cName < 0 || cCode < 0) continue;
    for (const row of t.rows) {
      const code = (row[cCode] ?? "").replace(/[^0-9]/g, "");
      if (!/^\d{5}$/.test(code)) continue;
      const name = (row[cName] ?? "").replace(/\*\*/g, "").trim();
      const statusText = cStatus >= 0 ? (row[cStatus] ?? "").trim() : "";
      const termText = cTerm >= 0 ? (row[cTerm] ?? "").trim() : "";
      const cur = acc.get(code) ?? { name: "", statusText: "", termText: "" };
      if (!cur.name && name) cur.name = name;
      if (!cur.statusText && statusText) cur.statusText = statusText;
      if (!cur.termText && termText) cur.termText = termText;
      acc.set(code, cur);
    }
  }

  const courses: CourseInfo[] = [...acc].map(([code, v]) => {
    const examStatus = deriveStatus(code, v.statusText, passed, currentTermCodes);
    const examTrack = deriveTrack(examStatus, v.termText, currentTermCodes, code);
    return { code, name: v.name, statusText: v.statusText, termText: v.termText, examTrack, examStatus };
  });

  // exam tracks. examDate is derived from the dashboard countdown 日期 column (the
  // only concrete date in source) — a track's date = the earliest exam day among
  // its courses. Tracks with no dashboard date stay null (no fabricated countdown).
  const trackDates = new Map<string, string>();
  for (const c of courses) {
    if (!c.examTrack) continue;
    const iso = dashboardDateToIso(examDates.get(c.code) ?? "", c.examTrack);
    if (!iso) continue;
    const cur = trackDates.get(c.examTrack);
    if (!cur || iso < cur) trackDates.set(c.examTrack, iso);
  }
  const tracks = new Set(courses.map((c) => c.examTrack).filter((t): t is string => Boolean(t)));
  for (const track of tracks) {
    result.candidates.push(
      publicEntity("exam_track", track, { examTrack: track, title: `${track} 考期`, examDate: trackDates.get(track) ?? null }, block),
    );
  }

  // courses
  for (const c of courses) {
    result.candidates.push(
      publicEntity(
        "course",
        c.code,
        { courseCode: c.code, slug: null, name: c.name, examTrack: c.examTrack, examStatus: c.examStatus },
        block,
      ),
    );
  }

  // personal multi-期 graduation plan (exam_plan derives both public + personal)
  const planId = "study_plan#exam_plan";
  const planPayload: Record<string, unknown> = {
    id: planId,
    origin: "imported",
    visibility: "personal",
    sourceBlockId: block.id,
    learnerId: LEARNER_ID,
    examTrack: CURRENT_EXAM_TRACK,
    title: "多期毕业路径规划",
  };
  planPayload.contentHash = entityContentHash(planPayload);
  result.candidates.push({
    entityType: "study_plan",
    naturalKey: "exam_plan",
    visibility: "personal",
    payload: planPayload,
    block,
  });

  const byKeyword = (keyword: string): CourseInfo | null =>
    courses.find((c) => c.name.includes(keyword)) ?? null;

  return { result, ctx: { courses, resolveCode: byKeyword, block } };
}
