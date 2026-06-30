// Server-only Phase 2 BFF: prep_jobs state machine + three deterministic hard
// gates + draft→ready (group G7, design D3/D5/D11). The BFF OWNS prep_jobs end
// to end; the worker only writes the artifact (lesson_packets + lesson_steps +
// model_calls) and never touches prep_jobs (D10).
//
// Flow (D3): dedup INSERT (+SELECT fallback) → atomic claim pending→running →
// call worker → running→validating → reconstruct LessonPacket FROM the persisted
// rows (normal AND orphan path share this single source) → 3 gates → ONE tx
// holding pg_advisory_xact_lock(hashtext(jobId)) (same lock as the worker's
// artifact tx, closing the TOCTOU window) that writes quality_gate_results, flips
// lesson_packets validating→draft|quarantine (WHERE status='validating'), and
// flips prep_jobs validating→done. Worker failure / cap-exceeded → prep_jobs
// failed. Confirmation binds to the learner's ACTUALLY-resolved questionId /
// solution / kp_link — never the worker's audit-only generationSources (D5).
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  type Database,
  checkPacketRefs,
  createDb,
  referencedQuestionIds,
  schema,
} from "@prep-forge/db";
import { analyzeAnswerKey, type QuestionGradingInput } from "@prep-forge/lesson-runtime";
import { LessonPacket, PrepGenerateRequest, PrepGenerateResult } from "@prep-forge/schemas";
import { confirmId } from "./packets";

// BFF dedup key + prep_jobs.prompt_version — MUST equal the worker's
// PROMPT_VERSION constant (services/ai-worker generate.py) so the active-job
// partial unique index and the worker artifact line up on the same key.
export const PROMPT_VERSION = "prep-gen-v1";
const TENANT_ID = "demo"; // single-tenant constant (matches session_events)
// ponytail: conservative per-job call cap (design D8 placeholder); raise/lower
// once a real run gives a number. The FAIL THRESHOLD on the persisted
// attempt_count: every worker call (claim + orphan re-call) bumps it first and
// fails the job when the bumped value reaches the cap (spec: "≥ cap → failed").
// So cap=3 ⇒ at most 2 worker calls (1 initial + 1 retry) before giving up.
const PER_JOB_ATTEMPT_CAP = 3;
const WORKER_TIMEOUT_MS = 90_000; // D3 ceiling: browser→Next→worker→claude 30–90s
const ACTIVE_STATUSES = ["pending", "running", "validating"] as const;
const TERMINAL_WORKER_KINDS = new Set(["call_cap", "token_cap"]);

export type JobView = {
  id: string;
  status: string;
  kpCode: string;
  attemptCount: number;
  failureReason: string | null;
  lessonPacketId: string | null;
};

export type GateOutcome = {
  schemaPassed: boolean;
  mathRenderPassed: boolean;
  questionRefsPassed: boolean;
  passed: boolean;
  issues: string[];
};

/** Worker-derived packet id (MUST match generate.py `_packet_id`). */
const prepPacketId = (jobId: string): string => `lesson_packet#prep:${jobId}`;

// --- worker call ---------------------------------------------------------------

class WorkerResponseError extends Error {
  readonly status: number;
  readonly kind: string | null;

  constructor(status: number, kind: string | null, detail: string) {
    const kindSuffix = kind ? ` kind=${kind}` : "";
    const detailSuffix = detail ? `: ${detail}` : "";
    super(`worker responded ${status}${kindSuffix}${detailSuffix}`);
    this.name = "WorkerResponseError";
    this.status = status;
    this.kind = kind;
  }
}

function isTerminalWorkerError(err: unknown): err is WorkerResponseError {
  return err instanceof WorkerResponseError && err.kind !== null && TERMINAL_WORKER_KINDS.has(err.kind);
}

async function parseWorkerError(res: Response): Promise<{ kind: string | null; detail: string }> {
  try {
    const data: unknown = await res.json();
    if (!data || typeof data !== "object") return { kind: null, detail: "" };
    const record = data as Record<string, unknown>;
    return {
      kind: typeof record.kind === "string" ? record.kind : null,
      detail: typeof record.detail === "string" ? record.detail : "",
    };
  } catch {
    return { kind: null, detail: "" };
  }
}

function workerEnv(): { url: string; secret: string } {
  const url = process.env.AI_WORKER_URL;
  const secret = process.env.AI_WORKER_SHARED_SECRET;
  if (!url || !secret) {
    throw new Error("worker not configured (set AI_WORKER_URL + AI_WORKER_SHARED_SECRET)");
  }
  return { url, secret };
}

/** POST the generate request; parse the result envelope as an INDEPENDENT
 * transport liveness check (the gate's schemaPassed comes from the DB-rebuilt
 * packet, NOT this response — D3). Throws on non-2xx / timeout / parse failure. */
async function callWorker(jobId: string, kpCode: string): Promise<void> {
  const { url, secret } = workerEnv();
  const body = PrepGenerateRequest.parse({
    schemaVersion: "1",
    tenantId: TENANT_ID,
    jobId,
    kpCode,
  });
  const res = await fetch(`${url.replace(/\/$/, "")}/v1/prep/generate`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-worker-secret": secret },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(WORKER_TIMEOUT_MS),
  });
  if (!res.ok) {
    const { kind, detail } = await parseWorkerError(res);
    throw new WorkerResponseError(res.status, kind, detail);
  }
  PrepGenerateResult.parse(await res.json());
}

// --- prep_jobs ownership (D3/D4) ----------------------------------------------

/** Dedup INSERT against the active-job partial unique index, with a SELECT
 * fallback (DO NOTHING does not RETURNING the conflicting row) and a bounded
 * retry for the double-0 race (active job flipped terminal between INSERT and
 * SELECT). Returns the jobId to drive. */
async function createOrClaimJob(db: Database, kpCode: string): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const jobId = `prep_job#${randomUUID()}`;
    const inserted = await db
      .insert(schema.prepJobs)
      .values({
        id: jobId,
        status: "pending",
        kpCode,
        promptVersion: PROMPT_VERSION,
        idempotencyKey: jobId,
      })
      .onConflictDoNothing({
        target: [schema.prepJobs.kpCode, schema.prepJobs.promptVersion],
        where: sql`${schema.prepJobs.status} in ('pending', 'running', 'validating')`,
      })
      .returning({ id: schema.prepJobs.id });
    if (inserted.length > 0) return inserted[0]!.id;

    const existing = await db
      .select({ id: schema.prepJobs.id })
      .from(schema.prepJobs)
      .where(
        and(
          eq(schema.prepJobs.kpCode, kpCode),
          eq(schema.prepJobs.promptVersion, PROMPT_VERSION),
          inArray(schema.prepJobs.status, [...ACTIVE_STATUSES]),
        ),
      )
      .limit(1);
    if (existing.length > 0) return existing[0]!.id;
    // double 0 → the active job just reached a terminal state; retry the INSERT.
  }
  throw new Error("createOrClaimJob: exhausted retries");
}

/** Atomic claim pending→running. False ⇒ another claimer won / already active. */
async function atomicClaim(db: Database, jobId: string): Promise<boolean> {
  const claimed = await db
    .update(schema.prepJobs)
    .set({ status: "running", updatedAt: new Date() })
    .where(and(eq(schema.prepJobs.id, jobId), eq(schema.prepJobs.status, "pending")))
    .returning({ id: schema.prepJobs.id });
  return claimed.length > 0;
}

/** Persisted attempt bump BEFORE every worker call (D4: in-memory counts reset
 * on BFF restart / repeated re-validate clicks → unbounded). Returns the new
 * count so the caller can enforce the cap. */
async function bumpAttempt(db: Database, jobId: string): Promise<number> {
  const r = await db
    .update(schema.prepJobs)
    .set({ attemptCount: sql`${schema.prepJobs.attemptCount} + 1`, updatedAt: new Date() })
    .where(eq(schema.prepJobs.id, jobId))
    .returning({ attemptCount: schema.prepJobs.attemptCount });
  return r[0]?.attemptCount ?? Number.POSITIVE_INFINITY;
}

async function failJob(db: Database, jobId: string, reason: string): Promise<void> {
  await db
    .update(schema.prepJobs)
    .set({ status: "failed", failureReason: reason.slice(0, 480), updatedAt: new Date() })
    .where(and(eq(schema.prepJobs.id, jobId), inArray(schema.prepJobs.status, [...ACTIVE_STATUSES])));
}

async function keepJobRetryable(db: Database, jobId: string, reason: string): Promise<void> {
  await db
    .update(schema.prepJobs)
    .set({ status: "running", failureReason: reason.slice(0, 480), updatedAt: new Date() })
    .where(and(eq(schema.prepJobs.id, jobId), inArray(schema.prepJobs.status, [...ACTIVE_STATUSES])));
}

async function setValidating(db: Database, jobId: string): Promise<void> {
  await db
    .update(schema.prepJobs)
    .set({ status: "validating", updatedAt: new Date() })
    .where(and(eq(schema.prepJobs.id, jobId), inArray(schema.prepJobs.status, ["running", "validating"])));
}

async function validatingPacketExists(db: Database, jobId: string): Promise<boolean> {
  const r = await db
    .select({ id: schema.lessonPackets.id })
    .from(schema.lessonPackets)
    .where(and(eq(schema.lessonPackets.id, prepPacketId(jobId)), eq(schema.lessonPackets.status, "validating")))
    .limit(1);
  return r.length > 0;
}

async function jobView(db: Database, jobId: string): Promise<JobView | null> {
  const r = await db
    .select({
      id: schema.prepJobs.id,
      status: schema.prepJobs.status,
      kpCode: schema.prepJobs.kpCode,
      attemptCount: schema.prepJobs.attemptCount,
      failureReason: schema.prepJobs.failureReason,
      lessonPacketId: schema.prepJobs.lessonPacketId,
    })
    .from(schema.prepJobs)
    .where(eq(schema.prepJobs.id, jobId))
    .limit(1);
  return r[0] ?? null;
}

// --- gate inputs: reconstruct LessonPacket FROM persisted rows (D3) -----------

/** Rebuild the worker's packet from lesson_packets + lesson_steps as a plain
 * object (NOT yet Zod-parsed — gate 1 is that parse). Returns null if the
 * validating packet is gone. */
async function reconstructPacket(
  db: Database,
  jobId: string,
): Promise<{ raw: unknown; status: string } | null> {
  const packetId = prepPacketId(jobId);
  const row = (
    await db.select().from(schema.lessonPackets).where(eq(schema.lessonPackets.id, packetId)).limit(1)
  )[0];
  if (!row) return null;
  const stepRows = await db
    .select()
    .from(schema.lessonSteps)
    .where(eq(schema.lessonSteps.lessonPacketId, packetId));
  stepRows.sort((a, b) => a.sequence - b.sequence);
  const raw = {
    id: row.id,
    origin: row.origin,
    visibility: row.visibility,
    version: row.version,
    status: row.status,
    subjectCode: row.subjectCode ?? null,
    courseCode: row.courseCode ?? null,
    title: row.title,
    kpCodes: (row.kpCodes as string[] | null) ?? [],
    prerequisites: (row.prerequisites as string[] | null) ?? undefined,
    estimatedMinutes: row.estimatedMinutes ?? null,
    difficulty: row.difficulty ?? null,
    objectives: (row.objectives as string[] | null) ?? undefined,
    steps: stepRows.map((s) => ({
      id: s.id,
      type: s.type,
      prompt: s.prompt ?? null,
      mdx: s.mdx ?? null,
      math: (s.math as LessonPacket["steps"][number]["math"] | null) ?? null,
      questionIds: (s.questionIds as string[] | null) ?? undefined,
    })),
    sourceBlockId: row.sourceBlockId ?? null,
    contentHash: row.contentHash ?? null,
  };
  return { raw, status: row.status };
}

// --- the three gates -----------------------------------------------------------

/** PURE gates 1 (Schema: Zod parse the rebuilt packet) + 3 (Math: keyed
 * step.math != null → quarantine; NO mdx/prompt text scan, design D5). Returns
 * the parsed packet for gate 2, or null when the schema gate fails. */
export function evaluateStaticGates(raw: unknown): {
  schemaPassed: boolean;
  mathRenderPassed: boolean;
  packet: LessonPacket | null;
  issues: string[];
} {
  const issues: string[] = [];
  const parsed = LessonPacket.safeParse(raw);
  if (!parsed.success) {
    issues.push(`schema gate: ${parsed.error.issues.map((i) => i.message).join("; ").slice(0, 300)}`);
  }
  const packet = parsed.success ? parsed.data : null;
  // Math gate reads the KEYED step.math field (never scans mdx/prompt text);
  // fall back to raw.steps so a schema-failed packet with math still trips it.
  const steps: ReadonlyArray<{ math?: unknown }> =
    packet?.steps ?? ((raw as { steps?: { math?: unknown }[] })?.steps ?? []);
  const mathRenderPassed = !steps.some((s) => s.math != null);
  if (!mathRenderPassed) {
    issues.push("math gate: a step carries a math block (no KaTeX bridge in thin trunk)");
  }
  return { schemaPassed: parsed.success, mathRenderPassed, packet, issues };
}

export type ResolvedRefs = {
  questionsById: Map<string, { type: string; origin: string }>;
  optionsByQ: Map<string, { label: string; isCorrect: boolean | null; origin: string }[]>;
  solutionByQ: Map<string, { id: string; answer: string; origin: string }>;
  linksByQ: Map<string, { id: string; kpCode: string; origin: string }[]>;
  /** `${entityType}:${entityId}` of every admin_confirmations row. */
  confirmed: Set<string>;
};

/** PURE gate 2 confirmation + answer-key binding over the ACTUALLY-referenced
 * questionIds (design D5). For each ref: question axis (admin_confirmations
 * question), answer axis (reuse grader correctLabelSet — import data is always
 * option-graded, so assert the import invariant solution.answer letters ==
 * option.isCorrect set AND require the solution confirmed), KP axis (every
 * question_kp_links row confirmed). Never reads generationSources. Returns the
 * issues that must quarantine; empty ⇒ confirmation binding passes. */
export function evaluateConfirmations(refIds: string[], r: ResolvedRefs): string[] {
  const issues: string[] = [];
  for (const qid of refIds) {
    const q = r.questionsById.get(qid);
    if (!q) continue; // unresolved ref is already flagged by checkPacketRefs.
    if (q.origin !== "imported") issues.push(`question ${qid} is not imported`);
    if (!r.confirmed.has(`question:${qid}`)) issues.push(`question ${qid} not confirmed`);
    const options = r.optionsByQ.get(qid) ?? [];
    if (options.some((o) => o.origin !== "imported")) {
      issues.push(`question ${qid} has non-imported option rows`);
    }

    const input: QuestionGradingInput = {
      questionId: qid,
      type: q.type,
      options,
      solutionAnswer: r.solutionByQ.get(qid)?.answer ?? null,
      kpCodes: [],
    };
    const a = analyzeAnswerKey(input);
    const sol = r.solutionByQ.get(qid);
    if (!a.key || a.key.size === 0) {
      issues.push(`question ${qid} has no resolvable answer key`);
    } else if (!sol) {
      issues.push(`question ${qid} has no solution row to confirm the answer key`);
    } else {
      if (sol.origin !== "imported") issues.push(`answer ${sol.id} (for ${qid}) is not imported`);
      // Import invariant only asserted on the path grader actually takes
      // (option-graded); both sides derive from import's rq.answer (design D5).
      if (a.optionGraded && !sameSet(a.key, a.solutionLabels ?? new Set())) {
        issues.push(`question ${qid} import invariant broken: solution.answer != option.isCorrect`);
      }
      if (!r.confirmed.has(`answer:${sol.id}`)) issues.push(`answer ${sol.id} (for ${qid}) not confirmed`);
    }

    const links = r.linksByQ.get(qid) ?? [];
    if (links.length === 0) {
      issues.push(`question ${qid} has no question_kp_links`);
    }
    for (const l of links) {
      if (l.origin !== "imported") issues.push(`kp_link ${l.id} (${l.kpCode}, for ${qid}) is not imported`);
      if (!r.confirmed.has(`kp_link:${l.id}`)) issues.push(`kp_link ${l.id} (${l.kpCode}, for ${qid}) not confirmed`);
    }
  }
  return issues;
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

/** Fetch everything gate 2 binds to for the referenced questionIds. */
async function resolveRefs(db: Database, refIds: string[]): Promise<ResolvedRefs> {
  const [qRows, optRows, solRows, linkRows, confRows] = await Promise.all([
    refIds.length
      ? db
          .select({ id: schema.questions.id, type: schema.questions.type, origin: schema.questions.origin })
          .from(schema.questions)
          .where(inArray(schema.questions.id, refIds))
      : Promise.resolve([]),
    refIds.length
      ? db
          .select({
            questionId: schema.questionOptions.questionId,
            label: schema.questionOptions.label,
            isCorrect: schema.questionOptions.isCorrect,
            origin: schema.questionOptions.origin,
          })
          .from(schema.questionOptions)
          .where(inArray(schema.questionOptions.questionId, refIds))
      : Promise.resolve([]),
    refIds.length
      ? db
          .select({
            id: schema.questionSolutions.id,
            questionId: schema.questionSolutions.questionId,
            answer: schema.questionSolutions.answer,
            origin: schema.questionSolutions.origin,
          })
          .from(schema.questionSolutions)
          .where(inArray(schema.questionSolutions.questionId, refIds))
      : Promise.resolve([]),
    refIds.length
      ? db
          .select({
            id: schema.questionKpLinks.id,
            questionId: schema.questionKpLinks.questionId,
            kpCode: schema.questionKpLinks.kpCode,
            origin: schema.questionKpLinks.origin,
          })
          .from(schema.questionKpLinks)
          .where(inArray(schema.questionKpLinks.questionId, refIds))
      : Promise.resolve([]),
    db
      .select({ entityType: schema.adminConfirmations.entityType, entityId: schema.adminConfirmations.entityId })
      .from(schema.adminConfirmations),
  ]);

  const questionsById = new Map(qRows.map((q) => [q.id, { type: q.type, origin: q.origin }]));
  const optionsByQ = new Map<string, { label: string; isCorrect: boolean | null; origin: string }[]>();
  for (const o of optRows) {
    const a = optionsByQ.get(o.questionId) ?? [];
    a.push({ label: o.label, isCorrect: o.isCorrect, origin: o.origin });
    optionsByQ.set(o.questionId, a);
  }
  const solutionByQ = new Map<string, { id: string; answer: string; origin: string }>();
  for (const s of solRows) {
    if (!solutionByQ.has(s.questionId)) {
      solutionByQ.set(s.questionId, { id: s.id, answer: s.answer, origin: s.origin });
    }
  }
  const linksByQ = new Map<string, { id: string; kpCode: string; origin: string }[]>();
  for (const l of linkRows) {
    const a = linksByQ.get(l.questionId) ?? [];
    a.push({ id: l.id, kpCode: l.kpCode, origin: l.origin });
    linksByQ.set(l.questionId, a);
  }
  const confirmed = new Set(confRows.map((c) => `${c.entityType}:${c.entityId}`));
  return { questionsById, optionsByQ, solutionByQ, linksByQ, confirmed };
}

/** Run all three gates against a DB-rebuilt packet. */
async function runGates(db: Database, raw: unknown): Promise<GateOutcome> {
  const stat = evaluateStaticGates(raw);
  const issues = [...stat.issues];
  let questionRefsPassed = false;
  if (stat.packet) {
    // Reuse the extracted checkPacketRefs for resolvable refs + ≥1 objective +
    // kp_links presence (design D5); answer-key + confirmation binding is net-new.
    const refFailures = await checkPacketRefs(db, stat.packet);
    issues.push(...refFailures);
    const refIds = [...new Set(referencedQuestionIds(stat.packet))];
    const resolved = await resolveRefs(db, refIds);
    const confIssues = evaluateConfirmations(refIds, resolved);
    issues.push(...confIssues);
    questionRefsPassed = refFailures.length === 0 && confIssues.length === 0 && refIds.length > 0;
  } else {
    issues.push("reference gate skipped: schema gate failed");
  }
  const passed = stat.schemaPassed && stat.mathRenderPassed && questionRefsPassed;
  return {
    schemaPassed: stat.schemaPassed,
    mathRenderPassed: stat.mathRenderPassed,
    questionRefsPassed,
    passed,
    issues,
  };
}

/** Run the gates + flip terminal in ONE tx holding the same advisory lock the
 * worker's artifact tx takes (closes the TOCTOU window; the validating guard on
 * each flip is the second wall). */
async function runGateTx(jobId: string): Promise<void> {
  const db = createDb();
  try {
    await db.transaction(async (tx) => {
      const txdb = tx as unknown as Database;
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${jobId}::text))`);
      const recon = await reconstructPacket(txdb, jobId);
      if (!recon || recon.status !== "validating") {
        await failJob(txdb, jobId, "no validating packet at gate time");
        return;
      }
      const gate = await runGates(txdb, recon.raw);
      const packetId = prepPacketId(jobId);
      await txdb
        .insert(schema.qualityGateResults)
        .values({
          id: `qg#${jobId}`,
          lessonPacketId: packetId,
          prepJobId: jobId,
          schemaPassed: gate.schemaPassed,
          mathRenderPassed: gate.mathRenderPassed,
          questionRefsPassed: gate.questionRefsPassed,
          passed: gate.passed,
          issues: gate.issues,
        })
        .onConflictDoUpdate({
          target: schema.qualityGateResults.id,
          set: {
            schemaPassed: gate.schemaPassed,
            mathRenderPassed: gate.mathRenderPassed,
            questionRefsPassed: gate.questionRefsPassed,
            passed: gate.passed,
            issues: gate.issues,
          },
        });
      await txdb
        .update(schema.lessonPackets)
        .set({ status: gate.passed ? "draft" : "quarantine" })
        .where(and(eq(schema.lessonPackets.id, packetId), eq(schema.lessonPackets.status, "validating")));
      await txdb
        .update(schema.prepJobs)
        .set({
          status: "done",
          lessonPacketId: packetId,
          failureReason: gate.passed ? null : `quarantine: ${gate.issues.join("; ").slice(0, 400)}`,
          updatedAt: new Date(),
        })
        .where(and(eq(schema.prepJobs.id, jobId), eq(schema.prepJobs.status, "validating")));
    });
  } catch (e) {
    await failJob(createDb(), jobId, `gate error: ${String((e as Error)?.message ?? e)}`);
  }
}

/** Call the worker (cap-guarded) then reconcile from the DB: if a validating
 * packet landed (even on a lost response — the orphan case), gate it. If the
 * transport failed and no packet is visible yet, keep the active job retryable:
 * a slow worker may still commit the validating artifact after the BFF timeout,
 * and reconcileJob is the re-entry point that must collect it (D3/D4). */
async function callThenGate(jobId: string, kpCode: string): Promise<void> {
  const db = createDb();
  const attempt = await bumpAttempt(db, jobId);
  if (attempt >= PER_JOB_ATTEMPT_CAP) {
    await failJob(db, jobId, `attempt cap ${PER_JOB_ATTEMPT_CAP} reached`);
    return;
  }
  let workerOk = false;
  let workerErr = "";
  let terminalWorkerErr = false;
  try {
    await callWorker(jobId, kpCode);
    workerOk = true;
  } catch (e) {
    workerErr = String((e as Error)?.message ?? e);
    terminalWorkerErr = isTerminalWorkerError(e);
  }
  // Reconcile from the DB regardless of transport outcome (single source, D3).
  if (await validatingPacketExists(db, jobId)) {
    await setValidating(db, jobId);
    await runGateTx(jobId);
  } else if (terminalWorkerErr) {
    await failJob(db, jobId, `worker hard limit exceeded: ${workerErr}`);
  } else if (!workerOk) {
    await keepJobRetryable(db, jobId, `worker call failed; retryable: ${workerErr}`);
  } else {
    await failJob(db, jobId, "worker returned but no validating packet persisted");
  }
}

// --- public BFF entries (admin actions call these) ----------------------------

/** 7.1/7.5: admin triggers generation for a confirmed KP. */
export async function generateDraftForKp(kpCode: string): Promise<JobView> {
  const db = createDb();
  const jobId = await createOrClaimJob(db, kpCode);
  if (await atomicClaim(db, jobId)) {
    await callThenGate(jobId, kpCode);
  }
  // If not claimed, an existing active job is mid-flight — just report its state.
  const view = await jobView(db, jobId);
  if (!view) throw new Error("prep job vanished after create");
  return view;
}

/** 7.4: re-entrant re-validate for a job stuck in running/validating (orphan).
 * Reconcile by jobId: a persisted validating packet → rebuild + gate; none →
 * re-call worker (cap-guarded) or fail. */
export async function reconcileJob(jobId: string): Promise<JobView> {
  const db = createDb();
  const job = await jobView(db, jobId);
  if (!job) throw new Error("job not found");
  if (job.status === "running" || job.status === "validating") {
    if (await validatingPacketExists(db, jobId)) {
      await setValidating(db, jobId);
      await runGateTx(jobId);
    } else {
      await callThenGate(jobId, job.kpCode);
    }
  }
  const view = await jobView(db, jobId);
  return view ?? job;
}

/** 7.6: draft→ready, one packet at a time (design D11). The `id=` predicate is
 * MANDATORY (a blanket flip would batch-publish every draft). 0 rows ⇒ rollback,
 * no confirmation. Writes admin_confirmations(lesson_packet) DIRECTLY — NOT via
 * confirmContent(), whose question/answer/kp_link branches would reject it. */
export async function confirmDraftReady(lessonPacketId: string): Promise<{ ok: boolean }> {
  try {
    const db = createDb();
    let ok = false;
    await db.transaction(async (tx) => {
      const updated = await tx
        .update(schema.lessonPackets)
        .set({ status: "ready" })
        .where(
          and(
            eq(schema.lessonPackets.id, lessonPacketId),
            eq(schema.lessonPackets.origin, "ai_generated"),
            eq(schema.lessonPackets.status, "draft"),
          ),
        )
        .returning({ id: schema.lessonPackets.id });
      if (updated.length === 0) {
        throw new Error("rollback: not a draft ai_generated packet"); // → no confirmation
      }
      await tx
        .insert(schema.adminConfirmations)
        .values({ id: confirmId("lesson_packet", lessonPacketId), entityType: "lesson_packet", entityId: lessonPacketId })
        .onConflictDoUpdate({ target: schema.adminConfirmations.id, set: { confirmedAt: new Date() } });
      ok = true;
    });
    return { ok };
  } catch (e) {
    console.error("[prep] confirmDraftReady failed:", e);
    return { ok: false };
  }
}

// --- admin read models (7.5 UI) ------------------------------------------------

/** All prep jobs, newest first (admin job table). Empty when no DB. */
export async function loadPrepJobs(): Promise<JobView[]> {
  try {
    const db = createDb();
    return await db
      .select({
        id: schema.prepJobs.id,
        status: schema.prepJobs.status,
        kpCode: schema.prepJobs.kpCode,
        attemptCount: schema.prepJobs.attemptCount,
        failureReason: schema.prepJobs.failureReason,
        lessonPacketId: schema.prepJobs.lessonPacketId,
      })
      .from(schema.prepJobs)
      .orderBy(desc(schema.prepJobs.createdAt));
  } catch {
    return [];
  }
}

/** KP codes whose kp_link rows have ≥1 admin_confirmations(kp_link) — the
 * "confirmed KPs" an admin may generate for (7.5 selection). */
export async function loadConfirmedKpCodes(): Promise<string[]> {
  try {
    const db = createDb();
    const rows = await db
      .selectDistinct({ kpCode: schema.questionKpLinks.kpCode })
      .from(schema.questionKpLinks)
      .innerJoin(
        schema.adminConfirmations,
        and(
          eq(schema.adminConfirmations.entityType, "kp_link"),
          eq(schema.adminConfirmations.entityId, schema.questionKpLinks.id),
        ),
      );
    return rows.map((r) => r.kpCode).sort();
  } catch {
    return [];
  }
}

export type AiPacketView = {
  id: string;
  title: string;
  status: string;
  kpCodes: string[];
  generationSources: { sourceType: string; sourceId: string }[];
};

/** AI-generated packets (draft list, 7.5) with their structured sources. */
export async function loadAiGeneratedPackets(): Promise<AiPacketView[]> {
  try {
    const db = createDb();
    const rows = await db
      .select({
        id: schema.lessonPackets.id,
        title: schema.lessonPackets.title,
        status: schema.lessonPackets.status,
        kpCodes: schema.lessonPackets.kpCodes,
        generationSources: schema.lessonPackets.generationSources,
      })
      .from(schema.lessonPackets)
      .where(eq(schema.lessonPackets.origin, "ai_generated"))
      .orderBy(desc(schema.lessonPackets.id));
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      kpCodes: (r.kpCodes as string[] | null) ?? [],
      generationSources: ((r.generationSources as { sourceType?: string; sourceId?: string }[] | null) ?? []).map(
        (s) => ({ sourceType: s.sourceType ?? "?", sourceId: s.sourceId ?? "?" }),
      ),
    }));
  } catch {
    return [];
  }
}
