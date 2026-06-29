import { createHash } from "node:crypto";

// --- hashing / stable identity ---

export function sha1(input: string | Uint8Array): string {
  return createHash("sha1").update(input).digest("hex");
}

/** Deterministic JSON for content-hashing (sorted keys, undefined dropped). */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = sortKeys(v);
    }
    return out;
  }
  return value;
}

/** content hash of a domain payload — excludes id + the hash field itself. */
export function entityContentHash(payload: Record<string, unknown>): string {
  const { id: _id, contentHash: _ch, ...rest } = payload;
  return sha1(stableStringify(rest));
}

// --- domain constants (calibration knobs) ---

/** The exam term the snapshot is actively preparing for (dashboard countdown). */
export const CURRENT_EXAM_TRACK = "2026-10";
/** The term whose results are already recorded (exam_plan 成绩记录). */
export const PASSED_EXAM_TRACK = "2026-04";

/**
 * Subject directory slug -> { canonical Chinese name, keyword for matching the
 * exam_plan.md code table }. Directory names are English, exam_plan is Chinese,
 * so this alias map is unavoidable. The course_code itself is NOT hardcoded — it
 * is resolved from exam_plan via the keyword (设计决策 2: exam_plan is the SoT).
 */
export const SUBJECT_SLUGS: Record<string, { name: string; keyword: string }> = {
  advanced_math: { name: "高等数学（工本）", keyword: "高等数学" },
  discrete_math: { name: "离散数学", keyword: "离散数学" },
  operating_systems: { name: "操作系统", keyword: "操作系统" },
  computer_systems: { name: "计算机系统原理", keyword: "计算机系统原理" },
  marxism: { name: "马克思主义基本原理", keyword: "马克思主义基本原理" },
  xi_thought: { name: "习近平新时代中国特色社会主义思想概论", keyword: "习近平" },
  modern_history: { name: "中国近现代史纲要", keyword: "中国近现代史纲要" },
  japanese: { name: "第二外语（日语）", keyword: "日语" },
};

/** review_queue.md / 科目 column label -> subject slug. */
export const SUBJECT_LABEL_TO_SLUG: Record<string, string> = {
  近现代史: "modern_history",
  马原: "marxism",
  习概: "xi_thought",
  计算机: "computer_systems",
  高数预热: "advanced_math",
  高数: "advanced_math",
  离散: "discrete_math",
  操作系统: "operating_systems",
  OS: "operating_systems",
  日语: "japanese",
};

/**
 * Looser label list (dashboard 完成度 lines, review_queue 科目 column) -> slug.
 * Order matters: longer/more-specific keywords first.
 */
const EXTENDED_LABELS: [string, string][] = [
  ["离散数学", "discrete_math"],
  ["离散", "discrete_math"],
  ["高等数学", "advanced_math"],
  ["高数预热", "advanced_math"],
  ["高数", "advanced_math"],
  ["操作系统", "operating_systems"],
  ["计算机系统", "computer_systems"],
  ["计算机", "computer_systems"],
  ["CS", "computer_systems"],
  ["马克思", "marxism"],
  ["马原", "marxism"],
  ["习近平", "xi_thought"],
  ["习概", "xi_thought"],
  ["近现代史", "modern_history"],
  ["中国近现代史", "modern_history"],
  ["日语", "japanese"],
  ["第二外语", "japanese"],
  ["OS", "operating_systems"],
];

/** First slug whose label keyword appears in the text. */
export function slugFromLabel(text: string): string | null {
  for (const [label, slug] of EXTENDED_LABELS) {
    if (text.includes(label)) return slug;
  }
  return null;
}

/** progress.md 状态词汇 -> KpState. Unmapped words fall back to "unseen" + warning. */
export function mapKpState(text: string): { state: "unseen" | "taught" | "practiced" | "mastered"; mapped: boolean } {
  // Any 未-prefixed cell that isn't also 已 (e.g. "未测试→已掌握" keeps 已) is "not yet X"
  // → conservative unseen; this wins first so 未学习/未完全掌握 never match a positive
  // substring (mastery inflation). Positive arms require the 已 prefix so non-canonical
  // tokens like 部分掌握 fall through to unmapped+warning rather than inflating to mastered.
  if (/未/.test(text) && !/已/.test(text)) return { state: "unseen", mapped: true };
  if (/已掌握/.test(text)) return { state: "mastered", mapped: true };
  if (/已练习/.test(text)) return { state: "practiced", mapped: true };
  if (/已学习/.test(text)) return { state: "taught", mapped: true };
  return { state: "unseen", mapped: false };
}

/** Dashboard countdown 日期 ("10/24 周六" / "2026-10-24") + track ("2026-10") -> ISO date. */
export function dashboardDateToIso(dateText: string, track: string): string | null {
  const iso = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(dateText);
  if (iso) return `${iso[1]}-${iso[2]!.padStart(2, "0")}-${iso[3]!.padStart(2, "0")}`;
  const slash = /(\d{1,2})\s*[/／]\s*(\d{1,2})/.exec(dateText);
  const yr = /^(\d{4})/.exec(track);
  if (!slash || !yr) return null;
  return `${yr[1]}-${slash[1]!.padStart(2, "0")}-${slash[2]!.padStart(2, "0")}`;
}

/** "2026年10月" / "2026-10" -> "2026-10". Returns null if unparseable. */
export function termToTrack(text: string | null | undefined): string | null {
  if (!text) return null;
  const cn = /(\d{4})\s*年\s*(\d{1,2})\s*月/.exec(text);
  if (cn) return `${cn[1]}-${cn[2]!.padStart(2, "0")}`;
  const iso = /(\d{4})-(\d{1,2})/.exec(text);
  if (iso) return `${iso[1]}-${iso[2]!.padStart(2, "0")}`;
  return null;
}

/** First knowledge-point code in a string, e.g. "DM01-02", "AM-P0-D1-01", "X13-XX". */
export function firstKpCode(text: string): string | null {
  const m = /\b([A-Z]{1,3}(?:-?[A-Z0-9]+)*-[A-Z0-9]+)\b/.exec(text);
  return m ? m[1]! : null;
}

/** Chapter segment of a kp code -> normalized chapter no. "AM01-04" -> "1", "H00-01" -> "0". */
export function chapterNoFromKpCode(code: string): string | null {
  const m = /^[A-Z]{1,3}(\d{1,2})-/.exec(code);
  if (!m) return null;
  return String(parseInt(m[1]!, 10));
}
