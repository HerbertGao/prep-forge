#!/usr/bin/env tsx
// Thin entry for the legacy importer (PRODUCT §13 named path). All logic lives
// in @prep-forge/legacy-import. Logs go to stderr, the report JSON to stdout.
//
// Usage:
//   tsx scripts/import_legacy_ai_teacher.ts --source <path> [--dry-run] [--report <file>]
//
// Exit codes: 0 ok · 1 import/structure failure · 2 bad arguments.
import { writeFileSync } from "node:fs";
import { runImport, StructureError } from "@prep-forge/legacy-import";

interface Args {
  source?: string;
  dryRun: boolean;
  report?: string;
  databaseUrl?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") continue; // pnpm forwards a literal `--` separator
    else if (a === "--source") args.source = argv[++i];
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--report") args.report = argv[++i];
    else if (a === "--database-url") args.databaseUrl = argv[++i];
    else if (a === "--help" || a === "-h") {
      process.stderr.write("usage: import_legacy_ai_teacher --source <path> [--dry-run] [--report <file>]\n");
      process.exit(0);
    } else {
      process.stderr.write(`[import] unknown argument: ${a}\n`);
      process.exit(2);
    }
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.source) {
    process.stderr.write("[import] --source <path> is required\n");
    process.exit(2);
  }

  const outcome = await runImport({ source: args.source, dryRun: args.dryRun, databaseUrl: args.databaseUrl });
  const json = JSON.stringify(outcome.report, null, 2);

  if (args.report) writeFileSync(args.report, json);
  process.stdout.write(`${json}\n`);

  const c = outcome.report.counts;
  process.stderr.write(
    `[import] run=${outcome.runId} dryRun=${args.dryRun} persisted=${outcome.persisted} ` +
      `scanned=${c.scanned} parsed=${c.parsed} created=${c.created} updated=${c.updated} ` +
      `skipped=${c.skipped} quarantined=${c.quarantined} warnings=${c.warnings}\n`,
  );
  process.exit(0);
}

main().catch((err) => {
  if (err instanceof StructureError) {
    process.stderr.write(`[import] structure error: ${err.message}\n`);
    process.exit(1);
  }
  process.stderr.write(`[import] failed: ${String((err as Error)?.stack ?? err)}\n`);
  process.exit(1);
});
