import { readFileSync } from "node:fs";
import type { BlockDraft, Candidate, Issue, ParseResult, ScannedDoc } from "../types";
import { emptyResult } from "../types";
import type { ExamPlanContext } from "../examPlan";
import { colIndex, findTables, makeBlock, sectionBlocks, splitLines } from "../markdown";
import { SUBJECT_SLUGS, chapterNoFromKpCode, entityContentHash, firstKpCode, mapKpState } from "../util";

const LEARNER_ID = "ai-teacher-self";
const SUBJECT_FILE_BASES = ["syllabus.md", "progress.md", "mistakes.md", "key_points.md"] as const;

export interface SubjectStat {
  slug: string;
  courseCode: string;
  syllabusKpCount: number;
  progressTotal: number | null;
  progressMastered: number | null;
}

function entity(
  entityType: string,
  naturalKey: string,
  visibility: "public" | "personal",
  fields: Record<string, unknown>,
  block: BlockDraft,
): Candidate {
  const id = `${entityType}#${naturalKey}`;
  const payload: Record<string, unknown> = {
    id,
    origin: "imported",
    visibility,
    sourceBlockId: block.id,
    ...fields,
  };
  payload.contentHash = entityContentHash(payload);
  return { entityType, naturalKey, visibility, payload, block };
}

const KP_LINE = /^-\s+([A-Z]{1,3}\d{2}-\d{2,})\s+(.*)$/;

function parseSyllabus(
  relPath: string,
  lines: string[],
  courseCode: string,
): { result: ParseResult; kpKeys: string[]; count: number } {
  const result = emptyResult();
  const kpKeys: string[] = [];
  let chapterTitle = "";
  const chaptersSeen = new Set<string>();
  let count = 0;

  lines.forEach((line, i) => {
    const h = /^(#{2,3})\s+(.*)$/.exec(line);
    if (h && h[1]!.length === 2) chapterTitle = h[2]!.trim();
    const m = KP_LINE.exec(line);
    if (!m) return;
    const code = m[1]!;
    const rest = m[2]!;
    const stars = (/★+/.exec(rest) ?? [""])[0];
    const title = rest
      .replace(/★+/g, "")
      .replace(/\[[^\]]*\]/g, "")
      .trim();
    const chapterNo = chapterNoFromKpCode(code) ?? "0";
    const kpBlock = makeBlock(relPath, [chapterTitle], code, { start: i, end: i }, line);
    result.blocks.push(kpBlock);
    if (!chaptersSeen.has(chapterNo)) {
      chaptersSeen.add(chapterNo);
      result.candidates.push(
        entity(
          "chapter",
          `${courseCode}:${chapterNo}`,
          "public",
          { courseCode, chapterNo, title: chapterTitle || `第${chapterNo}章` },
          kpBlock,
        ),
      );
    }
    result.candidates.push(
      entity(
        "knowledge_point",
        `${courseCode}:${code}`,
        "public",
        { courseCode, kpCode: code, title: title || code, chapterNo, examFrequency: stars || null },
        kpBlock,
      ),
    );
    kpKeys.push(`${courseCode}:${code}`);
    count += 1;
  });

  return { result, kpKeys, count };
}

function parseProgress(
  relPath: string,
  lines: string[],
  courseCode: string,
): { result: ParseResult; total: number | null; mastered: number | null } {
  const result = emptyResult();
  const block = makeBlock(relPath, ["progress"], "progress_states", { start: 0, end: lines.length - 1 }, lines.join("\n"));
  let total: number | null = null;
  let mastered: number | null = null;
  const emittedKp = new Set<string>();

  for (const t of findTables(lines)) {
    // summary rows: | 知识点总数 | 30 |  /  | 已掌握 | 0 |
    for (const row of t.rows) {
      const label = row[0] ?? "";
      const num = parseInt((row[1] ?? "").replace(/[^0-9]/g, ""), 10);
      if (/知识点总数/.test(label) && !Number.isNaN(num)) total = num;
      if (/^已掌握$/.test(label.trim()) && !Number.isNaN(num)) mastered = num;
    }
    // per-KP state table: a 知识点/编码/编号 column + a 状态 column
    const cKp = colIndex(t.header, /知识点|编码|编号/);
    const cState = colIndex(t.header, /状态/);
    if (cKp < 0 || cState < 0) continue;
    for (const row of t.rows) {
      const code = firstKpCode(row[cKp] ?? "");
      if (!code || emittedKp.has(code)) continue;
      const { state, mapped } = mapKpState(row[cState] ?? "");
      if (!mapped) {
        result.issues.push({
          severity: "warning",
          kind: "unmapped_progress_state",
          message: `progress 状态词汇无法映射，落到默认 unseen: "${(row[cState] ?? "").trim()}" (${code})`,
          sourcePath: relPath,
        });
      }
      emittedKp.add(code);
      result.candidates.push(
        entity(
          "learner_kp_state",
          `${LEARNER_ID}:${courseCode}:${code}`,
          "personal",
          { learnerId: LEARNER_ID, courseCode, kpCode: code, state, score: null },
          block,
        ),
      );
    }
  }
  if (result.candidates.length > 0) result.blocks.push(block);
  return { result, total, mastered };
}

function parseMistakes(relPath: string, lines: string[], courseCode: string): ParseResult {
  const result = emptyResult();
  for (const block of sectionBlocks(relPath, lines)) {
    if (!/错题\s*#/.test(block.normalizedKey)) continue;
    const raw = block.rawBlock;
    const ref = (/错题\s*#\s*(\S+)/.exec(block.normalizedKey) ?? [])[1] ?? block.normalizedKey;
    const kp = firstKpCode((/关联知识点\**[：:]\s*(.*)/.exec(raw) ?? [])[1] ?? "");
    const category = (/错因分类\**[：:]\s*(.*)/.exec(raw) ?? [])[1]?.replace(/\*\*/g, "").trim() ?? null;
    const note = (/题目\**[：:]\s*(.*)/.exec(raw) ?? [])[1]?.replace(/\*\*/g, "").trim()?.slice(0, 200) ?? null;
    result.blocks.push(block);
    // courseCode is always present → satisfies "must map to course or kp".
    result.candidates.push(
      entity(
        "mistake",
        `${courseCode}:${ref}`,
        "personal",
        { learnerId: LEARNER_ID, courseCode, kpCode: kp, questionRef: ref, category, note },
        block,
      ),
    );
  }
  return result;
}

function parseKeyPoints(relPath: string, lines: string[], courseCode: string): ParseResult {
  const result = emptyResult();
  lines.forEach((line, i) => {
    const m = KP_LINE.exec(line);
    if (!m) return;
    const code = m[1]!;
    const rest = m[2]!;
    const stars = (/★+/.exec(rest) ?? [""])[0];
    const title = rest.replace(/★+/g, "").replace(/\[[^\]]*\]/g, "").trim();
    const block = makeBlock(relPath, ["key_points"], code, { start: i, end: i }, line);
    result.blocks.push(block);
    result.candidates.push(
      entity(
        "knowledge_point",
        `${courseCode}:${code}`,
        "public",
        { courseCode, kpCode: code, title: title || code, chapterNo: chapterNoFromKpCode(code), examFrequency: stars || null },
        block,
      ),
    );
  });
  return result;
}

/** Parse one subject directory's files. Missing files → per-file warning, continue. */
export function parseSubject(
  slug: string,
  files: Partial<Record<string, ScannedDoc>>,
  ctx: ExamPlanContext,
): { result: ParseResult; kpKeys: string[]; stat: SubjectStat } {
  const result = emptyResult();
  const alias = SUBJECT_SLUGS[slug];
  const matched = alias ? ctx.resolveCode(alias.keyword) : null;
  const courseCode = matched?.code ?? `PROV-${slug}`;
  const name = alias?.name ?? slug;

  // pick a provenance block source: first available file's preamble, else synthetic.
  const firstDoc = SUBJECT_FILE_BASES.map((b) => files[b]).find((d): d is ScannedDoc => Boolean(d));
  const subjectBlock = firstDoc
    ? makeBlock(firstDoc.relPath, [], "subject", { start: 0, end: 0 }, `subject:${slug}`)
    : makeBlock(`teacher/subjects/${slug}`, [], "subject", { start: 0, end: 0 }, `subject:${slug}`);
  result.blocks.push(subjectBlock);

  // Subject entity (public curriculum view).
  result.candidates.push(
    entity("subject", slug, "public", { subjectCode: slug, courseCode, name, examTrack: matched?.examTrack ?? null }, subjectBlock),
  );

  // Provisional course for a slug absent from the exam_plan code table.
  if (!matched) {
    result.issues.push({
      severity: "warning",
      kind: "unmapped_subject",
      message: `学科 slug 不在 exam_plan 代码表，使用 provisional course_code=${courseCode} + 状态 unmapped: ${slug}`,
      sourcePath: `teacher/subjects/${slug}`,
    });
    result.candidates.push(
      entity(
        "course",
        courseCode,
        "public",
        { courseCode, slug, name, examTrack: null, examStatus: "unmapped" },
        subjectBlock,
      ),
    );
  }

  let syllabusKpCount = 0;
  let progressTotal: number | null = null;
  let progressMastered: number | null = null;
  const kpKeys: string[] = [];

  for (const base of SUBJECT_FILE_BASES) {
    const doc = files[base];
    if (!doc) {
      result.issues.push({
        severity: "warning",
        kind: "per_file_skipped",
        message: `学科缺少文件，已跳过并继续: ${slug}/${base}`,
        sourcePath: `teacher/subjects/${slug}/${base}`,
      });
      continue;
    }
    const lines = splitLines(readFileSync(doc.absPath, "utf8"));
    if (base === "syllabus.md") {
      const r = parseSyllabus(doc.relPath, lines, courseCode);
      result.candidates.push(...r.result.candidates);
      result.blocks.push(...r.result.blocks);
      result.issues.push(...r.result.issues);
      kpKeys.push(...r.kpKeys);
      syllabusKpCount = r.count;
    } else if (base === "progress.md") {
      const r = parseProgress(doc.relPath, lines, courseCode);
      result.candidates.push(...r.result.candidates);
      result.blocks.push(...r.result.blocks);
      result.issues.push(...r.result.issues);
      progressTotal = r.total;
      progressMastered = r.mastered;
    } else if (base === "mistakes.md") {
      const r = parseMistakes(doc.relPath, lines, courseCode);
      result.candidates.push(...r.candidates);
      result.blocks.push(...r.blocks);
      result.issues.push(...r.issues);
    } else {
      const r = parseKeyPoints(doc.relPath, lines, courseCode);
      result.candidates.push(...r.candidates);
      result.blocks.push(...r.blocks);
      result.issues.push(...r.issues);
    }
  }

  return {
    result,
    kpKeys,
    stat: { slug, courseCode, syllabusKpCount, progressTotal, progressMastered },
  };
}
