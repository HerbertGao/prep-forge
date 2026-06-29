import Link from "next/link";
import { loadPractice } from "../../lib/practice";
import { Badge, Card, SourceBanner } from "../../components/ui";
import { PracticeBoard } from "./PracticeBoard";

// 题库练习筛选（task 4.5）。GET form drives the filters via the URL; answers open
// a session and flow through session_events → applier (PracticeBoard).
export const dynamic = "force-dynamic";

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function PracticePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const filters = {
    courseCode: first(sp.course),
    kpCode: first(sp.kp),
    type: first(sp.type),
    mistakes: first(sp.mistakes) === "1",
  };
  const data = await loadPractice(filters);

  return (
    <main className="mx-auto max-w-4xl px-5 py-8">
      <Link href="/" className="text-xs text-blue-600 hover:underline">
        ← 返回工作台
      </Link>
      <h1 className="mb-1 mt-2 text-2xl font-semibold tracking-tight">题库练习筛选</h1>
      <p className="mb-4 text-sm text-gray-500">
        基于导入题库，按课程 / 知识点 / 题型 / 错题筛选；作答开 session 走 events → applier。
      </p>

      <div className="mb-5">
        <SourceBanner source={data.source} />
      </div>

      <Card className="mb-5">
        <form method="get" className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
          <label className="text-xs text-gray-600">
            课程
            <select name="course" defaultValue={filters.courseCode ?? ""} className="mt-1 w-full rounded-md border border-gray-200 p-1.5 text-sm">
              <option value="">— 选择课程 —</option>
              {data.courses.map((c) => (
                <option key={c.courseCode} value={c.courseCode}>
                  {c.name}（{c.courseCode}）
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-gray-600">
            知识点
            <select name="kp" defaultValue={filters.kpCode ?? ""} className="mt-1 w-full rounded-md border border-gray-200 p-1.5 text-sm">
              <option value="">— 全部知识点 —</option>
              {data.kps.map((k) => (
                <option key={k.kpCode} value={k.kpCode}>
                  {k.kpCode} {k.title}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-gray-600">
            题型
            <select name="type" defaultValue={filters.type ?? ""} className="mt-1 w-full rounded-md border border-gray-200 p-1.5 text-sm">
              <option value="">— 全部题型 —</option>
              {data.types.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-end gap-2 text-xs text-gray-600">
            <span className="flex items-center gap-1">
              <input type="checkbox" name="mistakes" value="1" defaultChecked={filters.mistakes} />
              仅错题相关知识点
            </span>
          </label>
          <div className="sm:col-span-2 md:col-span-4">
            <button type="submit" className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700">
              筛选
            </button>
            <span className="ml-2 text-xs text-gray-400">按考频排序 · 最多 50 题</span>
          </div>
        </form>
      </Card>

      {!filters.courseCode ? (
        <p className="text-sm text-gray-400">请选择课程以加载题目。</p>
      ) : data.questions.length === 0 ? (
        <p className="text-sm text-gray-400">无匹配题目。</p>
      ) : (
        <div className="mb-2 flex items-center gap-2 text-sm text-gray-600">
          <Badge tone="blue">{data.questions.length} 题</Badge>
          <span className="text-xs text-gray-400">作答即开 session、由 applier 确定性更新状态</span>
        </div>
      )}
      {filters.courseCode && data.questions.length > 0 && <PracticeBoard questions={data.questions} />}
    </main>
  );
}
