"use client";

// Real ready-packet classroom (tasks 4.1 / 4.2, design D9/D10). Drives the
// packet's steps in order, persisting session_events through server actions that
// run the lesson-runtime applier in the same transaction. NOT a chat box: each
// step is a structured packet step; practice steps grade objective questions
// deterministically server-side. On the last step it emits lesson_completed and
// the packet moves ready→consumed, and we show whether the run is WVLL-countable.
import { useEffect, useRef, useState } from "react";
import { MathBlock } from "../../../components/MathBlock";
import { Badge, Card } from "../../../components/ui";
import type { PacketStepView, PacketView } from "../../../lib/packets";
import type { WvllResult } from "../../../lib/merge";
import { recordEvent, submitAnswer } from "./actions";

const STEP_LABEL: Record<string, string> = {
  diagnostic_question: "诊断",
  socratic_question: "苏格拉底提问",
  explanation: "讲解",
  math_block: "公式",
  worked_example: "例题",
  practice: "练习",
  hint: "提示",
  summary: "小结",
  review_prompt: "复习",
};

type LedgerRow = { seq: number; eventType: string; stepId: string | null; persisted: boolean | null };
type AnswerResult =
  | { kind: "graded"; correct: boolean; score: number }
  | { kind: "ungraded"; reason: string };

const WVLL_LABEL: Record<keyof WvllResult["checks"], string> = {
  readyPacket: "完成 ready 课包",
  eventsProduced: "产生 session events",
  answerGraded: "≥1 答案被批改",
  deterministicUpdate: "确定性更新 KP/错题/复习",
  notQuarantined: "未被质量门禁判失败",
};

export function Classroom({ packet, source }: { packet: PacketView; source: "db" | "fixture" }) {
  const [index, setIndex] = useState(0);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [results, setResults] = useState<Record<string, AnswerResult>>({});
  const [completed, setCompleted] = useState(false);
  const [wvll, setWvll] = useState<WvllResult | null>(null);
  const sessionRef = useRef<string>("");
  const seqRef = useRef(0);
  const startedRef = useRef(false);

  const step = packet.steps[index];
  const isLast = index === packet.steps.length - 1;

  function settle(seq: number, persisted: boolean) {
    setLedger((prev) => prev.map((r) => (r.seq === seq ? { ...r, persisted } : r)));
  }

  function emitStep(s: PacketStepView) {
    const seq = seqRef.current++;
    setLedger((prev) => [...prev, { seq, eventType: "step_shown", stepId: s.id, persisted: null }]);
    void recordEvent({
      sessionId: sessionRef.current,
      sequence: seq,
      lessonPacketId: packet.id,
      kind: "step",
      stepId: s.id,
    }).then((r) => settle(seq, r.persisted), () => settle(seq, false));
  }

  // Start once: lesson_started + step_shown(step 0).
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    sessionRef.current = crypto.randomUUID();
    const seq = seqRef.current++;
    setLedger([{ seq, eventType: "lesson_started", stepId: null, persisted: null }]);
    void recordEvent({
      sessionId: sessionRef.current,
      sequence: seq,
      lessonPacketId: packet.id,
      kind: "start",
    }).then((r) => settle(seq, r.persisted), () => settle(seq, false));
    if (packet.steps[0]) emitStep(packet.steps[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function next() {
    const ni = index + 1;
    const nextStep = packet.steps[ni];
    if (!nextStep) return;
    setIndex(ni);
    emitStep(nextStep);
  }

  function toggle(questionId: string, label: string, multi: boolean) {
    setSelected((prev) => {
      const cur = prev[questionId] ?? [];
      if (multi) {
        return {
          ...prev,
          [questionId]: cur.includes(label) ? cur.filter((l) => l !== label) : [...cur, label],
        };
      }
      return { ...prev, [questionId]: [label] };
    });
  }

  function answer(questionId: string) {
    const submitted = selected[questionId] ?? [];
    if (submitted.length === 0 || !step) return;
    const seq = seqRef.current++;
    setLedger((prev) => [...prev, { seq, eventType: "student_answered", stepId: step.id, persisted: null }]);
    void submitAnswer({
      sessionId: sessionRef.current,
      sequence: seq,
      lessonPacketId: packet.id,
      stepId: step.id,
      questionId,
      submitted,
    }).then(
      (r) => {
        settle(seq, r.persisted);
        setResults((prev) => ({ ...prev, [questionId]: r.graded }));
      },
      () => settle(seq, false),
    );
  }

  function finish() {
    const seq = seqRef.current++;
    setLedger((prev) => [...prev, { seq, eventType: "lesson_completed", stepId: null, persisted: null }]);
    setCompleted(true);
    void recordEvent({
      sessionId: sessionRef.current,
      sequence: seq,
      lessonPacketId: packet.id,
      kind: "complete",
    }).then(
      (r) => {
        settle(seq, r.persisted);
        if (r.wvll) setWvll(r.wvll);
      },
      () => settle(seq, false),
    );
  }

  if (!step) return null;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-2 text-sm">
        <span className="font-semibold">{packet.title}</span>
        <span className="ml-2 text-xs text-gray-500">
          步骤 {index + 1} / {packet.steps.length}
        </span>
        {source === "fixture" && <Badge tone="amber">示例 / 无 DB</Badge>}
      </div>

      <div className="grid gap-4 md:grid-cols-[2fr_1fr]">
        <div className="space-y-4">
          <Card>
            <div className="space-y-2">
              <Badge tone="blue">{STEP_LABEL[step.type] ?? step.type}</Badge>
              {step.prompt && <p className="text-sm text-gray-800">{step.prompt}</p>}
              {step.mdx && <p className="text-sm leading-6 text-gray-700">{step.mdx}</p>}
              {step.math && (
                <MathBlock
                  latex={step.math.latex}
                  displayMode={step.math.displayMode}
                  altText={step.math.altText}
                />
              )}
            </div>

            {step.questions.length > 0 && (
              <div className="mt-3 space-y-3">
                {step.questions.map((q) => {
                  const multi = q.type.includes("多选");
                  const sel = selected[q.id] ?? [];
                  const res = results[q.id];
                  return (
                    <div key={q.id} className="rounded-md border border-gray-100 p-3">
                      <div className="text-sm font-medium">
                        {q.stem} <span className="text-xs text-gray-400">（{q.type}）</span>
                      </div>
                      <ul className="mt-2 space-y-1 text-sm">
                        {q.options.map((o) => {
                          const reveal = !!res;
                          const correct = reveal && o.isCorrect === true;
                          return (
                            <li key={o.label}>
                              <label
                                className={`flex cursor-pointer items-center gap-2 rounded px-1 ${
                                  correct ? "bg-green-50" : ""
                                }`}
                              >
                                <input
                                  type={multi ? "checkbox" : "radio"}
                                  name={q.id}
                                  checked={sel.includes(o.label)}
                                  disabled={reveal}
                                  onChange={() => toggle(q.id, o.label, multi)}
                                />
                                <span>
                                  <span className="font-medium">{o.label}.</span> {o.content}
                                  {correct && <span className="ml-1 text-xs text-green-600">✓ 正确答案</span>}
                                </span>
                              </label>
                            </li>
                          );
                        })}
                      </ul>
                      {!res ? (
                        <button
                          type="button"
                          onClick={() => answer(q.id)}
                          disabled={sel.length === 0}
                          className="mt-2 rounded-md bg-gray-800 px-3 py-1.5 text-sm text-white disabled:opacity-40"
                        >
                          提交答案
                        </button>
                      ) : (
                        <div className="mt-2 text-sm">
                          {res.kind === "graded" ? (
                            <Badge tone={res.correct ? "green" : "red"}>
                              {res.correct ? "答对 (score=1)" : "答错 (score=0)"}
                            </Badge>
                          ) : (
                            <Badge tone="gray">未自动判分</Badge>
                          )}
                          {q.answer && (
                            <div className="mt-1 text-gray-700">
                              <span className="font-medium">答案：</span>
                              {q.answer}
                            </div>
                          )}
                          {q.explanation && (
                            <div className="text-gray-600">
                              <span className="font-medium">解析：</span>
                              {q.explanation}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

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

          {completed && (
            <Card className={wvll?.countable ? "border-green-200 bg-green-50" : "border-amber-200 bg-amber-50"}>
              <div className="mb-1 text-sm font-semibold">
                {wvll?.countable
                  ? "本次学习计入有效学习闭环（WVLL）"
                  : wvll
                    ? "本次学习未计入 WVLL（任一条件未满足）"
                    : "课堂已完成"}
              </div>
              {wvll && (
                <ul className="space-y-0.5 text-xs">
                  {(Object.keys(wvll.checks) as (keyof WvllResult["checks"])[]).map((k) => (
                    <li key={k} className={wvll.checks[k] ? "text-green-700" : "text-amber-700"}>
                      {wvll.checks[k] ? "✓" : "✗"} {WVLL_LABEL[k]}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </div>

        <div>
          <Card>
            <div className="mb-1 text-sm font-semibold text-gray-700">Session Events</div>
            <p className="mb-2 text-[11px] text-gray-400">
              事件落 session_events，持久化后（事务内）由 applier 确定性更新 KP/错题/复习。
            </p>
            <ol className="space-y-1 text-xs">
              {ledger.map((e) => (
                <li key={e.seq} className="flex items-center justify-between gap-2">
                  <span>
                    <span className="text-gray-400">#{e.seq}</span>{" "}
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
              {ledger.length === 0 && <li className="text-gray-400">尚无事件</li>}
            </ol>
          </Card>
        </div>
      </div>
    </div>
  );
}
