import { describe, expect, it } from "vitest";
import { tryRenderLatex, wrapClassFor } from "./mathRender";

// Focused test for the MathBlock render contract (task 5.6). Imports the
// JSX-free helpers the component uses, so no JSX transform is needed.

describe("tryRenderLatex (KaTeX + fallback)", () => {
  it("renders valid LaTeX to KaTeX html", () => {
    const r = tryRenderLatex("x^2 + y^2", "block");
    expect(r.ok).toBe(true);
    expect(r.html).toContain("katex");
  });

  it("signals fallback (does not throw) on invalid LaTeX", () => {
    const r = tryRenderLatex("\\frac{", "inline");
    expect(r.ok).toBe(false);
    expect(r.html).toBeNull();
  });
});

describe("wrapClassFor (mobile overflow safety)", () => {
  it("scrolls horizontally and never exceeds viewport width", () => {
    for (const mode of ["inline", "block"] as const) {
      const cls = wrapClassFor(mode);
      expect(cls).toContain("overflow-x-auto");
      expect(cls).toContain("max-w-full");
    }
  });
});
