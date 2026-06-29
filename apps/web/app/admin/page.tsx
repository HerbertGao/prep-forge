import Link from "next/link";
import { loadImportReport, ORIGINS } from "../../lib/admin";
import type { ExceptionBlock, ImportRunReport } from "../../lib/admin";
import { Badge, Card, OriginBadge, SourceBanner } from "../../components/ui";

// Read fresh provenance per request; never connect to the DB at build time
// (build succeeds with no DB via the fixture fallback).
export const dynamic = "force-dynamic";

const ORIGIN_DESC: Record<string, string> = {
  imported: "从 ai-teacher 快照人工导入的真实数据（带 source block 可追溯）。",
  system: "系统/fixture 生成（如示例课包，Phase 2 产物，非导入真实数据）。",
  ai_generated: "AI 生成内容。Phase 0 不产生 AI 数据，需经校验/quarantine 后才可发布。",
};

function summary(s: string | null, max = 160): string {
  if (!s) return "（无原文）";
  const oneLine = s.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}

function RunCard({ run }: { run: ImportRunReport }) {
  return (
    <Card>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="font-medium">{run.sourceRef ?? run.sourceRootPath}</span>
        {run.sourceRepo && <span className="text-xs text-gray-400">{run.sourceRepo}</span>}
        <Badge tone={run.status === "completed" ? "green" : run.status === "failed" ? "red" : "blue"}>
          {run.status}
        </Badge>
        {run.dryRun && <Badge tone="amber">dry-run</Badge>}
      </div>
      <div className="mb-3 text-xs text-gray-500">
        {run.startedAt ?? "—"}
        {run.finishedAt && ` → ${run.finishedAt}`}
        <span className="ml-2 text-gray-400">id {run.id}</span>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        <Stat label="扫描文件" value={run.scanned} />
        <Stat label="解析成功" value={run.parsed} tone="green" />
        <Stat label="不支持" value={run.unsupported} />
        <Stat label="已发布实体" value={run.published} />
        <Stat label="quarantine" value={run.quarantine} tone={run.quarantine > 0 ? "red" : "gray"} />
        <Stat label="error" value={run.errors} tone={run.errors > 0 ? "red" : "gray"} />
      </div>

      <div className="mt-3">
        <div className="mb-1 text-xs font-semibold text-gray-600">
          warnings（{run.warnings.length}）
        </div>
        {run.warnings.length > 0 ? (
          <ul className="space-y-1 text-xs text-amber-800">
            {run.warnings.map((w, i) => (
              <li key={i}>
                <span className="font-medium">[{w.kind}]</span> {w.message}
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-xs text-gray-400">无 warning。</div>
        )}
      </div>
    </Card>
  );
}

function Stat({
  label,
  value,
  tone = "gray",
}: {
  label: string;
  value: number;
  tone?: "gray" | "green" | "red";
}) {
  const color = tone === "green" ? "text-green-700" : tone === "red" ? "text-red-700" : "text-gray-900";
  return (
    <div>
      <div className="text-[11px] text-gray-500">{label}</div>
      <div className={`text-lg font-semibold ${color}`}>{value}</div>
    </div>
  );
}

function ExceptionRow({ e }: { e: ExceptionBlock }) {
  return (
    <Card className="border-l-4 border-l-red-300">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <Badge tone={e.severity === "quarantine" ? "amber" : "red"}>{e.severity}</Badge>
        <span className="text-sm font-medium">{e.kind}</span>
      </div>
      <div className="text-sm text-gray-700">{e.message}</div>
      <dl className="mt-2 space-y-1 text-xs text-gray-500">
        <div>
          <span className="text-gray-400">source path：</span>
          <span className="font-mono">{e.sourcePath ?? "—"}</span>
        </div>
        <div>
          <span className="text-gray-400">heading path：</span>
          {e.headingPath && e.headingPath.length > 0 ? e.headingPath.join(" › ") : "—"}
        </div>
        <div>
          <span className="text-gray-400">raw block：</span>
          <code className="break-words font-mono text-gray-600">{summary(e.rawBlock)}</code>
        </div>
      </dl>
    </Card>
  );
}

export default async function AdminImportsPage() {
  const r = await loadImportReport();

  return (
    <main className="mx-auto max-w-4xl px-5 py-8">
      <Link href="/" className="text-xs text-blue-600 hover:underline">
        ← 返回工作台
      </Link>
      <header className="mb-4 mt-2">
        <h1 className="text-2xl font-semibold tracking-tight">导入报告（Admin）</h1>
        <p className="mt-1 text-sm text-gray-500">
          legacy import 批次、异常块与数据来源（Phase 0 只读视图）
        </p>
      </header>

      <div className="mb-6">
        <SourceBanner source={r.source} />
      </div>

      {/* 6.3 数据来源区分 */}
      <section className="mb-8">
        <h2 className="mb-2 text-sm font-semibold text-gray-700">数据来源区分</h2>
        <Card>
          <ul className="space-y-2">
            {ORIGINS.map((o) => (
              <li key={o} className="flex items-start gap-3">
                <span className="mt-0.5 flex w-24 shrink-0 items-center justify-between gap-2">
                  <OriginBadge origin={o} />
                  <span className="text-lg font-semibold tabular-nums">{r.originCounts[o]}</span>
                </span>
                <span className="text-xs text-gray-500">{ORIGIN_DESC[o]}</span>
              </li>
            ))}
          </ul>
          {r.originCounts.ai_generated === 0 && (
            <p className="mt-3 rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-500">
              Phase 0 没有 AI 生成数据；示例课包等系统生成内容已标注为「系统生成」，不冒充人工导入。
            </p>
          )}

          {r.originByType.length > 0 && (
            <div className="mt-4">
              <div className="mb-1 text-xs font-semibold text-gray-600">已发布实体按类型</div>
              <ul className="divide-y divide-gray-100 text-sm">
                {r.originByType.map((row) => (
                  <li key={`${row.entityType}:${row.origin}`} className="flex items-center justify-between gap-2 py-1.5">
                    <span className="flex items-center gap-2">
                      <span className="font-mono text-xs text-gray-500">{row.entityType}</span>
                      <OriginBadge origin={row.origin} />
                    </span>
                    <span className="tabular-nums text-gray-700">{row.count}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      </section>

      {/* 6.1 导入批次报告 */}
      <section className="mb-8">
        <h2 className="mb-2 text-sm font-semibold text-gray-700">导入批次（{r.runs.length}）</h2>
        <div className="space-y-3">
          {r.runs.length > 0 ? (
            r.runs.map((run) => <RunCard key={run.id} run={run} />)
          ) : (
            <p className="text-sm text-gray-400">暂无导入批次。运行 legacy import 后此处展示报告。</p>
          )}
        </div>
      </section>

      {/* 6.2 异常块列表 */}
      <section>
        <h2 className="mb-2 text-sm font-semibold text-gray-700">异常块（{r.exceptions.length}）</h2>
        <div className="space-y-3">
          {r.exceptions.length > 0 ? (
            r.exceptions.map((e) => <ExceptionRow key={e.id} e={e} />)
          ) : (
            <p className="text-sm text-gray-400">无 error / quarantine 异常块。</p>
          )}
        </div>
      </section>
    </main>
  );
}
