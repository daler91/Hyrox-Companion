import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { type BundleStats, readBundleStats } from "./bundleStats";

/**
 * Client-bundle regression guard. CI's build workflow never runs `pnpm build`,
 * so the structural bundle invariants below are otherwise only protected by
 * someone eyeballing dist/. Run standalone via `pnpm check:bundle` (hard fail),
 * or non-fatally from script/build.ts after every production build.
 *
 * Invariants:
 * 1. recharts stays off the eager critical path. Every recharts import site
 *    lives in a lazy route; the chunk only goes eager when a shared dependency
 *    (historically clsx) gets captured into the vendor-charts group and the
 *    entry statically imports it. Symptom: index.html modulepreloads
 *    vendor-charts-*.js and every first paint pays ~390KB.
 * 2. The drizzle graph never ships to the browser. Symptom: a client chunk
 *    contains drizzle-orm/drizzle-zod modules because some client file
 *    value-imports the @shared/schema barrel instead of a pure deep module
 *    (@shared/schema/exercises, /structureLint, /enums, /micros).
 * 3. lucide-react icons of the lazy routes stay off first paint. Symptom: a
 *    code-splitting group gathers icons into one shared chunk (the old
 *    `vendor-ui`) that the entry imports, and the eager graph carries every
 *    icon the app uses (~140) instead of the shell's own (~20). Counted by the
 *    build itself (script/bundleStats.ts), which still knows each chunk's
 *    modules.
 */

const DIST = "dist/public";

/**
 * Most lucide-react icons the eager graph (each entry chunk and, transitively,
 * its static imports) may carry. The app shell renders about 20 itself:
 * navigation, header, theme toggle, offline banner. Raise this deliberately
 * when the shell gains icons. PF19 (CODEBASE_ANALYSIS_2026-10-03)
 */
export const MAX_EAGER_LUCIDE_ICONS = 30;

/**
 * Invariant 3, from the stats the build recorded (script/bundleStats.ts). Also
 * fails when the build recorded nothing, or found no icon anywhere: the module
 * path it matches no longer fits lucide-react, and the guard has gone blind.
 */
export function eagerLucideIconFailures(stats: BundleStats | null): string[] {
  if (stats === null) {
    return [
      "dist/bundle-stats.json is missing — build with vite.config.ts, whose bundle-stats plugin writes it",
    ];
  }
  if (stats.totalLucideIcons === 0) {
    return [
      "the build found no lucide-react icon modules — LUCIDE_ICON_MODULE in script/bundleStats.ts no longer " +
        "matches lucide-react's module paths, so the eager-icon guard cannot count icons",
    ];
  }
  if (stats.eagerLucideIcons <= MAX_EAGER_LUCIDE_ICONS) return [];
  return [
    `the eager graph carries ${stats.eagerLucideIcons} lucide-react icons (budget ${MAX_EAGER_LUCIDE_ICONS}) — ` +
      "icons of lazy routes are on first paint; check vite.config.ts codeSplitting for a group that captures lucide-react",
  ];
}

/**
 * Whether a built chunk carries drizzle runtime code. Prefers its sourcemap's
 * sources (exact). When the Sentry plugin deleted the maps (SENTRY_AUTH_TOKEN
 * set), falls back to drizzle's Symbol.for("drizzle:*") registry keys, which
 * survive minification.
 */
function shipsDrizzle(assets: string, file: string): Promise<boolean> {
  return readFile(path.join(assets, `${file}.map`), "utf8").then(
    (m) =>
      ((JSON.parse(m) as { sources?: string[] }).sources ?? []).some((s) =>
        /drizzle-orm|drizzle-zod|zod-to-openapi/.test(s),
      ),
    async () => (await readFile(path.join(assets, file), "utf8")).includes("drizzle:"),
  );
}

/** Run the invariant checks against dist/. Returns [] when the bundle is clean. */
export async function collectBundleCheckFailures(): Promise<string[]> {
  const failures: string[] = [];

  const html = await readFile(path.join(DIST, "index.html"), "utf8");
  if (/vendor-charts-[^"']+\.js/.test(html)) {
    failures.push(
      "index.html references vendor-charts — recharts is back on the eager critical path " +
        "(a shared dep was likely captured into the vendor-charts group; check vite.config.ts codeSplitting)",
    );
  }

  const assets = path.join(DIST, "assets");
  const scripts = (await readdir(assets)).filter((file) => file.endsWith(".js"));
  const checked = await Promise.all(
    scripts.map(async (file) => ({ file, bad: await shipsDrizzle(assets, file) })),
  );
  for (const { file } of checked.filter(({ bad }) => bad)) {
    failures.push(
      `${file} contains drizzle-orm/drizzle-zod runtime code — a client file value-imports the @shared/schema barrel`,
    );
  }

  failures.push(...eagerLucideIconFailures(await readBundleStats()));

  return failures;
}

// CLI entry (`pnpm check:bundle`): hard fail. Guarded so importing this module
// (script/build.ts runs the checks in-process, non-fatally) runs nothing.
if (process.argv[1]?.endsWith("bundle-check.ts")) {
  const failures = await collectBundleCheckFailures();
  if (failures.length > 0) {
    console.error(`bundle-check FAILED:\n  - ${failures.join("\n  - ")}`);
    process.exit(1);
  }
  console.log("bundle-check passed");
}
