import { readFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import type { ImportReport, SourceBlock } from "@prep-forge/schemas";
import { createDb, publishStaged, schema, stageEntities, type Database } from "@prep-forge/db";
import type { BlockDraft, Candidate, Issue, ScannedDoc } from "./types";
import { scanSnapshot } from "./scanner";
import { parseExamPlan, type ExamPlanContext } from "./examPlan";
import { parseSubject, type SubjectStat } from "./parsers/subjects";
import { parseQuestionBank } from "./parsers/questionBank";
import {
  parseDailyLog,
  parseDashboard,
  parseLearnerProfile,
  parsePhase0Tasks,
  parseReviewQueue,
  parseSessionArchive,
  parseStudyPlan,
  type DashboardData,
} from "./parsers/core";
import { crossFileWarnings, type QbankStat } from "./crossfile";
import { SUBJECT_SLUGS, sha1 } from "./util";

export interface ParseSnapshotResult {
  documents: ScannedDoc[];
  candidates: Candidate[];
  blocks: BlockDraft[];
  issues: Issue[];
  subjectStats: SubjectStat[];
  qbankStats: QbankStat[];
}

function docId(sourcePath: string): string {
  return sha1(`doc:${sourcePath}`);
}

// drizzle builds one giant nested SQL per .values([...]) — a 67k-row insert
// overflows the call stack. Insert in chunks. ponytail: 500 is safely under the
// recursion ceiling; raise only if a profiler says inserts dominate.
const CHUNK = 500;
function chunk<T>(rows: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/** Pure parse: scan → blocks → parse → classify → cross-file warnings. No DB. */
export function parseSnapshot(rootPath: string): ParseSnapshotResult {
  const scan = scanSnapshot(rootPath);
  const issues: Issue[] = [...scan.issues];
  const candidates: Candidate[] = [];
  const blocks: BlockDraft[] = [];

  const byRel = new Map(scan.docs.map((d) => [d.relPath, d]));
  const core = (name: string): ScannedDoc | undefined => byRel.get(`teacher/${name}`);

  // subject docs grouped by slug
  const subjectDocs = new Map<string, Record<string, ScannedDoc>>();
  const qbankDocs = new Map<string, ScannedDoc[]>();
  for (const d of scan.docs) {
    const parts = d.relPath.split("/");
    if (parts[0] === "teacher" && parts[1] === "subjects" && parts.length === 4) {
      const slug = parts[2]!;
      (subjectDocs.get(slug) ?? subjectDocs.set(slug, {}).get(slug)!)[parts[3]!] = d;
    } else if (parts[0] === "materials" && parts[2] === "question_bank") {
      const slug = parts[1]!;
      (qbankDocs.get(slug) ?? qbankDocs.set(slug, []).get(slug)!).push(d);
    }
  }

  // dashboard first (gives current-term codes + cross-file totals)
  let dashboard: DashboardData | undefined;
  const dashDoc = core("dashboard.md");
  if (dashDoc) {
    const r = parseDashboard(dashDoc);
    candidates.push(...r.result.candidates);
    blocks.push(...r.result.blocks);
    issues.push(...r.result.issues);
    dashboard = r.data;
  }
  const currentTermCodes = dashboard?.currentTermCodes ?? new Set<string>();

  // exam_plan → curriculum context
  let ctx: ExamPlanContext = { courses: [], resolveCode: () => null, block: { id: "", sourcePath: "", headingPath: [], normalizedKey: "", lineRange: { start: 0, end: 0 }, rawBlock: "", contentHash: "" } };
  const examDoc = core("exam_plan.md");
  if (examDoc) {
    const r = parseExamPlan(examDoc.absPath, examDoc.relPath, currentTermCodes, dashboard?.examDates);
    candidates.push(...r.result.candidates);
    blocks.push(...r.result.blocks);
    issues.push(...r.result.issues);
    ctx = r.ctx;
  } else {
    issues.push({ severity: "warning", kind: "missing_core_file", message: "缺少 teacher/exam_plan.md — 课程将使用 provisional code" });
  }

  // subjects → KP catalog + slug→course
  const kpCatalog = new Set<string>();
  const slugToCourse = new Map<string, string>();
  const subjectStats: SubjectStat[] = [];
  for (const [slug, files] of subjectDocs) {
    const r = parseSubject(slug, files, ctx);
    candidates.push(...r.result.candidates);
    blocks.push(...r.result.blocks);
    issues.push(...r.result.issues);
    for (const k of r.kpKeys) kpCatalog.add(k);
    slugToCourse.set(slug, r.stat.courseCode);
    subjectStats.push(r.stat);
  }

  // question banks
  const qbankStats: QbankStat[] = [];
  for (const [slug, files] of qbankDocs) {
    let courseCode = slugToCourse.get(slug);
    if (!courseCode) {
      const alias = SUBJECT_SLUGS[slug];
      const matched = alias ? ctx.resolveCode(alias.keyword) : null;
      courseCode = matched?.code ?? `PROV-${slug}`;
      if (!matched) {
        issues.push({ severity: "warning", kind: "unmapped_subject", message: `题库 slug 无对应课程，使用 ${courseCode}: ${slug}`, sourcePath: `materials/${slug}/question_bank` });
      }
    }
    const r = parseQuestionBank(slug, courseCode, files);
    candidates.push(...r.result.candidates);
    blocks.push(...r.result.blocks);
    issues.push(...r.result.issues);
    qbankStats.push({ courseCode, declared: r.declared, parsed: r.parsed });
  }

  // remaining core files
  const profileDoc = core("learner_profile.md");
  if (profileDoc) push(parseLearnerProfile(profileDoc));
  const studyDoc = core("study_plan.md");
  if (studyDoc) push(parseStudyPlan(studyDoc));
  const phase0Doc = core("phase0_tasks.md");
  if (phase0Doc) push(parsePhase0Tasks(phase0Doc));
  const archiveDoc = core("session_archive.md");
  if (archiveDoc) push(parseSessionArchive(archiveDoc));
  const dailyDoc = core("daily_log.md");
  if (dailyDoc) push(parseDailyLog(dailyDoc));
  const reviewDoc = core("review_queue.md");
  if (reviewDoc) push(parseReviewQueue(reviewDoc, kpCatalog, slugToCourse));

  function push(r: { candidates: Candidate[]; blocks: BlockDraft[]; issues: Issue[] }): void {
    candidates.push(...r.candidates);
    blocks.push(...r.blocks);
    issues.push(...r.issues);
  }

  // cross-file warnings (4.11)
  issues.push(
    ...crossFileWarnings({
      dashboard,
      subjectStats,
      qbankStats,
      slugToCourse,
      studyPlanContent: studyDoc ? readFileSync(studyDoc.absPath, "utf8") : undefined,
    }),
  );

  return { documents: scan.docs, candidates, blocks, issues, subjectStats, qbankStats };
}

// --- counts (idempotency-aware) ---

interface Counts {
  created: number;
  updated: number;
  skipped: number;
}

/** Dedup candidates by stable entity key (entityType#naturalKey), last wins. */
function dedupCandidates(candidates: Candidate[]): Candidate[] {
  const map = new Map<string, Candidate>();
  for (const c of candidates) map.set(`${c.entityType}#${c.naturalKey}`, c);
  return [...map.values()];
}

async function diffCounts(db: Database | null, candidates: Candidate[]): Promise<Counts> {
  const unique = dedupCandidates(candidates);
  if (!db) return { created: unique.length, updated: 0, skipped: 0 };
  const prior = await db
    .select({ entityType: schema.importedEntities.entityType, naturalKey: schema.importedEntities.naturalKey, contentHash: schema.importedEntities.contentHash })
    .from(schema.importedEntities);
  const priorHash = new Map<string, string>();
  for (const p of prior) priorHash.set(`${p.entityType}#${p.naturalKey}`, p.contentHash);

  let created = 0;
  let updated = 0;
  let skipped = 0;
  for (const c of unique) {
    const key = `${c.entityType}#${c.naturalKey}`;
    const prev = priorHash.get(key);
    const hash = String(c.payload.contentHash);
    if (prev === undefined) created += 1;
    else if (prev !== hash) updated += 1;
    else skipped += 1;
  }
  return { created, updated, skipped };
}

// --- persistence ---

async function persist(db: Database, runId: string, parsed: ParseSnapshotResult, rootPath: string): Promise<void> {
  await db.insert(schema.importRuns).values({ id: runId, sourceRootPath: rootPath, dryRun: false, status: "running" }).onConflictDoNothing();

  // source_documents (scanned + any synthetic paths referenced by blocks)
  const blockPaths = new Set<string>();
  for (const b of [...parsed.blocks, ...parsed.candidates.map((c) => c.block)]) blockPaths.add(b.sourcePath);
  const docByPath = new Map(parsed.documents.map((d) => [d.relPath, d]));
  const docRows = [...blockPaths].map((p) => {
    const d = docByPath.get(p);
    return { id: docId(p), importRunId: runId, sourcePath: p, status: d?.doc.status ?? ("parsed" as const), contentHash: d?.doc.contentHash ?? null };
  });
  // also include scanned docs not referenced by any block (unsupported files)
  for (const d of parsed.documents) {
    if (!blockPaths.has(d.relPath)) docRows.push({ id: d.doc.id, importRunId: runId, sourcePath: d.relPath, status: d.doc.status, contentHash: d.doc.contentHash ?? null });
  }
  // Provenance model: source_documents + source_blocks are the CURRENT scan snapshot,
  // re-tagged to the latest run (onConflictDoUpdate), so the admin per-run report (which
  // groups source_documents by importRunId) shows the current import's real scanned/parsed
  // counts instead of 0. Per-run audit history lives in import_runs + the per-run
  // imported_entities ledger; per-run block *versioning* is deferred (Phase-1).
  for (const c of chunk(dedupById(docRows)))
    await db
      .insert(schema.sourceDocuments)
      .values(c)
      .onConflictDoUpdate({
        target: schema.sourceDocuments.id,
        set: {
          status: sqlExcluded("status"),
          contentHash: sqlExcluded("content_hash"),
          importRunId: runId,
        },
      });

  // source_blocks (current-snapshot, latest run wins — see provenance note above)
  const blockMap = new Map<string, SourceBlock>();
  for (const b of [...parsed.blocks, ...parsed.candidates.map((c) => c.block)]) {
    blockMap.set(b.id, { ...b, importRunId: runId, sourceDocumentId: docId(b.sourcePath) });
  }
  for (const c of chunk([...blockMap.values()])) {
    await db
      .insert(schema.sourceBlocks)
      .values(c)
      .onConflictDoUpdate({
        target: schema.sourceBlocks.id,
        set: { contentHash: sqlExcluded("content_hash"), rawBlock: sqlExcluded("raw_block"), lineRange: sqlExcluded("line_range"), importRunId: runId },
      });
  }

  // import_errors
  const errorRows = dedupById(
    parsed.issues.map((i) => ({
      id: sha1(`${runId}|${i.kind}|${i.message}|${i.sourcePath ?? ""}|${i.rawBlock ?? ""}`),
      importRunId: runId,
      sourceDocumentId: i.sourcePath && docByPath.has(i.sourcePath) ? docId(i.sourcePath) : null,
      sourceBlockId: i.sourceBlockId ?? null,
      sourcePath: i.sourcePath ?? null,
      headingPath: i.headingPath ?? null,
      rawBlock: i.rawBlock ?? null,
      severity: i.severity,
      kind: i.kind,
      message: i.message,
    })),
  );
  for (const c of chunk(errorRows)) await db.insert(schema.importErrors).values(c).onConflictDoNothing();

  // stage + publish
  const stagedRows = dedupCandidates(parsed.candidates).map((c) => ({
    id: `${runId}#${c.entityType}#${c.naturalKey}`,
    origin: c.payload.origin,
    visibility: c.visibility,
    importRunId: runId,
    sourceBlockId: c.block.id,
    entityType: c.entityType,
    naturalKey: c.naturalKey,
    contentHash: String(c.payload.contentHash),
    status: "staged" as const,
    payload: c.payload,
  }));
  for (const c of chunk(stagedRows)) await stageEntities(db, c);
  // Canonical publish + completion happen in runImport AFTER the report is built
  // (the report is generated before the domain tables are written).
}

function dedupById<T extends { id: string }>(rows: T[]): T[] {
  const m = new Map<string, T>();
  for (const r of rows) m.set(r.id, r);
  return [...m.values()];
}

// tiny drizzle helpers kept local to avoid leaking sql into parsers
function eqRun(id: string) {
  return eq(schema.importRuns.id, id);
}
function sqlExcluded(col: string) {
  return sql.raw(`excluded.${col}`);
}

// --- public entry ---

export interface ImportOptions {
  source: string;
  dryRun: boolean;
  databaseUrl?: string;
}

export interface ImportOutcome {
  runId: string;
  report: ImportReport;
  parsed: ParseSnapshotResult;
  persisted: boolean;
}

function tryCreateDb(url?: string): Database | null {
  try {
    return createDb(url);
  } catch {
    return null;
  }
}

export async function runImport(options: ImportOptions): Promise<ImportOutcome> {
  const parsed = parseSnapshot(options.source);
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // DB for counts: required for a real import; optional/read-only for dry-run.
  const db = options.dryRun ? tryCreateDb(options.databaseUrl) : createDb(options.databaseUrl);
  const counts = await diffCounts(db, parsed.candidates);

  if (!options.dryRun && db) {
    await persist(db, runId, parsed, options.source);
  }

  const warnings = parsed.issues.filter((i) => i.severity === "warning");
  const needsReview = parsed.issues.filter((i) => i.severity === "quarantine" || i.severity === "error");

  const report: ImportReport = {
    id: `report#${runId}`,
    importRunId: runId,
    generatedAt: new Date().toISOString(),
    dryRun: options.dryRun,
    counts: {
      scanned: parsed.documents.length,
      parsed: parsed.documents.filter((d) => d.doc.status === "parsed").length,
      created: counts.created,
      updated: counts.updated,
      skipped: counts.skipped,
      // quarantined groups quarantine + hard errors (both excluded from publish / need review)
      quarantined: needsReview.length,
      warnings: warnings.length,
    },
    warnings: [...warnings.map((w) => `[${w.kind}] ${w.message}`), ...needsReview.slice(0, 50).map((e) => `[${e.severity}:${e.kind}] ${e.message}`)].slice(0, 200),
  };

  // Canonical write happens only after the report object exists (auto-publish is
  // permitted for Phase 0). The report describes the parse; publish applies it.
  if (!options.dryRun && db) {
    await publishStaged(db, runId);
    await db.update(schema.importRuns).set({ status: "completed", finishedAt: new Date() }).where(eqRun(runId));
  }

  return { runId, report, parsed, persisted: !options.dryRun && Boolean(db) };
}
