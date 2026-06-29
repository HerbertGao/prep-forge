"use client";

// Basic classroom skeleton (tasks 5.7/5.8/5.9). Start demo packet → show steps →
// submit answers, producing local/demo session events (lesson_started /
// step_shown / student_answered / lesson_completed). Events use the shared
// SessionEvent envelope and are sent to the server action, which persists ONLY
// into session_events. No mastery / mistake / review state is touched (决策 7).
import { useEffect, useRef, useState } from "react";
import { SessionEvent, type SessionEventType } from "@prep-forge/schemas";
import type { LessonPacket } from "@prep-forge/schemas";
import { StepContent } from "../../../components/StepContent";
import { Badge, Card } from "../../../components/ui";
import type { DemoQuestion } from "../../../lib/sampleLessonPacket";
import { recordSessionEvent } from "./actions";

type LoggedEvent = SessionEvent & { persisted: boolean | null };

const ANSWERABLE = new Set(["diagnostic_question", "socratic_question", "practice"]);

export function Classroom({
  packet,
  questions,
}: {
  packet: LessonPacket;
  questions: Record<string, DemoQuestion>;
}) {
  const [index, setIndex] = useState(0);
  const [events, setEvents] = useState<LoggedEvent[]>([]);
  const [answer, setAnswer] = useState("");
  const [completed, setCompleted] = useState(false);
  const sessionRef = useRef<string | null>(null);
  const seqRef = useRef(0);
  const startedRef = useRef(false);

  const step = packet.steps[index];
  const isLast = index === packet.steps.length - 1;

  function emit(
    eventType: SessionEventType,
    extra: { stepId?: string; payload?: unknown } = {},
  ) {
    const sessionId = sessionRef.current;
    if (!sessionId) return;
    const seq = seqRef.current++;
    const event = SessionEvent.parse({
      id: `${sessionId}:${seq}`,
      sessionId,
      eventType,
      eventVersion: 1,
      sequence: seq,
      actorType: eventType === "student_answered" ? "student" : "system",
      idempotencyKey: `${eventType}:${seq}`,
      occurredAt: new Date().toISOString(),
      tenantId: "demo",
      lessonPacketId: packet.id,
      stepId: extra.stepId ?? null,
      payload: extra.payload,
    });
    setEvents((prev) => [...prev, { ...event, persisted: null }]);
    const settle = (persisted: boolean): void =>
      setEvents((prev) => prev.map((e) => (e.id === event.id ? { ...e, persisted } : e)));
    // recordSessionEvent already returns { persisted: false } on a DB error, but
    // guard the call itself rejecting so it never surfaces as an unhandled rejection.
    void recordSessionEvent(sessionId, event).then((r) => settle(r.persisted), () => settle(false));
  }

  // Start the demo lesson once on mount: lesson_started + step_shown(step 0).
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    sessionRef.current = crypto.randomUUID();
    emit("lesson_started");
    if (packet.steps[0]) emit("step_shown", { stepId: packet.steps[0].id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function next() {
    const ni = index + 1;
    const nextStep = packet.steps[ni];
    if (!nextStep) return;
    setIndex(ni);
    setAnswer("");
    emit("step_shown", { stepId: nextStep.id });
  }

  function submitAnswer() {
    if (!step || !answer.trim()) return;
    emit("student_answered", { stepId: step.id, payload: { answer: answer.trim() } });
    setAnswer("");
  }

  function finish() {
    emit("lesson_completed");
    setCompleted(true);
  }

  if (!step) return null;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-2 text-sm">
        <span className="font-semibold">{packet.title}</span>
        <span className="ml-2 text-xs text-gray-500">
          步骤 {index + 1} / {packet.steps.length}
        </span>
        <Badge tone="amber">示例 / 系统生成</Badge>
      </div>

      <div className="grid gap-4 md:grid-cols-[2fr_1fr]">
        <div className="space-y-4">
          <Card>
            <StepContent step={step} questions={questions} />
          </Card>

          {ANSWERABLE.has(step.type) && !completed && (
            <Card>
              <label htmlFor="answer" className="mb-1 block text-xs font-medium text-gray-600">
                你的回答
              </label>
              <textarea
                id="answer"
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                className="w-full rounded-md border border-gray-200 p-2 text-sm"
                rows={3}
                placeholder="输入你的答案…"
              />
              <button
                type="button"
                onClick={submitAnswer}
                disabled={!answer.trim()}
                className="mt-2 rounded-md bg-gray-800 px-3 py-1.5 text-sm text-white disabled:opacity-40"
              >
                提交答案
              </button>
            </Card>
          )}

          <div className="flex gap-2">
            {!isLast ? (
              <button
                type="button"
                onClick={next}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                下一步 →
              </button>
            ) : (
              <button
                type="button"
                onClick={finish}
                disabled={completed}
                className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-40"
              >
                {completed ? "已完成" : "完成课堂"}
              </button>
            )}
          </div>
        </div>

        <div>
          <Card>
            <div className="mb-1 text-sm font-semibold text-gray-700">Session Events</div>
            <p className="mb-2 text-[11px] text-gray-400">
              仅 local/demo 记录，不更新掌握度 / 错题 / 复习队列（任务 5.9）。
            </p>
            <ol className="space-y-1 text-xs">
              {events.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-2">
                  <span>
                    <span className="text-gray-400">#{e.sequence}</span>{" "}
                    <span className="font-mono">{e.eventType}</span>
                    {e.stepId && <span className="text-gray-400"> · {e.stepId}</span>}
                  </span>
                  <span
                    className={
                      e.persisted === null
                        ? "text-gray-300"
                        : e.persisted
                          ? "text-green-600"
                          : "text-amber-600"
                    }
                    title={e.persisted === false ? "本地记录（无 DB）" : "已写入 session_events"}
                  >
                    {e.persisted === null ? "…" : e.persisted ? "DB" : "local"}
                  </span>
                </li>
              ))}
              {events.length === 0 && <li className="text-gray-400">尚无事件</li>}
            </ol>
          </Card>
        </div>
      </div>
    </div>
  );
}
