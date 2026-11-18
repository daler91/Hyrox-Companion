// @vitest-environment node
/**
 * Pins the PWA manifest's theme colour to the brand lime the app draws.
 *
 * The manifest lives in `vite.config.ts` and only reaches a browser through a
 * production build, so nothing else notices when it drifts: it kept the
 * superseded `#C4F37E` after the stylesheet, the logos and the Android app
 * had all moved to `#B1F584` (tech debt #60). The plugins are mocked so
 * importing the config is side-effect free; the PWA mock hands back the
 * options it was given.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("vite-plugin-pwa", () => ({
  VitePWA: (options: unknown) => ({ name: "vite-plugin-pwa-mock", options }),
}));
vi.mock("@sentry/vite-plugin", () => ({ sentryVitePlugin: () => ({ name: "sentry-mock" }) }));
vi.mock("@tailwindcss/vite", () => ({ default: () => ({ name: "tailwind-mock" }) }));
vi.mock("@vitejs/plugin-react", () => ({ default: () => ({ name: "react-mock" }) }));

async function loadThemeColor(): Promise<string> {
  const { default: config } = await import("../../vite.config");
  const plugins = (config.plugins ?? []) as { name?: string; options?: unknown }[];
  const pwa = plugins.find((plugin) => plugin.name === "vite-plugin-pwa-mock");
  const themeColor = (pwa?.options as { manifest?: { theme_color?: string } } | undefined)?.manifest
    ?.theme_color;
  if (!themeColor) throw new Error("vite.config.ts has no manifest theme_color");
  return themeColor;
}

/** `#RRGGBB` as the `H S% L%` triple the stylesheet writes, each rounded. */
function hexToHslTriple(hex: string): string {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) throw new Error(`not a #RRGGBB colour: ${hex}`);
  const [r, g, b] = match.slice(1).map((pair) => Number.parseInt(pair, 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const delta = max - min;
  let hue = 0;
  let saturation = 0;
  if (delta !== 0) {
    saturation = delta / (1 - Math.abs(2 * lightness - 1));
    if (max === r) hue = 60 * (((g - b) / delta) % 6);
    else if (max === g) hue = 60 * ((b - r) / delta + 2);
    else hue = 60 * ((r - g) / delta + 4);
  }
  if (hue < 0) hue += 360;
  return `${Math.round(hue)} ${Math.round(saturation * 100)}% ${Math.round(lightness * 100)}%`;
}

/** The light theme's `--accent`, the brand lime every lime token shares. */
function stylesheetLime(): string {
  const css = readFileSync(path.resolve(import.meta.dirname, "../../client/src/index.css"), "utf8");
  const accent = /--accent:\s*([^;]+);/.exec(css)?.[1]?.trim();
  if (!accent) throw new Error("client/src/index.css declares no --accent");
  return accent;
}

describe("PWA manifest", () => {
  it("uses the brand lime the stylesheet draws as its theme colour", async () => {
    expect(hexToHslTriple(await loadThemeColor())).toBe(stylesheetLime());
  });

  it("converts the colours it compares the way the stylesheet writes them", () => {
    expect(hexToHslTriple("#B1F584")).toBe("96 85% 74%");
    expect(hexToHslTriple("#C4F37E")).toBe("84 83% 72%");
  });
});
