import { readFileSync } from "node:fs";
import type { BlockDraft, Candidate, ParseResult, ScannedDoc } from "../types";
import { emptyResult } from "../types";
import { colIndex, findTables, makeBlock, sectionBlocks, splitLines } from "../markdown";
import { entityContentHash, firstKpCode, sha1 } from "../util";
import { parseCompactYamlQuestions } from "../yaml";

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
    visibility: "public",
    sourceBlockId: block.id,
    ...fields,
  };
  payload.contentHash = entityContentHash(payload);
  return { entityType, naturalKey, visibility: "public", payload, block };
}

export interface RawQuestion {
  id: string | null;
  src: string | null;
  type: string | null;
  kp: string | null;
  stem: string;
  options: { label: string; content: string }[];
  answer: string;
  solution: string | null;
  chapterNo: string | null;
}

function chapterNoFromName(base: string): string | null {
  const m = /chapter_0*(\d+)/.exec(base);
  return m ? m[1]! : null;
}

function field(raw: string, label: string): string | null {
  const m = new RegExp(`\\*\\*${label}[：:]\\*\\*\\s*(.*)`).exec(raw);
  return m ? m[1]!.replace(/\*\*/g, "").trim() : null;
}

function section(raw: string, label: string): string | null {
  const idx = raw.indexOf(`**${label}：**`);
  if (idx < 0) return null;
  return raw.slice(idx + `**${label}：**`.length);
}

function parseOptions(region: string): { label: string; content: string }[] {
  const opts: { label: string; content: string }[] = [];
  const parts = region.split(/&emsp;|\n/);
  for (const part of parts) {
    const m = /^\s*([A-D])[.。．、]\s*(.+?)\s*$/.exec(part);
    if (m) opts.push({ label: m[1]!, content: m[2]!.trim() });
  }
  return opts;
}

/** Parse one `### Q-...` markdown block into a RawQuestion. */
function parseMdQuestion(raw: string, chapterNo: string | null): RawQuestion | null {
  const idM = /^###\s+(Q-[0-9A-Za-z-]+)/m.exec(raw);
  const src = field(raw, "来源");
  const type = field(raw, "题型");
  const kp = firstKpCode(field(raw, "知识点") ?? "");
  const answer = (field(raw, "答案") ?? "").trim();

  const stemSec = section(raw, "题目") ?? "";
  // stem = up to 答案/解析/options
  const stemEnd = Math.min(
    ...["**答案", "**解析", "**Answer"].map((m) => {
      const i = stemSec.indexOf(m);
      return i < 0 ? stemSec.length : i;
    }),
  );
  const stemRegion = stemSec.slice(0, stemEnd);
  const options = parseOptions(stemRegion);
  // stem text excludes option fragments
  const stem = stemRegion
    .split(/\n/)
    .filter((l) => !/^\s*[A-D][.。．、]/.test(l) && !/&emsp;\s*[A-D][.。．、]/.test(l))
    .join("\n")
    .trim();

  const solRegion = section(raw, "解析");
  const solution = solRegion ? solRegion.trim() || null : null;

  if (!stem) return null;
  return {
    id: idM ? idM[1]! : null,
    src,
    type,
    kp,
    stem,
    options,
    answer,
    solution,
    chapterNo,
  };
}

function emitQuestion(
  rq: RawQuestion,
  courseCode: string,
  seq: number,
  block: BlockDraft,
  out: ParseResult,
): void {
  const stemHash = sha1(rq.stem);
  const src = rq.src ?? "unknown";
  const questionId = rq.id ?? `${rq.chapterNo ?? "0"}-${seq}`;
  const naturalKey =
    rq.id && rq.src
      ? `${courseCode}:${src}:${questionId}`
      : `${courseCode}:${stemHash}:${rq.chapterNo ?? "0"}:${seq}`;
  const qid = `question#${naturalKey}`;

  out.candidates.push(
    entity(
      "question",
      naturalKey,
      {
        courseCode,
        src,
        questionId,
        stemHash,
        chapterNo: rq.chapterNo,
        sequence: seq,
        stem: rq.stem,
        type: rq.type ?? "未知",
      },
      block,
    ),
  );
  for (const opt of rq.options) {
    out.candidates.push(
      entity(
        "question_option",
        `${naturalKey}:opt:${opt.label}`,
        { questionId: qid, label: opt.label, content: opt.content, isCorrect: rq.answer.includes(opt.label) },
        block,
      ),
    );
  }
  if (rq.answer || rq.solution) {
    out.candidates.push(
      entity(
        "question_solution",
        `${naturalKey}:sol`,
        { questionId: qid, answer: rq.answer, explanation: rq.solution },
        block,
      ),
    );
  }
  if (rq.kp) {
    out.candidates.push(
      entity(
        "question_kp_link",
        `${naturalKey}:kp:${rq.kp}`,
        { questionId: qid, courseCode, kpCode: rq.kp },
        block,
      ),
    );
  }
}

function parseStats(
  relPath: string,
  lines: string[],
  courseCode: string,
  parsedCount: number,
): { result: ParseResult; declared: number | null } {
  const result = emptyResult();
  const block = makeBlock(relPath, ["stats"], "stats", { start: 0, end: lines.length - 1 }, lines.join("\n"));
  let declared: number | null = null;
  const typeDistribution: { type: string; count: number }[] = [];

  for (const t of findTables(lines)) {
    for (const row of t.rows) {
      const label = row[0] ?? "";
      const num = parseInt((row[1] ?? "").replace(/[^0-9]/g, ""), 10);
      if (/总题数/.test(label) && !Number.isNaN(num)) declared = num;
    }
    const cType = colIndex(t.header, /题型/);
    const cCount = colIndex(t.header, /题数/);
    if (cType >= 0 && cCount >= 0) {
      for (const row of t.rows) {
        const type = (row[cType] ?? "").trim();
        const count = parseInt((row[cCount] ?? "").replace(/[^0-9]/g, ""), 10);
        if (type && !Number.isNaN(count)) typeDistribution.push({ type, count });
      }
    }
  }

  result.blocks.push(block);
  result.candidates.push(
    entity(
      "question_bank_stats",
      `${courseCode}`,
      { courseCode, src: null, declaredCount: declared, parsedCount, typeDistribution: typeDistribution.length ? typeDistribution : undefined },
      block,
    ),
  );
  return { result, declared };
}

export interface QuestionBankResult {
  result: ParseResult;
  /** declared (stats.md 总题数) vs actually parsed, for cross-file warning. */
  declared: number | null;
  parsed: number;
}

/** Parse one subject's question_bank: stats.md + chapter_*.md + compact YAML. */
export function parseQuestionBank(
  slug: string,
  courseCode: string,
  files: ScannedDoc[],
): QuestionBankResult {
  const result = emptyResult();
  let seq = 0;
  let parsed = 0;

  // chapters + yaml first (so stats can record parsedCount)
  for (const doc of files) {
    const base = doc.relPath.split("/").pop()!;
    if (base === "stats.md") continue;
    const content = readFileSync(doc.absPath, "utf8");
    const lines = splitLines(content);
    const chapterNo = chapterNoFromName(base);

    if (/\.ya?ml$/.test(base)) {
      const block = makeBlock(doc.relPath, ["yaml"], "yaml_bank", { start: 0, end: lines.length - 1 }, content);
      result.blocks.push(block);
      for (const rq of parseCompactYamlQuestions(content, chapterNo)) {
        seq += 1;
        parsed += 1;
        emitQuestion(rq, courseCode, seq, block, result);
      }
      continue;
    }

    for (const block of sectionBlocks(doc.relPath, lines)) {
      if (!/^Q-/.test(block.normalizedKey)) continue;
      const rq = parseMdQuestion(block.rawBlock, chapterNo);
      if (!rq) {
        // Persist the block so the FULL raw question survives in source_blocks;
        // the 400-char slice is only the quarantine issue's display summary.
        result.blocks.push(block);
        result.issues.push({
          severity: "quarantine",
          kind: "unparseable_question",
          message: `题目无法稳定解析，保留原文: ${doc.relPath} / ${block.normalizedKey}`,
          sourcePath: doc.relPath,
          headingPath: block.headingPath,
          sourceBlockId: block.id,
          rawBlock: block.rawBlock.slice(0, 400),
        });
        continue;
      }
      result.blocks.push(block);
      seq += 1;
      parsed += 1;
      emitQuestion(rq, courseCode, seq, block, result);
    }
  }

  // stats.md last (records parsedCount)
  let declared: number | null = null;
  const statsDoc = files.find((d) => d.relPath.endsWith("stats.md"));
  if (statsDoc) {
    const r = parseStats(statsDoc.relPath, splitLines(readFileSync(statsDoc.absPath, "utf8")), courseCode, parsed);
    result.candidates.push(...r.result.candidates);
    result.blocks.push(...r.result.blocks);
    result.issues.push(...r.result.issues);
    declared = r.declared;
  }

  return { result, declared, parsed };
}
