import Link from "next/link";
import { loadImportReport, ORIGINS } from "../../lib/admin";
import type { ExceptionBlock, ImportRunReport } from "../../lib/admin";
import {
  confirmId,
  loadAllPackets,
  loadContentConfirmations,
  loadPacket,
  type PacketView,
} from "../../lib/packets";
import {
  loadAiGeneratedPackets,
  loadConfirmedKpCodes,
  loadPrepJobs,
} from "../../lib/prep";
import { Badge, Card, OriginBadge, SourceBanner } from "../../components/ui";
import { ContentConfirmButton } from "../../components/ConfirmButton";
import {
  ConfirmDraftButton,
  GenerateDraftButton,
  RevalidateJobButton,
} from "../../components/PrepButtons";

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

/** Packet list (task 5.1) + question/answer/KP verification path (task 5.2). */
function PacketCard({ packet, confirmed }: { packet: PacketView; confirmed: Map<string, string> }) {
  const practiceQuestions = packet.steps.flatMap((s) => s.questions);
  return (
    <Card>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="font-medium">{packet.title}</span>
        <span className="text-xs text-gray-400">{packet.id}</span>
        <Badge tone={packet.status === "ready" ? "green" : packet.status === "consumed" ? "blue" : "amber"}>
          {packet.status}
        </Badge>
      </div>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
        <span>步骤 {packet.steps.length}</span>
        <span>·</span>
        <span>知识点：</span>
        {packet.kpCodes.map((k) => (
          <Badge key={k} tone="blue">
            {k}
          </Badge>
        ))}
      </div>
      {practiceQuestions.length > 0 && (
        <details className="mt-1">
          <summary className="cursor-pointer text-xs text-blue-600">
            人工确认题目 / 答案 / 知识点映射（只读，不覆盖导入来源数据）
          </summary>
          <ul className="mt-2 space-y-2">
            {practiceQuestions.map((q) => (
              <li key={q.id} className="rounded-md border border-gray-100 p-2 text-xs">
                <div className="font-mono text-gray-400">{q.id}</div>
                <div className="text-gray-800">{q.stem}</div>
                <div className="mt-1 text-gray-600">
                  <span className="font-medium">答案：</span>
                  {q.answer ?? "—"}
                  <span className="ml-2 font-medium">知识点：</span>
                  {q.kpCodes.join("、") || "—"}
                </div>
                <div className="mt-2 flex flex-wrap gap-3">
                  {/* Each confirm targets the CONFIRMED row's OWN id (design D11):
                      answer → the question_solutions row id; kp_link → each
                      question_kp_links row id (one button per link, so multiple
                      KP links no longer collapse into a single audit row). */}
                  <ContentConfirmButton
                    entityType="question"
                    entityId={q.id}
                    label="题目"
                    confirmedAt={confirmed.get(confirmId("question", q.id)) ?? null}
                  />
                  {q.solutionId && (
                    <ContentConfirmButton
                      entityType="answer"
                      entityId={q.solutionId}
                      label="答案"
                      confirmedAt={confirmed.get(confirmId("answer", q.solutionId)) ?? null}
                    />
                  )}
                  {(q.kpLinks ?? []).map((link) => (
                    <ContentConfirmButton
                      key={link.id}
                      entityType="kp_link"
                      entityId={link.id}
                      label={`知识点映射 ${link.kpCode}`}
                      confirmedAt={confirmed.get(confirmId("kp_link", link.id)) ?? null}
                    />
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}

const JOB_TONE: Record<string, "green" | "red" | "amber" | "blue" | "gray"> = {
  done: "green",
  failed: "red",
  validating: "amber",
  running: "amber",
  pending: "blue",
};

/** AI 草包生成 + 校验门 + 逐包上线（group G7, design D3/D5/D11）。 */
function PrepSection({
  confirmedKps,
  jobs,
  aiPackets,
}: {
  confirmedKps: string[];
  jobs: Awaited<ReturnType<typeof loadPrepJobs>>;
  aiPackets: Awaited<ReturnType<typeof loadAiGeneratedPackets>>;
}) {
  return (
    <section className="mb-8">
      <h2 className="mb-2 text-sm font-semibold text-gray-700">AI 草包生成（Phase 2）</h2>
      <p className="mb-2 text-xs text-gray-500">
        选已确认知识点 → BFF 创建 prep_job → worker 生成 validating 草稿 → BFF 三道硬门 → draft/quarantine →
        逐包确认 ready。worker 失败/孤儿可「重新校验」。
      </p>

      <Card className="mb-3">
        <div className="mb-1 text-xs font-semibold text-gray-600">已确认知识点（{confirmedKps.length}）</div>
        {confirmedKps.length > 0 ? (
          <ul className="space-y-1">
            {confirmedKps.map((kp) => (
              <li key={kp} className="flex items-center gap-3 text-xs">
                <Badge tone="blue">{kp}</Badge>
                <GenerateDraftButton kpCode={kp} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-gray-400">
            暂无已确认的 kp_link。先在上方课包列表对题目 / 答案 / 知识点映射点「确认」。
          </p>
        )}
      </Card>

      <Card className="mb-3">
        <div className="mb-1 text-xs font-semibold text-gray-600">prep_jobs（{jobs.length}）</div>
        {jobs.length > 0 ? (
          <ul className="divide-y divide-gray-100 text-xs">
            {jobs.map((j) => (
              <li key={j.id} className="flex flex-wrap items-center gap-2 py-1.5">
                <Badge tone={JOB_TONE[j.status] ?? "gray"}>{j.status}</Badge>
                <span className="font-medium">{j.kpCode}</span>
                <span className="text-gray-400">尝试 {j.attemptCount}</span>
                <span className="font-mono text-gray-400">{j.id.slice(0, 18)}…</span>
                {j.failureReason && <span className="text-red-700">{j.failureReason}</span>}
                {(j.status === "running" || j.status === "validating") && (
                  <RevalidateJobButton jobId={j.id} />
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-gray-400">暂无 prep job。</p>
        )}
      </Card>

      <Card>
        <div className="mb-1 text-xs font-semibold text-gray-600">AI 草包（{aiPackets.length}）</div>
        {aiPackets.length > 0 ? (
          <ul className="space-y-2">
            {aiPackets.map((p) => (
              <li key={p.id} className="rounded-md border border-gray-100 p-2 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={p.status === "ready" ? "green" : p.status === "quarantine" ? "red" : "amber"}>
                    {p.status}
                  </Badge>
                  <span className="font-medium">{p.title}</span>
                  <span className="font-mono text-gray-400">{p.id}</span>
                  {p.kpCodes.map((k) => (
                    <Badge key={k} tone="blue">
                      {k}
                    </Badge>
                  ))}
                  {p.status === "draft" && <ConfirmDraftButton lessonPacketId={p.id} />}
                </div>
                <div className="mt-1 text-gray-500">
                  来源：
                  {p.generationSources.length > 0
                    ? p.generationSources.map((s) => `${s.sourceType}:${s.sourceId}`).join("、")
                    : "—"}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-gray-400">暂无 AI 生成草包。</p>
        )}
      </Card>
    </section>
  );
}

export default async function AdminImportsPage() {
  const r = await loadImportReport();
  const { packets: packetSummaries } = await loadAllPackets();
  const confirmed = await loadContentConfirmations();
  const [prepJobs, confirmedKps, aiPackets] = await Promise.all([
    loadPrepJobs(),
    loadConfirmedKpCodes(),
    loadAiGeneratedPackets(),
  ]);
  const packetViews = (
    await Promise.all(
      packetSummaries
        .filter((p) => p.status === "ready" || p.status === "consumed")
        .map((p) => loadPacket(p.id)),
    )
  )
    .filter((x): x is { source: "db" | "fixture"; packet: PacketView } => x !== null)
    .map((x) => x.packet);

  return (
    <main className="mx-auto max-w-4xl px-5 py-8">
      <Link href="/" className="text-xs text-blue-600 hover:underline">
        ← 返回工作台
      </Link>
      <header className="mb-4 mt-2">
        <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
        <p className="mt-1 text-sm text-gray-500">
          课包检视 + 人工确认、legacy import 批次、异常块与数据来源
        </p>
      </header>

      <div className="mb-6">
        <SourceBanner source={r.source} />
      </div>

      {/* 5.1 课包列表 + 5.2 题目/答案/知识点映射检视 */}
      <section className="mb-8">
        <h2 className="mb-2 text-sm font-semibold text-gray-700">课包列表（{packetSummaries.length}）</h2>
        <p className="mb-2 text-xs text-gray-500">
          错题 / 复习的人工确认在「今日任务」上对 origin=system 行写 admin_confirmed_at（不触碰导入行）。
        </p>
        <div className="space-y-3">
          {packetSummaries.map((p) => {
            const view = packetViews.find((v) => v.id === p.id);
            return view ? (
              <PacketCard key={p.id} packet={view} confirmed={confirmed} />
            ) : (
              <Card key={p.id}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{p.title}</span>
                  <span className="text-xs text-gray-400">{p.id}</span>
                  <Badge tone="amber">{p.status}</Badge>
                  <span className="text-xs text-gray-500">
                    步骤 {p.stepCount} · 知识点 {p.kpCodes.join("、") || "—"}
                  </span>
                </div>
              </Card>
            );
          })}
          {packetSummaries.length === 0 && <p className="text-sm text-gray-400">暂无课包。</p>}
        </div>
      </section>

      {/* 7.5 AI 草包生成 + 三道门 + 逐包上线 */}
      <PrepSection confirmedKps={confirmedKps} jobs={prepJobs} aiPackets={aiPackets} />

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
