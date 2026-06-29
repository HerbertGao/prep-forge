// Pure, JSX-free math-render helpers. Split out of MathBlock.tsx so the focused
// test can import them without going through a JSX transform step.
import katex from "katex";

export type LatexRender = { ok: boolean; html: string | null };

/** Isomorphic render attempt — returns a fallback signal instead of throwing. */
export function tryRenderLatex(latex: string, displayMode: "inline" | "block"): LatexRender {
  try {
    const html = katex.renderToString(latex, {
      displayMode: displayMode === "block",
      throwOnError: true,
      output: "html",
    });
    return { ok: true, html };
  } catch {
    return { ok: false, html: null };
  }
}

/**
 * Wrapper class for the formula container. Always includes overflow-x-auto +
 * max-w-full so long formulas scroll inside the box and never break mobile
 * layout (task 5.6 / PRODUCT §7.2).
 */
export function wrapClassFor(displayMode: "inline" | "block"): string {
  return displayMode === "block"
    ? "group relative my-3 max-w-full overflow-x-auto rounded-md border border-gray-100 bg-gray-50 p-3"
    : "group relative inline-block max-w-full overflow-x-auto align-middle";
}
