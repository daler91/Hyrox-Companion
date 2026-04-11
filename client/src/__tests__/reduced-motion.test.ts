import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

// Static regression check: the global reduced-motion override added in the
// UX review (PR #765, P2-7) must remain in index.css. This guards against
// accidental removal during Tailwind config changes or CSS refactors —
// we don't ship a real browser in CI so we verify the rule exists rather
// than its computed effect.
describe("prefers-reduced-motion global override", () => {
  it("index.css contains the prefers-reduced-motion media query and zeroes out animations", () => {
    const cssPath = resolve(__dirname, "../index.css");
    const css = readFileSync(cssPath, "utf8");

    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    // The rule should zero out animation-duration and transition-duration
    // on every element so Landing fade-ups, Coach thinking dots, voice
    // indicator pulse, and sidebar transitions all shorten.
    expect(css).toMatch(/animation-duration:\s*0\.01ms\s*!important/);
    expect(css).toMatch(/transition-duration:\s*0\.01ms\s*!important/);
  });
});
