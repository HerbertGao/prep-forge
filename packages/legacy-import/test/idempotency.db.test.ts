import { cpSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { beforeAll, describe, expect, it } from "vitest";
import { createDb, schema } from "@prep-forge/db";
import { runImport } from "../src/index";

// Persisted-idempotency proof (spec 4.9). Requires a throwaway Postgres:
//   DATABASE_URL=postgres://prepforge:prepforge@localhost:5432/prepforge pnpm --filter @prep-forge/legacy-import test
// Skipped (with the parse-layer test still covering natural-key stability) when
// no DATABASE_URL is set so the suite stays green offline.
const HAS_DB = Boolean(process.env.DATABASE_URL);
const FIXTURE = fileURLToPath(new URL("./fixtures/snapshot", import.meta.url));
const MIGRATIONS = fileURLToPath(new URL("../../db/drizzle", import.meta.url));

async function resetSchema(): Promise<void> {
  const db = createDb();
  await db.execute(sql.raw("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"));
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith(".sql"))!;
  const ddl = readFileSync(join(MIGRATIONS, file), "utf8");
  for (const stmt of ddl.split("--> statement-breakpoint")) {
    const s = stmt.trim();
    if (s) await db.execute(sql.raw(s));
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function count(table: PgTable<any>): Promise<number> {
  const db = createDb();
  const rows = await db.select().from(table);
  return rows.length;
}

describe.skipIf(!HAS_DB)("persisted idempotency (4.9)", () => {
  beforeAll(async () => {
    await resetSchema();
  });

  it("re-importing the same snapshot creates no duplicates", async () => {
    const first = await runImport({ source: FIXTURE, dryRun: false });
    expect(first.persisted).toBe(true);
    const courses1 = await count(schema.courses);
    const kp1 = await count(schema.knowledgePoints);
    const q1 = await count(schema.questions);

    const second = await runImport({ source: FIXTURE, dryRun: false });
    expect(second.report.counts.created).toBe(0);
    expect(second.report.counts.updated).toBe(0);
    expect(await count(schema.courses)).toBe(courses1);
    expect(await count(schema.knowledgePoints)).toBe(kp1);
    expect(await count(schema.questions)).toBe(q1);
  });

  it("content change is an update (no new rows), content_hash changes", async () => {
    const coursesBefore = await count(schema.courses);
    const kpBefore = await count(schema.knowledgePoints);

    const tmp = mkdtempSync(join(tmpdir(), "legacy-import-db-"));
    cpSync(FIXTURE, tmp, { recursive: true });
    const syl = join(tmp, "teacher/subjects/discrete_math/syllabus.md");
    writeFileSync(syl, readFileSync(syl, "utf8").replace("命题与命题联结词", "命题与命题联结词（修订）"));

    const out = await runImport({ source: tmp, dryRun: false });
    expect(out.report.counts.updated).toBeGreaterThanOrEqual(1);
    expect(await count(schema.courses)).toBe(coursesBefore);
    expect(await count(schema.knowledgePoints)).toBe(kpBefore);

    const db = createDb();
    const kp = await db.select().from(schema.knowledgePoints);
    const target = kp.find((k) => k.kpCode === "DM01-01");
    expect(target?.title).toContain("修订");
  });
});
