// Presentational renderer for one lesson step. No hooks / no 'use client' so it
// works in both the server-rendered viewer and the client classroom. Shows the
// answer + solution inside a native <details> (the "答案/解析区域").
import type { LessonStep } from "@prep-forge/schemas";
import { MathBlock } from "./MathBlock";
import { Badge } from "./ui";
import type { DemoQuestion } from "../lib/sampleLessonPacket";

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

function QuestionCard({ q }: { q: DemoQuestion }) {
  return (
    <div className="rounded-md border border-gray-100 p-3">
      <div className="text-sm font-medium">
        <span className="text-gray-400">{q.id}</span> {q.stem}{" "}
        <span className="text-xs text-gray-400">（{q.type}）</span>
      </div>
      {q.options && (
        <ul className="mt-1 space-y-0.5 text-sm">
          {q.options.map((o) => (
            <li key={o.label}>
              {o.label}. {o.content}
            </li>
          ))}
        </ul>
      )}
      <details className="mt-2">
        <summary className="cursor-pointer text-xs text-blue-600">查看答案 / 解析</summary>
        <div className="mt-1 text-sm">
          <div>
            <span className="font-medium">答案：</span>
            {q.answer}
          </div>
          {q.explanation && (
            <div className="text-gray-600">
              <span className="font-medium">解析：</span>
              {q.explanation}
            </div>
          )}
        </div>
      </details>
    </div>
  );
}

export function StepContent({
  step,
  questions,
}: {
  step: LessonStep;
  questions: Record<string, DemoQuestion>;
}) {
  return (
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
      {step.questionIds && step.questionIds.length > 0 && (
        <div className="space-y-2">
          {step.questionIds.map((id) => {
            const q = questions[id];
            return q ? (
              <QuestionCard key={id} q={q} />
            ) : (
              <div key={id} className="text-xs text-gray-400">
                题目 {id} 未找到
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
