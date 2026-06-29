import { readFileSync } from "node:fs";
import type { BlockDraft, Candidate, ParseResult, ScannedDoc } from "../types";
import { emptyResult } from "../types";
import { colIndex, findTables, makeBlock, sectionBlocks, splitLines } from "../markdown";
import { CURRENT_EXAM_TRACK, entityContentHash, firstKpCode, slugFromLabel } from "../util";

const LEARNER_ID = "ai-teacher-self";
const DATE_RE = /(\d{4}-\d{2}-\d{2})/;

function entity(
  entityType: string,
  naturalKey: string,
  fields: Record<string, unknown>,
  block: BlockDraft,
): Candidate {
  const id = `${entityType}#${naturalKey}`;
  const payload: Record<string, unknown> = {
    id,
    origin: "imported",
    visibility: "personal",
    sourceBlockId: block.id,
    ...fields,
  };
  payload.contentHash = entityContentHash(payload);
  return { entityType, naturalKey, visibility: "personal", payload, block };
}

function wholeFileBlock(doc: ScannedDoc, key: string): BlockDraft {
  const content = readFileSync(doc.absPath, "utf8");
  const lines = splitLines(content);
  return makeBlock(doc.relPath, [], key, { start: 0, end: lines.length - 1 }, content);
}

export function parseLearnerProfile(doc: ScannedDoc): ParseResult {
  const result = emptyResult();
  const content = readFileSync(doc.absPath, "utf8");
  const block = makeBlock(doc.relPath, [], "learner_profile", { start: 0, end: splitLines(content).length - 1 }, content);
  result.blocks.push(block);
  const profession = (/专业[：:]\s*(.*)/.exec(content) ?? [])[1]?.replace(/\*\*/g, "").trim() ?? null;
  const c = entity(
    "learner_profile",
    LEARNER_ID,
    { learnerId: LEARNER_ID, displayName: "自考本科在读", examTrack: CURRENT_EXAM_TRACK, preferences: profession ? { profession } : undefined },
    block,
  );
  result.candidates.push(c);
  return result;
}

export interface DashboardData {
  /** in-exam course codes (countdown table). */
  currentTermCodes: Set<string>;
  /** slug -> {total KP, mastered} from 完成度 block. */
  totals: Map<string, { total: number; mastered: number }>;
  /** course code -> exam date string from countdown (for date-conflict warning). */
  examDates: Map<string, string>;
}

export function parseDashboard(doc: ScannedDoc): { result: ParseResult; data: DashboardData } {
  const result = emptyResult();
  const content = readFileSync(doc.absPath, "utf8");
  const lines = splitLines(content);
  const currentTermCodes = new Set<string>();
  const totals = new Map<string, { total: number; mastered: number }>();
  const examDates = new Map<string, string>();

  // countdown table: rows carry a (NNNNN) code + a date column.
  for (const t of findTables(lines)) {
    const cExam = colIndex(t.header, /考试/);
    const cDate = colIndex(t.header, /日期/);
    if (cExam < 0) continue;
    for (const row of t.rows) {
      const code = (/\((\d{5})\)/.exec(row[cExam] ?? "") ?? [])[1];
      if (!code) continue;
      currentTermCodes.add(code);
      if (cDate >= 0 && row[cDate]) examDates.set(code, (row[cDate] ?? "").trim());
    }
  }

  // 完成度 block: "离散数学 [....] 0% (0 掌握 / 30 KP)"
  for (const line of lines) {
    const m = /(\d+)\s*掌握[^/]*\/\s*(\d+)\s*KP/.exec(line);
    if (!m) continue;
    const slug = slugFromLabel(line);
    if (!slug) continue;
    totals.set(slug, { mastered: parseInt(m[1]!, 10), total: parseInt(m[2]!, 10) });
  }

  const date = (DATE_RE.exec(content) ?? [])[1] ?? "unknown";
  const block = makeBlock(doc.relPath, [], "dashboard", { start: 0, end: lines.length - 1 }, content);
  result.blocks.push(block);
  result.candidates.push(entity("daily_log_entry", `dashboard:${date}`, { learnerId: LEARNER_ID, date, content }, block));

  return { result, data: { currentTermCodes, totals, examDates } };
}

export function parseStudyPlan(doc: ScannedDoc): ParseResult {
  const result = emptyResult();
  const block = wholeFileBlock(doc, "study_plan");
  result.blocks.push(block);
  result.candidates.push(entity("study_plan", "study_plan", { learnerId: LEARNER_ID, examTrack: CURRENT_EXAM_TRACK, title: "10 月考期学习计划" }, block));
  return result;
}

export function parsePhase0Tasks(doc: ScannedDoc): ParseResult {
  const result = emptyResult();
  const block = wholeFileBlock(doc, "phase0_tasks");
  result.blocks.push(block);
  result.candidates.push(entity("study_plan", "phase0_tasks", { learnerId: LEARNER_ID, examTrack: CURRENT_EXAM_TRACK, title: "Phase 0 每日知识点清单" }, block));
  return result;
}

export function parseSessionArchive(doc: ScannedDoc): ParseResult {
  const result = emptyResult();
  let seq = 0;
  for (const block of sectionBlocks(doc.relPath, splitLines(readFileSync(doc.absPath, "utf8")))) {
    if (!/^来源[：:]/.test(block.normalizedKey)) continue;
    seq += 1;
    const date = (DATE_RE.exec(block.rawBlock) ?? [])[1] ?? `archive-${seq}`;
    result.blocks.push(block);
    result.candidates.push(entity("daily_log_entry", `archive:${seq}:${date}`, { learnerId: LEARNER_ID, date, content: block.rawBlock }, block));
  }
  return result;
}

export function parseDailyLog(doc: ScannedDoc): ParseResult {
  const result = emptyResult();
  for (const block of sectionBlocks(doc.relPath, splitLines(readFileSync(doc.absPath, "utf8")))) {
    const dm = DATE_RE.exec(block.normalizedKey);
    if (!dm) continue; // non-dated sections (记录格式 etc.) carry no log entry
    result.blocks.push(block);
    result.candidates.push(
      entity("daily_log_entry", `daily:${block.normalizedKey}`, { learnerId: LEARNER_ID, date: dm[1]!, content: block.rawBlock }, block),
    );
  }
  return result;
}

/**
 * review_queue.md -> ReviewItem (personal). Each row must map to a known KP
 * (courseCode+kpCode ∈ catalog); rows that can't map become import_errors
 * (never silently dropped, spec 4.11).
 */
export function parseReviewQueue(
  doc: ScannedDoc,
  kpCatalog: Set<string>,
  slugToCourse: Map<string, string>,
): ParseResult {
  const result = emptyResult();
  const lines = splitLines(readFileSync(doc.absPath, "utf8"));
  const block = makeBlock(doc.relPath, ["review_queue"], "review_rows", { start: 0, end: lines.length - 1 }, lines.join("\n"));
  let used = false;
  let seq = 0;

  for (const t of findTables(lines)) {
    const cKp = colIndex(t.header, /知识点编号|编码|编号/);
    const cSubject = colIndex(t.header, /科目/);
    const cStatus = colIndex(t.header, /状态/);
    const cDue = colIndex(t.header, /下次复习|第1次|第一次/);
    if (cKp < 0) continue;
    for (const row of t.rows) {
      const kpCode = firstKpCode(row[cKp] ?? "");
      if (!kpCode) continue;
      seq += 1;
      const subjectText = cSubject >= 0 ? (row[cSubject] ?? "") : (row[cKp] ?? "");
      const slug = slugFromLabel(subjectText) ?? slugFromLabel(kpCode);
      const courseCode = slug ? slugToCourse.get(slug) : undefined;
      const due = cDue >= 0 ? (row[cDue] ?? "").trim() || null : null;
      const status = cStatus >= 0 ? (row[cStatus] ?? "").trim() || null : null;

      if (!courseCode || !kpCatalog.has(`${courseCode}:${kpCode}`)) {
        // Row-level block so the dangling row keeps precise provenance. Do NOT
        // attach the error to the shared review block: review_items share it and
        // publishStaged blocks every entity on a block carrying an error, which
        // would drop all valid review items (real data has 盲区 placeholder rows
        // like M01-XX that don't resolve to a KP).
        const rowBlock = makeBlock(
          doc.relPath,
          ["review_queue", "dangling"],
          `review_dangling:${kpCode}:${seq}`,
          { start: 0, end: lines.length - 1 },
          row.join(" | "),
        );
        result.blocks.push(rowBlock);
        result.issues.push({
          severity: "error",
          kind: "dangling_review_ref",
          message: `复习项无法映射到知识点: ${kpCode} (科目=${subjectText.trim() || "?"})`,
          sourcePath: doc.relPath,
          sourceBlockId: rowBlock.id,
          rawBlock: row.join(" | ").slice(0, 200),
        });
        continue;
      }
      used = true;
      result.candidates.push(
        entity(
          "review_item",
          `${courseCode}:${kpCode}:${due ?? "_"}:${seq}`,
          { learnerId: LEARNER_ID, courseCode, kpCode, dueDate: due, status },
          block,
        ),
      );
    }
  }
  if (used) result.blocks.push(block);
  return result;
}
