import type { RawQuestion } from "./parsers/questionBank";

// Minimal parser for the compact-YAML question format used by ai-teacher's
// tools/convert_yaml_to_md.py (top-level list of flat mappings, `|` block
// scalars, inline `[...]` arrays). No real YAML files ship in the snapshot yet,
// so a hand parser for this exact shape beats adding a yaml dependency.
// ponytail: covers the documented compact shape only; swap for a real YAML lib
// if free-form YAML ever needs importing.

type Item = Record<string, string | string[]>;

function stripWrappers(content: string): string {
  const fence = /```ya?ml\s*\n([\s\S]*?)```/.exec(content);
  let body = fence ? fence[1]! : content;
  body = body.replace(/^---\s*$/gm, "");
  return body;
}

function unquote(s: string): string {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

function parseInlineArray(s: string): string[] {
  const t = s.trim();
  try {
    const v = JSON.parse(t);
    if (Array.isArray(v)) return v.map(String);
  } catch {
    /* fall through to naive split */
  }
  return t
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((x) => unquote(x))
    .filter((x) => x.length > 0);
}

export function parseCompactYaml(content: string): Item[] {
  const lines = stripWrappers(content).split(/\r?\n/);
  const items: Item[] = [];
  let cur: Item | null = null;
  let blockKey: string | null = null;
  let blockIndent = 0;
  let blockLines: string[] = [];

  const flushBlock = (): void => {
    if (cur && blockKey) cur[blockKey] = blockLines.join("\n").trim();
    blockKey = null;
    blockLines = [];
  };

  for (const line of lines) {
    if (blockKey) {
      const indent = line.length - line.trimStart().length;
      if (line.trim() === "" || indent > blockIndent) {
        blockLines.push(line.slice(blockIndent + 2));
        continue;
      }
      flushBlock();
    }

    const itemStart = /^-\s+(\w+):\s*(.*)$/.exec(line);
    if (itemStart) {
      if (cur) items.push(cur);
      cur = {};
      assign(cur, itemStart[1]!, itemStart[2]!, 2, () => {
        blockKey = itemStart[1]!;
        blockIndent = 2;
      });
      continue;
    }

    const kv = /^(\s+)(\w+):\s*(.*)$/.exec(line);
    if (kv && cur) {
      const indent = kv[1]!.length;
      assign(cur, kv[2]!, kv[3]!, indent, () => {
        blockKey = kv[2]!;
        blockIndent = indent;
      });
    }
  }
  flushBlock();
  if (cur) items.push(cur);
  return items;
}

function assign(item: Item, key: string, rawValue: string, indent: number, startBlock: () => void): void {
  const v = rawValue.trim();
  if (v === "|" || v === "|-" || v === ">") {
    startBlock();
    return;
  }
  if (v.startsWith("[")) {
    item[key] = parseInlineArray(v);
    return;
  }
  item[key] = unquote(v);
}

export function parseCompactYamlQuestions(content: string, chapterNo: string | null): RawQuestion[] {
  return parseCompactYaml(content).map((it) => {
    const opts = Array.isArray(it.opts) ? it.opts : [];
    const labels = ["A", "B", "C", "D", "E", "F"];
    return {
      id: typeof it.id === "string" ? it.id : null,
      src: typeof it.src === "string" ? it.src : null,
      type: typeof it.type === "string" ? it.type : null,
      kp: typeof it.kp === "string" ? it.kp : null,
      stem: typeof it.q === "string" ? it.q : "",
      options: opts.map((content, i) => ({ label: labels[i] ?? String(i), content })),
      answer: typeof it.ans === "string" ? it.ans : "",
      solution: typeof it.sol === "string" ? it.sol : null,
      chapterNo,
    } satisfies RawQuestion;
  });
}
