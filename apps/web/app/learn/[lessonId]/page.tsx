import Link from "next/link";
import { notFound } from "next/navigation";
import {
  SAMPLE_LESSON_ID,
  SAMPLE_LESSON_PACKET,
  SAMPLE_QUESTIONS,
} from "../../../lib/sampleLessonPacket";
import { Classroom } from "./Classroom";

export default async function LearnPage({
  params,
}: {
  params: Promise<{ lessonId: string }>;
}) {
  const { lessonId } = await params;
  if (lessonId !== SAMPLE_LESSON_ID) notFound();

  return (
    <main className="mx-auto max-w-4xl px-5 py-8">
      <div className="mb-3 flex items-center justify-between">
        <Link href="/" className="text-xs text-blue-600 hover:underline">
          ← 返回工作台
        </Link>
        <Link href={`/lessons/${SAMPLE_LESSON_ID}`} className="text-xs text-blue-600 hover:underline">
          查看完整课包 →
        </Link>
      </div>
      <h1 className="mb-4 text-xl font-semibold tracking-tight">Demo 课堂</h1>
      <Classroom packet={SAMPLE_LESSON_PACKET} questions={SAMPLE_QUESTIONS} />
    </main>
  );
}
