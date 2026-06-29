import { defineConfig } from "vitest/config";

// Focused component test only (MathBlock). node env + renderToStaticMarkup; CSS
// imports (katex.min.css) are ignored by default (no `css: true`).
export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
  },
});
