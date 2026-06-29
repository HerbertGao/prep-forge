import Link from "next/link";
import { notFound } from "next/navigation";
import { buildSubject, loadSeed } from "../../../lib/seed";
import {
  Badge,
  Card,
  COURSE_STATUS_TONE,
  KP_STATE_LABEL,
  KP_STATE_TONE,
  OriginBadge,
  SourceBanner,
} from "../../../components/ui";

export const dynamic = "force-dynamic";

export default async function SubjectPage({
  params,
}: {
  params: Promise<{ subjectCode: string }>;
}) {
  const { subjectCode } = await params;
  const bundle = await loadSeed();
  const s = buildSubject(bundle, subjectCode);
  if (!s) notFound();

  return (
    <main className="mx-auto max-w-4xl px-5 py-8">
      <Link href="/" className="text-xs text-blue-600 hover:underline">
        ← 返回工作台
      </Link>
      <header className="mb-4 mt-2 flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{s.course.name}</h1>
        <span className="text-sm text-gray-400">{s.course.courseCode}</span>
        <Badge tone={COURSE_STATUS_TONE[s.course.examStatus] ?? "gray"}>{s.course.examStatus}</Badge>
        <OriginBadge origin={s.course.origin} />
      </header>

      <div className="mb-5">
        <SourceBanner source={s.source} />
      </div>

      <section className="mb-6">
        <h2 className="mb-2 text-sm font-semibold text-gray-700">知识点状态摘要</h2>
        <div className="flex flex-wrap gap-2">
          {(["mastered", "practiced", "taught", "unseen"] as const).map((st) => (
            <Card key={st} className="flex-1 min-w-[120px]">
              <div className="text-xs text-gray-500">{KP_STATE_LABEL[st]}</div>
              <div className="text-2xl font-semibold">{s.stateSummary[st] ?? 0}</div>
            </Card>
          ))}
        </div>
      </section>

      <section className="mb-6">
        <h2 className="mb-2 text-sm font-semibold text-gray-700">章节与知识点</h2>
        {s.chapters.length === 0 && s.kps.length === 0 ? (
          <p className="text-sm text-gray-400">暂无导入的章节 / 知识点。</p>
        ) : (
          <div className="space-y-3">
            {s.chapters.map((ch) => (
              <Card key={ch.chapterNo}>
                <div className="mb-2 font-medium">
                  第 {ch.chapterNo} 章 · {ch.title}
                </div>
                <ul className="space-y-1">
                  {s.kps
                    .filter((k) => k.chapterNo === ch.chapterNo)
                    .map((k) => (
                      <li key={k.kpCode} className="flex items-center justify-between gap-2 text-sm">
                        <span>
                          <span className="text-gray-400">{k.kpCode}</span> {k.title}
                          {k.examFrequency && (
                            <span className="ml-2 text-xs text-amber-500">考频 {k.examFrequency}</span>
                          )}
                        </span>
                        <Badge tone={KP_STATE_TONE[k.state ?? "unseen"] ?? "gray"}>
                          {KP_STATE_LABEL[k.state ?? "unseen"]}
                        </Badge>
                      </li>
                    ))}
                </ul>
              </Card>
            ))}
            {/* KPs without a mapped chapter */}
            {s.kps.filter((k) => !k.chapterNo || !s.chapters.some((c) => c.chapterNo === k.chapterNo))
              .length > 0 && (
              <Card>
                <div className="mb-2 font-medium text-gray-500">未归章知识点</div>
                <ul className="space-y-1">
                  {s.kps
                    .filter((k) => !k.chapterNo || !s.chapters.some((c) => c.chapterNo === k.chapterNo))
                    .map((k) => (
                      <li key={k.kpCode} className="flex items-center justify-between gap-2 text-sm">
                        <span>
                          <span className="text-gray-400">{k.kpCode}</span> {k.title}
                        </span>
                        <Badge tone={KP_STATE_TONE[k.state ?? "unseen"] ?? "gray"}>
                          {KP_STATE_LABEL[k.state ?? "unseen"]}
                        </Badge>
                      </li>
                    ))}
                </ul>
              </Card>
            )}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-gray-700">题库摘要</h2>
        {s.bank ? (
          <Card>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <div className="text-xs text-gray-500">解析题量</div>
                <div className="text-xl font-semibold">{s.bank.parsed ?? "—"}</div>
                {s.bank.declared != null && (
                  <div className="text-xs text-gray-400">stats.md 声称 {s.bank.declared}</div>
                )}
              </div>
              <div>
                <div className="text-xs text-gray-500">知识点覆盖</div>
                <div className="text-xl font-semibold">
                  {s.bank.coveredKps}/{s.bank.totalKps}
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500">来源范围</div>
                <div className="text-sm">{s.bank.sources.join("、") || "—"}</div>
              </div>
            </div>

            <div className="mt-3">
              <div className="mb-1 text-xs text-gray-500">题型分布</div>
              <div className="flex flex-wrap gap-2">
                {s.bank.typeDistribution.length > 0 ? (
                  s.bank.typeDistribution.map((t) => (
                    <Badge key={t.type} tone="gray">
                      {t.type}：{t.count}
                    </Badge>
                  ))
                ) : (
                  <span className="text-sm text-gray-400">—</span>
                )}
              </div>
            </div>

            {s.bank.mismatch && (
              <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                ⚠ 声称题量（{s.bank.declared}）与实际解析题量（{s.bank.parsed}）不一致，未静默展示陈旧数字。
              </div>
            )}
          </Card>
        ) : (
          <p className="text-sm text-gray-400">暂无题库统计。</p>
        )}
      </section>
    </main>
  );
}
