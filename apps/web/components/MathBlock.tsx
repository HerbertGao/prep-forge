"use client";

// MathBlock (task 5.6, 决策 6, PRODUCT §7.2): KaTeX render of inline/block LaTeX
// with a readable fallback on failure, accessible alt text, a copy-LaTeX entry,
// and a horizontally-scrollable container so long formulas never break mobile
// layout. KaTeX renderToString is synchronous + isomorphic, so the formula is
// produced during render (SSR + client) — no layout shift, and testable.
import { useState } from "react";
import "katex/dist/katex.min.css";
import { tryRenderLatex, wrapClassFor } from "./mathRender";

export { tryRenderLatex } from "./mathRender";

export function MathBlock({
  latex,
  displayMode = "block",
  altText,
}: {
  latex: string;
  displayMode?: "inline" | "block";
  altText?: string | null;
}) {
  const [copied, setCopied] = useState(false);
  const { ok, html } = tryRenderLatex(latex, displayMode);
  const label = altText ?? latex;

  async function copy() {
    try {
      await navigator.clipboard.writeText(latex);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  const wrapClass = wrapClassFor(displayMode);

  return (
    <span className={wrapClass} data-display={displayMode}>
      {ok && html ? (
        <span
          role="math"
          aria-label={label}
          // KaTeX output is sanitized markup from a trusted local render.
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <span role="math" aria-label={label} className="block text-sm">
          <span className="mb-1 block text-xs font-medium text-red-700">公式渲染失败，显示原始 LaTeX：</span>
          <code className="block whitespace-pre-wrap break-all font-mono text-gray-800">{latex}</code>
        </span>
      )}
      <button
        type="button"
        onClick={copy}
        className="ml-2 rounded border border-gray-200 bg-white px-1.5 py-0.5 text-[10px] text-gray-500 hover:bg-gray-100"
        aria-label="复制 LaTeX 源码"
      >
        {copied ? "已复制" : "复制 LaTeX"}
      </button>
    </span>
  );
}
