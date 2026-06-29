import type { BlockDraft } from "./types";
import { sha1 } from "./util";

// Lightweight Markdown structure helpers. The ai-teacher files are regular
// enough (ATX headings, pipe tables, `- ` lists) that a hand parser beats
// pulling in remark/unified for Phase 0. Anything that does NOT parse cleanly is
// preserved as a raw block by the caller (设计决策: never silently drop).

export interface Heading {
  level: number;
  text: string;
  line: number; // 0-based index
}

/** Stable source_block identity = sourcePath + headingPath + normalizedKey. */
export function makeBlock(
  relPath: string,
  headingPath: string[],
  normalizedKey: string,
  lineRange: { start: number; end: number },
  rawBlock: string,
): BlockDraft {
  const id = sha1(`${relPath}|${headingPath.join(">")}|${normalizedKey}`);
  return {
    id,
    sourcePath: relPath,
    headingPath,
    normalizedKey,
    lineRange,
    rawBlock,
    contentHash: sha1(rawBlock),
  };
}

export function splitLines(content: string): string[] {
  return content.split(/\r?\n/);
}

function headingOf(line: string): { level: number; text: string } | null {
  const m = /^(#{1,6})\s+(.*)$/.exec(line);
  if (!m) return null;
  return { level: m[1]!.length, text: m[2]!.trim() };
}

/**
 * One block per heading section: from the heading line until the next heading.
 * headingPath is the ancestor heading stack (by level). The pre-heading preamble
 * (if any) becomes a "preamble" block. Good provenance granularity for files
 * like daily_log.md whose `### YYYY-MM-DD` sections map 1:1 to blocks.
 */
export function sectionBlocks(relPath: string, lines: string[]): BlockDraft[] {
  const blocks: BlockDraft[] = [];
  const stack: Heading[] = [];

  // collect heading indices
  const headings: Heading[] = [];
  lines.forEach((line, i) => {
    const h = headingOf(line);
    if (h) headings.push({ ...h, line: i });
  });

  // preamble before first heading
  const firstLine = headings[0]?.line ?? lines.length;
  if (firstLine > 0) {
    const raw = lines.slice(0, firstLine).join("\n");
    if (raw.trim()) {
      blocks.push(makeBlock(relPath, [], "preamble", { start: 0, end: firstLine - 1 }, raw));
    }
  }

  for (let h = 0; h < headings.length; h++) {
    const cur = headings[h]!;
    const next = headings[h + 1];
    const end = next ? next.line - 1 : lines.length - 1;
    while (stack.length && stack[stack.length - 1]!.level >= cur.level) stack.pop();
    const headingPath = stack.map((s) => s.text);
    const raw = lines.slice(cur.line, end + 1).join("\n");
    blocks.push(makeBlock(relPath, headingPath, cur.text, { start: cur.line, end }, raw));
    stack.push(cur);
  }

  return blocks;
}

export interface Table {
  header: string[];
  rows: string[][];
  /** 0-based line range of the whole table. */
  start: number;
  end: number;
}

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

const isTableLine = (line: string): boolean => /^\s*\|/.test(line);
const isSeparator = (line: string): boolean => /^\s*\|?[\s:|-]+\|?\s*$/.test(line) && line.includes("-");

/** Find all pipe tables (header + `---` separator + rows). */
export function findTables(lines: string[]): Table[] {
  const tables: Table[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!isTableLine(lines[i]!)) continue;
    const sep = lines[i + 1];
    if (sep === undefined || !isSeparator(sep)) continue;
    const header = splitRow(lines[i]!);
    const rows: string[][] = [];
    let j = i + 2;
    for (; j < lines.length; j++) {
      if (!isTableLine(lines[j]!)) break;
      if (isSeparator(lines[j]!)) continue;
      rows.push(splitRow(lines[j]!));
    }
    tables.push({ header, rows, start: i, end: j - 1 });
    i = j - 1;
  }
  return tables;
}

/** Column index whose header matches any of the patterns. */
export function colIndex(header: string[], ...patterns: RegExp[]): number {
  return header.findIndex((h) => patterns.some((p) => p.test(h)));
}
