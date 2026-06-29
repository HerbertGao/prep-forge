// Server-only admin import-report data-access layer (tasks 6.1–6.3).
//
// Mirrors lib/seed.ts: DB-first via createDb(); falls back to a tiny fixture
// when the DB is unreachable OR has no import runs, so `next build` works with
// no database. Read-only — Phase 0 admin does not edit/approve/publish anything.
import { desc, eq } from "drizzle-orm";
import { createDb, schema } from "@prep-forge/db";
import type { Origin } from "@prep-forge/schemas";
import type { SeedSource } from "./types";

/** One import batch with its scanned/parsed/quarantine/warning aggregates (6.1). */
export type ImportRunReport = {
  id: string;
  sourceRepo: string | null;
  sourceRef: string | null;
  sourceRootPath: string;
  dryRun: boolean;
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  scanned: number; // source_documents for this run
  parsed: number; // source_documents status=parsed (解析成功数)
  unsupported: number; // source_documents status=unsupported
  published: number; // imported_entities published in this run
  quarantine: number; // import_errors severity=quarantine
  errors: number; // import_errors severity=error
  warnings: { kind: string; message: string }[];
};

/** An unparsable source block — import_errors row backfilled from source_blocks (6.2). */
export type ExceptionBlock = {
  id: string;
  runId: string;
  severity: "error" | "quarantine";
  kind: string;
  message: string;
  sourcePath: string | null;
  headingPath: string[] | null;
  rawBlock: string | null;
};

/** Published-entity counts per (entityType, origin) — drives the origin legend (6.3). */
export type OriginRow = { entityType: string; origin: Origin; count: number };

export type AdminReport = {
  source: SeedSource;
  runs: ImportRunReport[];
  exceptions: ExceptionBlock[];
  originCounts: Record<Origin, number>;
  originByType: OriginRow[];
};

export const ORIGINS: Origin[] = ["imported", "system", "ai_generated"];

function fmt(d: Date | null): string | null {
  // Phase 0 admin only needs ordering + an at-a-glance stamp.
  return d ? d.toISOString().slice(0, 16).replace("T", " ") : null;
}

async function readReport(
  db: ReturnType<typeof createDb>,
): Promise<Omit<AdminReport, "source">> {
  const [runs, docs, errs, entities] = await Promise.all([
    db.select().from(schema.importRuns).orderBy(desc(schema.importRuns.startedAt)),
    db
      .select({ runId: schema.sourceDocuments.importRunId, status: schema.sourceDocuments.status })
      .from(schema.sourceDocuments),
    // import_errors is the SoT for each error row, but join source_blocks to
    // backfill path/heading/raw when an error carries only a sourceBlockId.
    db
      .select({ err: schema.importErrors, block: schema.sourceBlocks })
      .from(schema.importErrors)
      .leftJoin(schema.sourceBlocks, eq(schema.importErrors.sourceBlockId, schema.sourceBlocks.id)),
    db
      .select({
        origin: schema.importedEntities.origin,
        entityType: schema.importedEntities.entityType,
        naturalKey: schema.importedEntities.naturalKey,
        runId: schema.importedEntities.importRunId,
      })
      .from(schema.importedEntities)
      .where(eq(schema.importedEntities.status, "published")),
  ]);

  const docsByRun = new Map<string, { scanned: number; parsed: number; unsupported: number }>();
  for (const d of docs) {
    const r = docsByRun.get(d.runId) ?? { scanned: 0, parsed: 0, unsupported: 0 };
    r.scanned += 1;
    if (d.status === "parsed") r.parsed += 1;
    else if (d.status === "unsupported") r.unsupported += 1;
    docsByRun.set(d.runId, r);
  }

  const originCounts: Record<Origin, number> = { imported: 0, system: 0, ai_generated: 0 };
  const pubByRun = new Map<string, number>();
  const byType = new Map<string, OriginRow>();
  // imported_entities is keyed per-run (${runId}#…), so a re-import duplicates
  // these rows while the canonical domain tables stay constant. Count the
  // origin legend over DISTINCT (entityType, naturalKey) so it never doubles;
  // the per-run published count (pubByRun) intentionally stays per-run.
  const seenEntity = new Set<string>();
  for (const en of entities) {
    pubByRun.set(en.runId, (pubByRun.get(en.runId) ?? 0) + 1);
    const dedupKey = `${en.entityType}#${en.naturalKey}`;
    if (seenEntity.has(dedupKey)) continue;
    seenEntity.add(dedupKey);
    originCounts[en.origin] += 1;
    const key = `${en.entityType}|${en.origin}`;
    const row = byType.get(key) ?? { entityType: en.entityType, origin: en.origin, count: 0 };
    row.count += 1;
    byType.set(key, row);
  }

  const errAgg = new Map<
    string,
    { quarantine: number; errors: number; warnings: { kind: string; message: string }[] }
  >();
  const exceptions: ExceptionBlock[] = [];
  for (const { err, block } of errs) {
    const a = errAgg.get(err.importRunId) ?? { quarantine: 0, errors: 0, warnings: [] };
    if (err.severity === "warning") {
      a.warnings.push({ kind: err.kind, message: err.message });
    } else {
      if (err.severity === "quarantine") a.quarantine += 1;
      else a.errors += 1;
      exceptions.push({
        id: err.id,
        runId: err.importRunId,
        severity: err.severity,
        kind: err.kind,
        message: err.message,
        sourcePath: err.sourcePath ?? block?.sourcePath ?? null,
        headingPath:
          (err.headingPath as string[] | null) ?? (block?.headingPath as string[] | null) ?? null,
        rawBlock: err.rawBlock ?? block?.rawBlock ?? null,
      });
    }
    errAgg.set(err.importRunId, a);
  }

  const runReports: ImportRunReport[] = runs.map((run) => {
    const d = docsByRun.get(run.id) ?? { scanned: 0, parsed: 0, unsupported: 0 };
    const e = errAgg.get(run.id) ?? { quarantine: 0, errors: 0, warnings: [] };
    return {
      id: run.id,
      sourceRepo: run.sourceRepo,
      sourceRef: run.sourceRef,
      sourceRootPath: run.sourceRootPath,
      dryRun: run.dryRun,
      status: run.status,
      startedAt: fmt(run.startedAt),
      finishedAt: fmt(run.finishedAt),
      scanned: d.scanned,
      parsed: d.parsed,
      unsupported: d.unsupported,
      published: pubByRun.get(run.id) ?? 0,
      quarantine: e.quarantine,
      errors: e.errors,
      warnings: e.warnings,
    };
  });

  return {
    runs: runReports,
    exceptions,
    originCounts,
    originByType: [...byType.values()].sort((a, b) => b.count - a.count),
  };
}

export async function loadImportReport(): Promise<AdminReport> {
  try {
    const db = createDb(); // throws if DATABASE_URL unset (the common no-DB case)
    const r = await readReport(db);
    if (r.runs.length === 0) return { source: "fixture", ...ADMIN_FIXTURE };
    return { source: "db", ...r };
  } catch (e) {
    // DB unreachable / bad URL / empty -> non-acceptance fixture render. Log so a
    // broken/partial DB is diagnosable instead of silently masked by the fixture.
    console.error("[admin] DB read failed, falling back to fixture:", e);
    return { source: "fixture", ...ADMIN_FIXTURE };
  }
}

// Minimal fixture — NOT an acceptance source; only lets the admin page render
// (and `next build`) with no DB. The page banner labels the source as fixture.
const ADMIN_FIXTURE: Omit<AdminReport, "source"> = {
  runs: [
    {
      id: "run:fixture",
      sourceRepo: "HerbertGao/ai-teacher",
      sourceRef: "snapshot",
      sourceRootPath: "(fixture)",
      dryRun: false,
      status: "completed",
      startedAt: "2026-06-29 00:00",
      finishedAt: "2026-06-29 00:01",
      scanned: 42,
      parsed: 39,
      unsupported: 2,
      published: 119,
      quarantine: 1,
      errors: 1,
      warnings: [
        { kind: "progress_drift", message: "离散数学(02324) 完成数：dashboard.md 记 0、progress.md 记 1。" },
        { kind: "stats_mismatch", message: "离散数学(02324) stats.md 声称 120 题，实际解析 118 题。" },
      ],
    },
  ],
  exceptions: [
    {
      id: "err:fixture:1",
      runId: "run:fixture",
      severity: "quarantine",
      kind: "unparsable_question",
      message: "题块缺少答案区，无法解析为 Question，已隔离。",
      sourcePath: "teacher/subjects/02324/question_bank/chapter_03.md",
      headingPath: ["第三章 图论", "题 12"],
      rawBlock: "12. 设 G 为简单图，证明……（原文缺答案与解析区）",
    },
    {
      id: "err:fixture:2",
      runId: "run:fixture",
      severity: "error",
      kind: "dangling_review_ref",
      message: "review_queue 项无法映射到知识点 DM09-99（该知识点不存在）。",
      sourcePath: "teacher/review_queue.md",
      headingPath: ["待复习队列"],
      rawBlock: "- [ ] DM09-99 复习命题逻辑等值演算",
    },
  ],
  originCounts: { imported: 119, system: 1, ai_generated: 0 },
  originByType: [
    { entityType: "question", origin: "imported", count: 80 },
    { entityType: "knowledge_point", origin: "imported", count: 30 },
    { entityType: "course", origin: "imported", count: 8 },
    { entityType: "exam_track", origin: "imported", count: 1 },
    { entityType: "lesson_packet", origin: "system", count: 1 },
  ],
};
