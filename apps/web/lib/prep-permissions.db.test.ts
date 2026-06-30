// G8 8.2 — prep_worker least-privilege + double-trigger hard wall (design D2).
// Connects AS the prep_worker role and asserts the whole deny-list is rejected
// with SQLSTATE 42501 (permission denied / insufficient_privilege), plus a
// positive smoke (SELECT questions) and no GRANT … TO PUBLIC. Fixtures are
// created by the APP role (its session_user is not 'prep_worker', so the guard
// triggers no-op for setup).
//
// DB-gated: needs DATABASE_URL (owner) + PREP_WORKER_PASSWORD + the 0006 role
// migration applied. SKIPS locally without the role; in CI (both set) a probe
// failure THROWS rather than green-skipping (the role must be created first).
import { inArray, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { type Database, createDb, schema } from "@prep-forge/db";

const HAS_DB = Boolean(process.env.DATABASE_URL);

/** prep_worker DSN = DATABASE_URL with the role + password swapped in. */
function workerUrl(): string | null {
  const base = process.env.DATABASE_URL;
  const pw = process.env.PREP_WORKER_PASSWORD;
  if (!base || !pw) return null;
  try {
    const u = new URL(base);
    u.username = "prep_worker";
    u.password = pw;
    return u.toString();
  } catch {
    return null;
  }
}

const WORKER_URL = workerUrl();

// RUN_PREP_DB gates this OUT of the default `pnpm -r test`: that run includes the
// legacy-import suite, which DROP SCHEMA … CASCADE — destroying the very 0006 role
// grants this suite verifies. It runs only in its own isolated CI step (set the
// flag), where the grants are intact and no concurrent drop can race it.
const FLAG = process.env.RUN_PREP_DB === "1";

async function canRun(): Promise<boolean> {
  if (!FLAG || !HAS_DB || !WORKER_URL) return false;
  try {
    // Probe a GRANTED read (questions) so a post-drop grant-less schema → skip.
    await createDb(WORKER_URL).execute(sql`select id from questions limit 1`);
    return true;
  } catch {
    return false;
  }
}
const RUN_SUITE = await canRun();
if (process.env.CI && FLAG && HAS_DB && process.env.PREP_WORKER_PASSWORD && !RUN_SUITE) {
  throw new Error("prep-permissions.db.test: RUN_PREP_DB set in CI but prep_worker role not usable (apply 0006_prep_worker_role)");
}

const RUN = Date.now();
const SYS = `lesson_packet#perm:sys-${RUN}`; // a pre-existing system/ready packet
const SYS_STEP = `${SYS}:1`;
const OWN = `lesson_packet#prep:perm-own-${RUN}`; // a worker-owned validating packet
const ALL = [SYS, OWN];

const app = (HAS_DB ? createDb() : null) as Database;
const worker = (WORKER_URL ? createDb(WORKER_URL) : null) as Database;

function pgCode(e: unknown): string | undefined {
  const any = e as { code?: string; cause?: { code?: string } };
  return any?.code ?? any?.cause?.code;
}

/** Run `q` as prep_worker; return the SQLSTATE if rejected, undefined if it ran. */
async function denialCode(q: ReturnType<typeof sql>): Promise<string | undefined> {
  try {
    await worker.execute(q);
    return undefined;
  } catch (e) {
    return pgCode(e);
  }
}

const DENIED = "42501"; // insufficient_privilege / permission denied for table

describe.skipIf(!RUN_SUITE)("G8 prep_worker hard wall (negative permissions)", () => {
  afterAll(async () => {
    await app.delete(schema.lessonSteps).where(inArray(schema.lessonSteps.lessonPacketId, ALL));
    await app.delete(schema.lessonPackets).where(inArray(schema.lessonPackets.id, ALL));
  });

  it("denies the entire write deny-list (incl. source_blocks / imported_entities)", async () => {
    // ① no INSERT/UPDATE/DELETE on any non-granted table — DELETE alone trips the
    // table-level ACL (checked before any row scan), so it is a uniform probe.
    for (const t of [
      "source_blocks",
      "source_documents",
      "imported_entities",
      "import_runs",
      "import_errors",
      "question_bank_stats",
      "learner_profiles",
      "exam_tracks",
      "courses",
      "subjects",
      "chapters",
      "daily_logs",
      "mistakes",
      "learner_kp_states",
      "review_items",
      "study_plans",
      "session_events",
      "quality_gate_results",
      "questions",
      "question_options",
      "question_solutions",
      "question_kp_links",
      "knowledge_points",
    ]) {
      expect(await denialCode(sql.raw(`delete from ${t}`)), `delete ${t}`).toBe(DENIED);
    }
  });

  it("denies hijacking a system row, system step, repoint-steal, and self-promotion", async () => {
    await app.insert(schema.lessonPackets).values({ id: SYS, origin: "system", visibility: "public", version: 1, status: "ready", title: "system", kpCodes: ["PERM-01"] }).onConflictDoNothing();
    await app.insert(schema.lessonSteps).values({ id: SYS_STEP, lessonPacketId: SYS, sequence: 1, type: "explanation", mdx: "system step" }).onConflictDoNothing();
    await app.insert(schema.lessonPackets).values({ id: OWN, origin: "ai_generated", visibility: "public", version: 1, status: "validating", title: "own", kpCodes: ["PERM-01"] }).onConflictDoNothing();

    // ② SET origin/status on an origin='system' row → OLD guard.
    expect(await denialCode(sql`update lesson_packets set origin='ai_generated', status='validating' where id=${SYS}`)).toBe(DENIED);
    // ③ rewrite/delete a system ready packet's step → OLD-parent guard.
    expect(await denialCode(sql`update lesson_steps set prompt='x' where id=${SYS_STEP}`)).toBe(DENIED);
    expect(await denialCode(sql`delete from lesson_steps where id=${SYS_STEP}`)).toBe(DENIED);
    // ④ repoint a system step onto our validating packet → OLD-parent guard.
    expect(await denialCode(sql`update lesson_steps set lesson_packet_id=${OWN} where id=${SYS_STEP}`)).toBe(DENIED);
    // ⑤ self-promotion on our own validating row → NEW guard rejects BOTH targets.
    expect(await denialCode(sql`update lesson_packets set status='ready' where id=${OWN}`)).toBe(DENIED);
    expect(await denialCode(sql`update lesson_packets set status='draft' where id=${OWN}`)).toBe(DENIED);
    // positive control: a legit edit that keeps (ai_generated, validating) is ALLOWED
    // (proves the wall is the guard, not a blanket deny / missing grant).
    expect(await denialCode(sql`update lesson_packets set title='ok' where id=${OWN}`)).toBeUndefined();
  });

  it("denies UPDATE/DELETE model_calls (append-only) and INSERT/UPDATE prep_jobs", async () => {
    // ⑥ model_calls is INSERT-only.
    expect(await denialCode(sql`update model_calls set status='x'`)).toBe(DENIED);
    expect(await denialCode(sql`delete from model_calls`)).toBe(DENIED);
    // ⑦ prep_jobs: no write at all.
    // Use VALID enum literals so prep_job_status coercion (22P02) can't mask the
    // permission denial (42501) the test is actually asserting.
    expect(await denialCode(sql`insert into prep_jobs (id,status,kp_code,prompt_version,idempotency_key) values ('x','pending','k','v','x')`)).toBe(DENIED);
    expect(await denialCode(sql`update prep_jobs set status='failed'`)).toBe(DENIED);
  });

  it("denies SELECT on PII / confirmation tables but allows the question bank", async () => {
    // ⑧ no read on PII / admin_confirmations.
    expect(await denialCode(sql`select 1 from daily_logs limit 1`)).toBe(DENIED);
    expect(await denialCode(sql`select 1 from admin_confirmations limit 1`)).toBe(DENIED);
    // positive smoke: the public question bank is readable.
    expect(await denialCode(sql`select id from questions limit 1`)).toBeUndefined();
  });

  it("issues no GRANT … TO PUBLIC on any worker-relevant table", async () => {
    const res = await app.execute(sql`
      select count(*)::int as n
      from information_schema.role_table_grants
      where grantee = 'PUBLIC' and table_schema = 'public'
        and table_name in (
          'lesson_packets','lesson_steps','model_calls','prep_jobs',
          'quality_gate_results','admin_confirmations','daily_logs',
          'questions','source_blocks','imported_entities','session_events',
          'learner_kp_states'
        )`);
    const rows = (Array.isArray(res) ? res : (res as { rows?: { n: number }[] }).rows) ?? [];
    expect(Number((rows[0] as { n?: number } | undefined)?.n)).toBe(0);
  });
});
