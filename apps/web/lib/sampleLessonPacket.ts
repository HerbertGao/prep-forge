// System/fixture sample lesson packet.
//
// ai-teacher has NO lesson packets (packets are a Phase 2 product). Per
// product-foundation "区分示例课包来源", this packet is origin="system" and the
// UI must label it 示例/系统生成 — it must not be passed off as imported data.
import type { LessonPacket } from "@prep-forge/schemas";

export const SAMPLE_LESSON_ID = "LP-AM02-03-001";

/** Demo questions referenced by the practice step (answer + solution area). */
export type DemoQuestion = {
  id: string;
  stem: string;
  type: string;
  options?: { label: string; content: string; isCorrect?: boolean }[];
  answer: string;
  explanation?: string;
};

export const SAMPLE_QUESTIONS: Record<string, DemoQuestion> = {
  "Q-AM02-031": {
    id: "Q-AM02-031",
    type: "计算题",
    stem: "设 z = x²y + 3xy²，求 ∂z/∂x。",
    answer: "∂z/∂x = 2xy + 3y²",
    explanation: "把 y 视为常数，对 x 求导：x²y 求导得 2xy，3xy² 求导得 3y²。",
  },
  "Q-AM02-044": {
    id: "Q-AM02-044",
    type: "选择题",
    stem: "对 z = sin(xy)，∂z/∂y 等于？",
    options: [
      { label: "A", content: "x·cos(xy)", isCorrect: true },
      { label: "B", content: "y·cos(xy)" },
      { label: "C", content: "cos(xy)" },
      { label: "D", content: "xy·cos(xy)" },
    ],
    answer: "A",
    explanation: "固定 x，对 y 求导，链式法则得 x·cos(xy)。",
  },
};

export const SAMPLE_LESSON_PACKET: LessonPacket = {
  id: SAMPLE_LESSON_ID,
  origin: "system",
  visibility: "public",
  version: 1,
  status: "ready",
  subjectCode: "advanced_math",
  courseCode: "00023",
  title: "偏导数的定义与基本计算",
  kpCodes: ["AM02-03"],
  prerequisites: ["AM02-01", "AM02-02"],
  estimatedMinutes: 60,
  difficulty: "medium",
  objectives: [
    "理解偏导数是固定其他变量后的导数",
    "能计算基础二元函数的偏导数",
    "能区分偏导数与普通一元导数",
  ],
  steps: [
    {
      id: "diagnostic-001",
      type: "diagnostic_question",
      prompt: "如果 z=f(x,y)，只让 x 变化、y 不变，你觉得此时函数像几元函数？",
    },
    {
      id: "explain-001",
      type: "explanation",
      mdx: "固定 y 后，对 x 求导，这就是对 x 的偏导。它衡量沿 x 方向的瞬时变化率。",
    },
    {
      id: "math-001",
      type: "math_block",
      math: {
        latex:
          "\\frac{\\partial z}{\\partial x}=\\lim_{\\Delta x\\to 0}\\frac{f(x+\\Delta x,y)-f(x,y)}{\\Delta x}",
        displayMode: "block",
        altText: "对 x 的偏导数定义：当 Δx 趋于 0 时，[f(x+Δx,y)-f(x,y)]/Δx 的极限",
      },
    },
    {
      id: "math-002",
      type: "math_block",
      prompt: "一个较长的公式，用于验证窄视口不横向撑破：",
      math: {
        latex:
          "\\frac{\\partial}{\\partial x}\\left(\\int_{0}^{x} e^{t^2}\\,dt + \\sum_{n=1}^{\\infty}\\frac{x^n y^n}{n!} + \\sqrt{x^2+y^2+\\sin(xy)+\\cos(x-y)}\\right)",
        displayMode: "block",
        altText: "一个故意很宽的复合表达式，用于演示移动端横向滚动",
      },
    },
    {
      id: "worked-001",
      type: "worked_example",
      mdx: "例：z = x²y。固定 y，对 x 求导得 ∂z/∂x = 2xy。",
      math: {
        latex: "z = x^2 y \\Rightarrow \\frac{\\partial z}{\\partial x} = 2xy",
        displayMode: "inline",
        altText: "z 等于 x 平方乘 y，对 x 偏导等于 2xy",
      },
    },
    {
      id: "practice-001",
      type: "practice",
      prompt: "动手计算下列偏导数。",
      questionIds: ["Q-AM02-031", "Q-AM02-044"],
    },
    {
      id: "summary-001",
      type: "summary",
      mdx: "偏导数 = 固定其余变量后的一元导数。下一步：方向导数与梯度。",
    },
  ],
  sourceBlockId: null,
  contentHash: null,
};
