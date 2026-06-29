"use client";

// Practice answer board (task 4.5). Each answer calls practiceAnswer, which opens
// a one-shot session and runs the applier — same deterministic path as the
// classroom, never a direct write to learner state.
import { useState } from "react";
import { Badge, Card } from "../../components/ui";
import type { PracticeQuestion } from "../../lib/practice";
import { practiceAnswer } from "../../lib/practice-actions";

type Result =
  | { kind: "graded"; correct: boolean; score: number }
  | { kind: "ungraded"; reason: string };

export function PracticeBoard({ questions }: { questions: PracticeQuestion[] }) {
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [results, setResults] = useState<Record<string, Result>>({});
  const [pending, setPending] = useState<string | null>(null);

  function toggle(qid: string, label: string, multi: boolean) {
    setSelected((prev) => {
      const cur = prev[qid] ?? [];
      if (multi) {
        return { ...prev, [qid]: cur.includes(label) ? cur.filter((l) => l !== label) : [...cur, label] };
      }
      return { ...prev, [qid]: [label] };
    });
  }

  async function submit(qid: string) {
    const sel = selected[qid] ?? [];
    if (sel.length === 0) return;
    setPending(qid);
    try {
      const r = await practiceAnswer(qid, sel);
      setResults((prev) => ({ ...prev, [qid]: r.graded }));
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="space-y-3">
      {questions.map((q) => {
        const multi = q.type.includes("多选");
        const sel = selected[q.id] ?? [];
        const res = results[q.id];
        return (
          <Card key={q.id}>
            <div className="text-sm font-medium">
              {q.stem}{" "}
              <span className="text-xs text-gray-400">（{q.type}）</span>
              {q.examFrequency && <span className="ml-1 text-xs text-amber-500">考频 {q.examFrequency}</span>}
            </div>
            {q.options.length > 0 ? (
              <ul className="mt-2 space-y-1 text-sm">
                {q.options.map((o) => {
                  const correct = !!res && o.isCorrect === true;
                  return (
                    <li key={o.label}>
                      <label className={`flex cursor-pointer items-center gap-2 rounded px-1 ${correct ? "bg-green-50" : ""}`}>
                        <input
                          type={multi ? "checkbox" : "radio"}
                          name={q.id}
                          checked={sel.includes(o.label)}
                          disabled={!!res}
                          onChange={() => toggle(q.id, o.label, multi)}
                        />
                        <span>
                          <span className="font-medium">{o.label}.</span> {o.content}
                          {correct && <span className="ml-1 text-xs text-green-600">✓</span>}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mt-2 text-xs text-gray-400">无选项（主观题）— 提交将记为未判分。</p>
            )}
            {!res ? (
              <button
                type="button"
                onClick={() => submit(q.id)}
                disabled={sel.length === 0 || pending === q.id}
                className="mt-2 rounded-md bg-gray-800 px-3 py-1.5 text-sm text-white disabled:opacity-40"
              >
                {pending === q.id ? "提交中…" : "提交答案"}
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
          </Card>
        );
      })}
    </div>
  );
}
