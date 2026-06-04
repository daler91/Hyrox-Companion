import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

// Static regression check (C1, multi-pass review 2026-06-03): the light-theme
// --success token must keep `text-success` legible on white (WCAG 1.4.3 AA,
// 4.5:1 for small text — the "Completed" status badge). jsdom can't compute
// rendered contrast, so we parse the token from index.css and compute the WCAG
// ratio directly. This guards against the token being lightened back toward the
// old 142 71% 45% (~2.3:1) that failed the audit.

type Rgb = readonly [number, number, number];

function hslToRgb(h: number, s: number, l: number): Rgb {
  const sat = s / 100;
  const lum = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sat * Math.min(lum, 1 - lum);
  const f = (n: number) => lum - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

function relativeLuminance([r, g, b]: Rgb): number {
  const channel = (c: number) => {
    const cs = c / 255;
    return cs <= 0.03928 ? cs / 12.92 : ((cs + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

describe("--success token contrast (WCAG 1.4.3 AA)", () => {
  it("light-theme text-success meets 4.5:1 on white", () => {
    const css = readFileSync(resolve(__dirname, "../index.css"), "utf8");
    // The first `--success:` declaration is the light `:root` token (the dark
    // override in `.dark` comes later and sits on the ink surface).
    const match = /--success:\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/.exec(css);
    expect(match).not.toBeNull();

    const [h, s, l] = [Number(match![1]), Number(match![2]), Number(match![3])];
    const ratio = contrastRatio(hslToRgb(h, s, l), [255, 255, 255]);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
});
