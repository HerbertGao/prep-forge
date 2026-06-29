// db:seed entry — explicit publish step (设计决策 2). Publishes the staged
// imported_entities of one import run into the domain tables. Does NOT parse or
// fabricate seed data: the importer (Group D) stages rows first; this only runs
// the deterministic publish. Pass an import run id, or it picks the latest run.
import { desc } from "drizzle-orm";
import { createDb } from "./client";
import { publishStaged } from "./publish";
import { importRuns } from "./schema";

async function main(): Promise<void> {
  const db = createDb();
  const runId =
    process.argv[2] ??
    (await db.select({ id: importRuns.id }).from(importRuns).orderBy(desc(importRuns.startedAt)).limit(1))[0]
      ?.id;

  if (!runId) {
    console.log("[db:seed] no import run found — run the legacy importer first (import:legacy).");
    process.exit(0);
  }

  const result = await publishStaged(db, runId);
  console.log(
    `[db:seed] run=${runId} published=${result.published} skipped=${result.skipped} blocked=${result.blocked}`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("[db:seed] failed:", err);
  process.exit(1);
});
