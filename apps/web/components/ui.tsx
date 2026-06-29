// Tiny Tailwind primitives shared across pages (and reusable by Group F admin).
// No component library — Phase 0 stays on native Tailwind v4 (懒原则).
import type { ReactNode } from "react";
import type { Origin } from "@prep-forge/schemas";
import type { SeedSource } from "../lib/types";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-gray-200 bg-white p-4 shadow-sm ${className}`}>
      {children}
    </div>
  );
}

export function Badge({
  children,
  tone = "gray",
}: {
  children: ReactNode;
  tone?: "gray" | "green" | "amber" | "red" | "blue";
}) {
  const tones: Record<string, string> = {
    gray: "bg-gray-100 text-gray-700",
    green: "bg-green-100 text-green-800",
    amber: "bg-amber-100 text-amber-800",
    red: "bg-red-100 text-red-800",
    blue: "bg-blue-100 text-blue-800",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

const ORIGIN_LABEL: Record<Origin, { text: string; tone: "blue" | "amber" | "red" }> = {
  imported: { text: "人工导入", tone: "blue" },
  system: { text: "系统生成", tone: "amber" },
  ai_generated: { text: "AI 生成", tone: "red" },
};

/** Distinguishes 人工导入 / 系统生成 / AI 生成 data (product-foundation 数据来源区分). */
export function OriginBadge({ origin }: { origin: Origin }) {
  const o = ORIGIN_LABEL[origin];
  return <Badge tone={o.tone}>{o.text}</Badge>;
}

/**
 * Top-of-page banner stating whether the numbers are acceptance-grade DB data
 * (traceable to import run / source block) or non-acceptance fixture data.
 */
export function SourceBanner({ source }: { source: SeedSource }) {
  if (source === "db") {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-800">
        数据来源：legacy import 已发布到 PostgreSQL（可追溯到 import run / source block）。
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
      数据来源：本地 fixture（非验收用途，未连接数据库）。配置 DATABASE_URL 并运行导入后即显示真实 seed。
    </div>
  );
}

/** Provenance footnote — value → domain row → source block (traceability). */
export function SourceRef({ sourceBlockId }: { sourceBlockId: string | null }) {
  if (!sourceBlockId) return <span className="text-xs text-gray-400">来源块：—（fixture）</span>;
  return <span className="text-xs text-gray-400">来源块：{sourceBlockId}</span>;
}

export const COURSE_STATUS_TONE: Record<string, "gray" | "green" | "amber" | "red" | "blue"> = {
  在考: "blue",
  重考: "amber",
  缺考: "red",
  已通过: "green",
  未开始: "gray",
  unmapped: "gray",
};

export const KP_STATE_LABEL: Record<string, string> = {
  unseen: "未学习",
  taught: "已学习",
  practiced: "已练习",
  mastered: "已掌握",
};

export const KP_STATE_TONE: Record<string, "gray" | "green" | "amber" | "blue"> = {
  unseen: "gray",
  taught: "blue",
  practiced: "amber",
  mastered: "green",
};
