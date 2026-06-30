import Link from "next/link";
import { notFound } from "next/navigation";
import { idFromSlug, loadPacket } from "../../../lib/packets";
import { Badge } from "../../../components/ui";
import { Classroom } from "./Classroom";

// Read the live packet status per request; never connect at build time.
export const dynamic = "force-dynamic";

export default async function LearnPage({
  params,
}: {
  params: Promise<{ lessonId: string }>;
}) {
  const { lessonId } = await params;
  const loaded = await loadPacket(idFromSlug(lessonId));
  if (!loaded) notFound();
  const { packet, source } = loaded;

  return (
    <main className="mx-auto max-w-4xl px-5 py-8">
      <div className="mb-3 flex items-center justify-between">
        <Link href="/" className="text-xs text-blue-600 hover:underline">
          ← 返回工作台
        </Link>
        <span className="text-xs text-gray-400">
          {packet.courseCode} · {packet.kpCodes.join("、")}
        </span>
      </div>
      <div className="mb-4 flex items-center gap-2">
        <h1 className="text-xl font-semibold tracking-tight">{packet.title}</h1>
        <Badge tone={packet.status === "ready" ? "green" : "gray"}>{packet.status}</Badge>
      </div>
      {packet.status === "consumed" && (
        <p className="mb-3 text-xs text-amber-700">
          此课包已完成（consumed）。可重新走一遍；完成事件幂等，applier 重折叠得到一致进度。
        </p>
      )}
      <Classroom packet={packet} source={source} />
    </main>
  );
}
