import Link from "next/link";
import { buildDashboard, loadSeed } from "../lib/seed";
import { loadReadyPackets, packetSlug } from "../lib/packets";
import {
  Badge,
  Card,
  COURSE_STATUS_TONE,
  SourceBanner,
  SourceRef,
} from "../components/ui";
import { ConfirmButton } from "../components/ConfirmButton";
import type { CourseProgress } from "../lib/types";

// Read fresh personal state per request, and never connect to the DB at build
// time (build succeeds with no DB via the fixture fallback).
export const dynamic = "force-dynamic";

function CourseRow({ p }: { p: CourseProgress }) {
  return (
    <Link
      href={`/subjects/${p.course.courseCode}`}
      className="block rounded-lg border border-gray-100 p-3 hover:border-gray-300 hover:bg-gray-50"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">
          {p.course.name}{" "}
          <span className="text-xs text-gray-400">{p.course.courseCode}</span>
        </span>
        <span className="flex items-center gap-1">
          {p.maintenance && <Badge tone="green">维护 / 抗遗忘</Badge>}
          <Badge tone={COURSE_STATUS_TONE[p.course.examStatus] ?? "gray"}>
            {p.course.examStatus}
          </Badge>
        </span>
      </div>
      {p.total > 0 ? (
        <div className="mt-2">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
            <div className="h-full rounded-full bg-blue-500" style={{ width: `${p.pct}%` }} />
          </div>
          <div className="mt-1 flex items-center justify-between text-xs text-gray-500">
            <span>
              掌握 {p.mastered}/{p.total}（{p.pct}%）
            </span>
            <SourceRef sourceBlockId={p.sourceBlockId} />
          </div>
        </div>
      ) : (
        <div className="mt-1 text-xs text-gray-400">暂无知识点进度</div>
      )}
    </Link>
  );
}

export default async function DashboardPage() {
  const bundle = await loadSeed();
  const d = buildDashboard(bundle);
  const { packets } = await loadReadyPackets();

  return (
    <main className="mx-auto max-w-4xl px-5 py-8">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">学习工作台</h1>
          <p className="mt-1 text-sm text-gray-500">无需登录的 demo 学习空间</p>
        </div>
        <div className="text-right">
          <div className="text-sm font-medium">{d.examTrack?.title ?? "考期未知"}</div>
          <div className="text-xs text-gray-500">
            {d.examDate ? `考试日期 ${d.examDate}` : "日期未知"}
            {d.countdownDays != null && (
              <span className="ml-1 font-semibold text-blue-600">· 倒计时 {d.countdownDays} 天</span>
            )}
          </div>
        </div>
      </header>

      <div className="mb-5">
        <SourceBanner source={d.source} />
      </div>

      {d.conflicts.length > 0 && (
        <Card className="mb-5 border-amber-200 bg-amber-50">
          <div className="mb-1 text-sm font-semibold text-amber-900">数据一致性提醒（已按权威来源取值）</div>
          <ul className="space-y-1 text-xs text-amber-800">
            {d.conflicts.map((c, i) => (
              <li key={i}>
                <span className="font-medium">[{c.kind}]</span> {c.message}
                {c.authoritative && <span className="ml-1 text-amber-600">取值：{c.authoritative}</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* 今日任务（task 4.3）— 门控后的待复习 / 活跃错题，与上方去重总量口径不同 */}
      <section className="mb-6 grid gap-3 md:grid-cols-2">
        <Card>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-700">今日待复习</h2>
            <span className="text-xs text-gray-400">门控：due ≤ 今天 · 未被确认</span>
          </div>
          {d.todayReviews.length > 0 ? (
            <ul className="space-y-1 text-sm">
              {d.todayReviews.slice(0, 8).map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2">
                  <span>
                    <span className="text-gray-400">{r.courseName ?? r.courseCode ?? "—"}</span>{" "}
                    {r.kpCode}
                    {r.dueDate && <span className="ml-1 text-xs text-amber-500">due {r.dueDate.slice(0, 10)}</span>}
                  </span>
                  {r.origin === "system" ? (
                    <ConfirmButton kind="review" id={r.id} />
                  ) : (
                    <Badge tone="gray">导入</Badge>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-sm text-gray-400">今日无待复习。</div>
          )}
          {d.todayReviews.length > 8 && (
            <div className="mt-1 text-xs text-gray-400">…共 {d.todayReviews.length} 项</div>
          )}
        </Card>

        <Card>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-700">活跃错题</h2>
            <span className="text-xs text-gray-400">门控：未被确认</span>
          </div>
          {d.activeMistakes.length > 0 ? (
            <ul className="space-y-1 text-sm">
              {d.activeMistakes.slice(0, 8).map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-2">
                  <span>
                    <span className="text-gray-400">{m.courseName ?? m.courseCode ?? "—"}</span>{" "}
                    {m.kpCode ?? m.questionRef ?? "—"}
                    {m.category && <span className="ml-1 text-xs text-amber-500">{m.category}</span>}
                  </span>
                  {m.origin === "system" ? (
                    <ConfirmButton kind="mistake" id={m.id} />
                  ) : (
                    <Badge tone="gray">导入</Badge>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-sm text-gray-400">无活跃错题。</div>
          )}
          {d.activeMistakes.length > 8 && (
            <div className="mt-1 text-xs text-gray-400">…共 {d.activeMistakes.length} 项</div>
          )}
        </Card>
      </section>

      <section className="mb-6">
        <h2 className="mb-2 text-sm font-semibold text-gray-700">本考期科目（按考试状态优先级）</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          {d.current.length > 0 ? (
            d.current.map((p) => <CourseRow key={p.course.courseCode} p={p} />)
          ) : (
            <p className="text-sm text-gray-400">无在考科目。</p>
          )}
        </div>
      </section>

      <section className="mb-6 grid gap-3 sm:grid-cols-3">
        <Card>
          <div className="text-xs text-gray-500">待复习（去重总量）</div>
          <div className="text-2xl font-semibold">{d.reviewDue}</div>
        </Card>
        <Card>
          <div className="text-xs text-gray-500">错题（去重总量）</div>
          <div className="text-2xl font-semibold">{d.mistakeCount}</div>
        </Card>
        <Card>
          <div className="text-xs text-gray-500">薄弱点</div>
          {d.weakPoints.length > 0 ? (
            <ul className="mt-1 space-y-0.5 text-sm">
              {d.weakPoints.map((w) => (
                <li key={w.courseCode} className="flex justify-between">
                  <span>{w.name}</span>
                  <span className="text-amber-600">{w.pct}%</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-sm text-gray-400">无</div>
          )}
        </Card>
      </section>

      {/* 学习上下文恢复（task 4.4）：维护课程 + 最近 daily_logs */}
      <section className="mb-6">
        <h2 className="mb-2 text-sm font-semibold text-gray-700">学习上下文</h2>
        <Card>
          {d.maintenanceCourses.length > 0 && (
            <div className="mb-3">
              <div className="mb-1 text-xs text-gray-500">维护 / 抗遗忘课程（高完成度，非从零开始）</div>
              <div className="flex flex-wrap gap-2">
                {d.maintenanceCourses.map((c) => (
                  <Badge key={c.courseCode} tone="green">
                    {c.name} {c.courseCode}
                  </Badge>
                ))}
              </div>
            </div>
          )}
          <div className="mb-1 text-xs text-gray-500">最近学习记录（daily_logs）</div>
          {d.recentLogs.length > 0 ? (
            <ul className="space-y-1 text-sm">
              {d.recentLogs.map((l) => (
                <li key={l.id} className="flex gap-2">
                  <span className="shrink-0 text-gray-400">{l.date}</span>
                  <span className="text-gray-700">{l.summary}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-sm text-gray-400">暂无学习记录。</div>
          )}
        </Card>
      </section>

      {/* 可学课包（task 4.1 入口）+ 练习筛选（task 4.5 入口） */}
      <section className="mb-6">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700">可学课包（ready）</h2>
          <Link href="/practice" className="text-xs font-medium text-blue-600 hover:underline">
            题库练习筛选 →
          </Link>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {packets.map((p) => (
            <Link
              key={p.id}
              href={`/learn/${packetSlug(p.id)}`}
              className="block rounded-lg border border-gray-100 p-3 hover:border-gray-300 hover:bg-gray-50"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{p.title}</span>
                <Badge tone="green">{p.status}</Badge>
              </div>
              <div className="mt-1 text-xs text-gray-500">
                {p.courseCode} · {p.stepCount} 步 · 知识点 {p.kpCodes.join("、") || "—"}
              </div>
            </Link>
          ))}
          {packets.length === 0 && <p className="text-sm text-gray-400">暂无 ready 课包。</p>}
        </div>
      </section>

      {(d.passed.length > 0 || d.other.length > 0) && (
        <section className="mb-6">
          <h2 className="mb-2 text-sm font-semibold text-gray-700">其他科目</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {[...d.passed, ...d.other].map((p) => (
              <CourseRow key={p.course.courseCode} p={p} />
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
