import Link from "next/link";
import { notFound } from "next/navigation";
import {
  SAMPLE_LESSON_ID,
  SAMPLE_LESSON_PACKET,
  SAMPLE_QUESTIONS,
} from "../../../lib/sampleLessonPacket";
import { Badge, Card, OriginBadge } from "../../../components/ui";
import { StepContent } from "../../../components/StepContent";

export default async function LessonViewerPage({
  params,
}: {
  params: Promise<{ lessonId: string }>;
}) {
  const { lessonId } = await params;
  if (lessonId !== SAMPLE_LESSON_ID) notFound();
  const p = SAMPLE_LESSON_PACKET;

  return (
    <main className="mx-auto max-w-3xl px-5 py-8">
      <Link href="/" className="text-xs text-blue-600 hover:underline">
        ← 返回工作台
      </Link>

      <div className="mb-4 mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        本课包为<strong>示例 / 系统生成</strong>（origin=system），非 ai-teacher 导入的真实数据。
      </div>

      <header className="mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{p.title}</h1>
          <OriginBadge origin={p.origin} />
          <Badge tone="gray">v{p.version}</Badge>
          <Badge tone="green">{p.status}</Badge>
        </div>
        <p className="mt-1 text-xs text-gray-500">
          {p.courseCode} · 预计 {p.estimatedMinutes} 分钟 · 难度 {p.difficulty}
        </p>
      </header>

      <Card className="mb-4">
        <div className="text-sm font-semibold text-gray-700">学习目标</div>
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-gray-700">
          {p.objectives?.map((o, i) => <li key={i}>{o}</li>)}
        </ul>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <span className="text-gray-500">关联知识点：</span>
          {p.kpCodes.map((k) => (
            <Badge key={k} tone="blue">
              {k}
            </Badge>
          ))}
          {p.prerequisites && p.prerequisites.length > 0 && (
            <>
              <span className="ml-2 text-gray-500">前置：</span>
              {p.prerequisites.map((k) => (
                <Badge key={k} tone="gray">
                  {k}
                </Badge>
              ))}
            </>
          )}
        </div>
      </Card>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-700">课包步骤</h2>
        {p.steps.map((step, i) => (
          <Card key={step.id}>
            <div className="mb-1 text-xs text-gray-400">步骤 {i + 1}</div>
            <StepContent step={step} questions={SAMPLE_QUESTIONS} />
          </Card>
        ))}
      </section>

      <div className="mt-6">
        <Link
          href={`/learn/${SAMPLE_LESSON_ID}`}
          className="inline-block rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          进入 demo 课堂 →
        </Link>
      </div>
    </main>
  );
}
