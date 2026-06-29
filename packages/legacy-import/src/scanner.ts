import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { Issue, ScannedDoc } from "./types";
import { sha1 } from "./util";

/** Thrown for unrecoverable source-structure problems → caller hard-fails, no partial import. */
export class StructureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StructureError";
  }
}

const CORE_FILES = new Set([
  "learner_profile.md",
  "exam_plan.md",
  "study_plan.md",
  "dashboard.md",
  "review_queue.md",
  "daily_log.md",
  "session_archive.md",
  "phase0_tasks.md",
]);
const SUBJECT_FILES = new Set(["syllabus.md", "progress.md", "mistakes.md", "key_points.md"]);

export type DocKind = "core" | "subject" | "qbank" | "unsupported";

export interface Recognized {
  kind: DocKind;
  /** subject slug for subject/qbank docs. */
  slug?: string;
  /** base filename. */
  base: string;
}

/** Decide which parser (if any) owns a scanned file, by its snapshot-relative path. */
export function recognize(relPath: string): Recognized {
  const parts = relPath.split("/");
  const base = parts[parts.length - 1]!;
  if (parts[0] === "teacher") {
    if (parts.length === 2 && CORE_FILES.has(base)) return { kind: "core", base };
    if (parts[1] === "subjects" && parts.length === 4 && SUBJECT_FILES.has(base)) {
      return { kind: "subject", slug: parts[2], base };
    }
    return { kind: "unsupported", base };
  }
  if (parts[0] === "materials" && parts[2] === "question_bank") {
    if (base === "stats.md" || /^chapter_.*\.md$/.test(base) || /\.ya?ml$/.test(base)) {
      return { kind: "qbank", slug: parts[1], base };
    }
    return { kind: "unsupported", base };
  }
  return { kind: "unsupported", base };
}

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(p));
    else if (entry.isFile()) out.push(p);
  }
  return out;
}

export interface ScanResult {
  docs: ScannedDoc[];
  issues: Issue[];
}

/**
 * Scan teacher/** and materials/* /question_bank/**. Hard-fails on missing /
 * non-directory / empty / both-subtrees-missing; warns when only one subtree is
 * present. Files with no matching parser are recorded as unsupported (never
 * silently dropped). Read-only: never writes the source.
 */
export function scanSnapshot(rootPath: string): ScanResult {
  if (!existsSync(rootPath)) throw new StructureError(`source path does not exist: ${rootPath}`);
  let rootStat;
  try {
    rootStat = statSync(rootPath);
  } catch (err) {
    throw new StructureError(`source path is not readable: ${rootPath} (${String(err)})`);
  }
  if (!rootStat.isDirectory()) throw new StructureError(`source path is not a directory: ${rootPath}`);
  if (readdirSync(rootPath).length === 0) throw new StructureError(`source path is empty: ${rootPath}`);

  const teacherDir = join(rootPath, "teacher");
  const materialsDir = join(rootPath, "materials");
  const hasTeacher = existsSync(teacherDir) && statSync(teacherDir).isDirectory();
  const hasMaterials = existsSync(materialsDir) && statSync(materialsDir).isDirectory();
  if (!hasTeacher && !hasMaterials) {
    throw new StructureError(`invalid structure: neither teacher/ nor materials/ found under ${rootPath}`);
  }

  const issues: Issue[] = [];
  if (!hasTeacher) {
    issues.push({ severity: "warning", kind: "missing_subtree", message: "teacher/ subtree missing — importing materials/ only" });
  }
  if (!hasMaterials) {
    issues.push({ severity: "warning", kind: "missing_subtree", message: "materials/ subtree missing — importing teacher/ only" });
  }

  const absFiles: string[] = [];
  if (hasTeacher) absFiles.push(...listFiles(teacherDir));
  if (hasMaterials) {
    // only descend into each subject's question_bank dir (spec 4.2 scope).
    for (const entry of readdirSync(materialsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const qb = join(materialsDir, entry.name, "question_bank");
      if (existsSync(qb) && statSync(qb).isDirectory()) absFiles.push(...listFiles(qb));
    }
  }

  const docs: ScannedDoc[] = absFiles.map((absPath) => {
    const relPath = relative(rootPath, absPath).split(sep).join("/");
    const rec = recognize(relPath);
    const content = readFileSync(absPath);
    const status = rec.kind === "unsupported" ? "unsupported" : "parsed";
    return {
      absPath,
      relPath,
      doc: {
        id: sha1(`doc:${relPath}`),
        sourcePath: relPath,
        status,
        contentHash: sha1(content),
      },
    };
  });

  return { docs, issues };
}
