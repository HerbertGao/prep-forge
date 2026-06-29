import Link from "next/link";
import { buildDashboard, loadSeed } from "../lib/seed";
import {
  Badge,
  Card,
  COURSE_STATUS_TONE,
  SourceBanner,
  SourceRef,
} from "../components/ui";
import { SAMPLE_LESSON_ID } from "../lib/sampleLessonPacket";
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
        <Badge tone={COURSE_STATUS_TONE[p.course.examStatus] ?? "gray"}>
          {p.course.examStatus}
        </Badge>
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

  return (
    <main className="mx-auto max-w-4xl px-5 py-8">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">学习工作台</h1>
          <p className="mt-1 text-sm text-gray-500">无需登录的 demo 学习空间（Phase 0）</p>
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

      <section className="mb-6">
        <h2 className="mb-2 text-sm font-semibold text-gray-700">本考期科目</h2>
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
          <div className="text-xs text-gray-500">待复习</div>
          <div className="text-2xl font-semibold">{d.reviewDue}</div>
        </Card>
        <Card>
          <div className="text-xs text-gray-500">错题</div>
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

      <section className="rounded-xl border border-amber-200 bg-amber-50 p-4">
        <div className="mb-1 flex items-center gap-2">
          <h2 className="text-sm font-semibold text-amber-900">示例课包（系统生成）</h2>
          <Badge tone="amber">示例 / 系统生成</Badge>
        </div>
        <p className="mb-3 text-xs text-amber-800">
          课包是 Phase 2 产物，ai-teacher 无此数据。下面是系统提供的示例，不代表导入的真实数据。
        </p>
        <div className="flex gap-3 text-sm">
          <Link href={`/lessons/${SAMPLE_LESSON_ID}`} className="font-medium text-blue-600 hover:underline">
            查看示例课包 →
          </Link>
          <Link href={`/learn/${SAMPLE_LESSON_ID}`} className="font-medium text-blue-600 hover:underline">
            开始 demo 课堂 →
          </Link>
        </div>
      </section>
    </main>
  );
}
