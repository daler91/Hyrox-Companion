// @vitest-environment node
/**
 * Pins how the app's web fonts are shipped. PF6 (CODEBASE_ANALYSIS_2026-10-03):
 * main.tsx imported four Open Sans weights no font stack used, the service
 * worker precached every emitted font file (every unicode subset, plus the woff
 * fallbacks: 118 files, 1.48 MB) on each install, and the small subsets were
 * inlined as base64 into the render-blocking entry stylesheet.
 *
 * Only a production build shows any of this, so nothing else notices when it
 * drifts. The plugins are mocked so importing the config is side-effect free.
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

/** "space-grotesk" -> "Space Grotesk": how @fontsource names a package's family. */
function familyOf(packageSlug: string): string {
  return packageSlug
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** Every family named in index.css's `--font-*` stacks. */
function stackFamilies(): Set<string> {
  const families = new Set<string>();
  // Read from disk: vitest hands CSS imports, ?raw included, over empty.
  const stylesheetSource = readFileSync("client/src/index.css", "utf8");
  for (const [, stack] of stylesheetSource.matchAll(/--font-[a-z]+:([^;]+);/g)) {
    for (const [, family] of (stack ?? "").matchAll(/'([^']+)'/g)) families.add(family ?? "");
  }
  return families;
}

async function precaches(fileName: string): Promise<boolean> {
  const { PRECACHE_GLOB_PATTERNS } = await import("../../vite.config");
  return PRECACHE_GLOB_PATTERNS.some((pattern) => path.matchesGlob(fileName, pattern));
}

describe("web fonts", () => {
  it("imports only the families a font stack names", () => {
    const mainSource = readFileSync("client/src/main.tsx", "utf8");
    const imported = new Set(
      Array.from(mainSource.matchAll(/@fontsource\/([a-z-]+)\//g), ([, slug]) =>
        familyOf(slug ?? ""),
      ),
    );
    const named = stackFamilies();

    expect([...imported].sort((left, right) => left.localeCompare(right))).toEqual([
      "Geist Mono",
      "Geist Sans",
      "Space Grotesk",
    ]);
    for (const family of imported) expect(named).toContain(family);
  });

  it("never inlines a font file into the stylesheet", async () => {
    const { isFontAsset } = await import("../../vite.config");
    expect(
      isFontAsset(
        "/repo/node_modules/@fontsource/geist-mono/files/geist-mono-symbols2-400-normal.woff2",
      ),
    ).toBe(true);
    expect(
      isFontAsset(
        "/repo/node_modules/@fontsource/geist-mono/files/geist-mono-vietnamese-400-normal.woff",
      ),
    ).toBe(true);
    expect(isFontAsset("/repo/client/public/icon-192.png")).toBe(false);
  });

  it("precaches the latin woff2 of each face, not other subsets or woff fallbacks", async () => {
    expect(await precaches("assets/geist-sans-latin-400-normal-gapTbOY8.woff2")).toBe(true);
    expect(await precaches("assets/space-grotesk-latin-700-normal-RjhwGPKo.woff2")).toBe(true);
    expect(await precaches("assets/geist-mono-latin-500-normal-YINYabwD.woff2")).toBe(true);

    expect(await precaches("assets/space-grotesk-latin-ext-400-normal-CfP_5XZW.woff2")).toBe(false);
    expect(await precaches("assets/geist-mono-cyrillic-400-normal-C51Di1Mf.woff2")).toBe(false);
    expect(await precaches("assets/geist-sans-latin-400-normal-BOaIZNA2.woff")).toBe(false);
  });

  it("still precaches the app shell", async () => {
    expect(await precaches("index.html")).toBe(true);
    expect(await precaches("assets/index-DN_sOd7s.js")).toBe(true);
    expect(await precaches("assets/index-OGT7wWpv.css")).toBe(true);
    expect(await precaches("icon-192.png")).toBe(true);
  });
});
