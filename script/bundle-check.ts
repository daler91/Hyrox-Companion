import { readFile } from "node:fs/promises";
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
 *    contains drizzle-orm/drizzle-zod (or zod-to-openapi) modules because some
 *    client file value-imports the @shared/schema barrel instead of a pure deep
 *    module (@shared/schema/exercises, /structureLint, /enums, /micros).
 *    Read from the build's recorded chunk graph (script/bundleStats.ts).
 * 3. lucide-react icons of the lazy routes stay off first paint. Symptom: a
 *    code-splitting group gathers icons into one shared chunk (the old
 *    `vendor-ui`) that the entry imports, and the eager graph carries every
 *    icon the app uses (~140) instead of the shell's own (~20). Counted by the
 *    build itself (script/bundleStats.ts), which still knows each chunk's
 *    modules.
 * 4. The markdown stack stays out of the Timeline route's own chunks. The
 *    Timeline is the home page; the stack (~120KB) renders coach replies and
 *    loads with the first one (ChatMessage -> ChatMarkdown). Symptom: a static
 *    import of react-markdown somewhere the Timeline reaches, such as the
 *    workout sheets' embedded coach chat. PF8 (CODEBASE_ANALYSIS_2026-10-03)
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
 * Invariant 4. Fails, rather than passing blind, when the build found no
 * markdown modules or no Timeline route chunk: the patterns in
 * script/bundleStats.ts no longer fit. A missing stats file is reported by
 * eagerLucideIconFailures.
 */
export function timelineMarkdownFailures(stats: BundleStats | null): string[] {
  if (stats === null) return [];
  if (stats.totalMarkdownModules === 0 || stats.timelineMarkdownModules === null) {
    return [
      "the build found no markdown modules or no Timeline route chunk — MARKDOWN_MODULE or TIMELINE_ROUTE_MODULE " +
        "in script/bundleStats.ts no longer fits, so the Timeline markdown guard cannot count",
    ];
  }
  if (stats.timelineMarkdownModules === 0) return [];
  return [
    `the Timeline route loads ${stats.timelineMarkdownModules} markdown modules with itself — something it reaches ` +
      "statically imports react-markdown; render coach text through the lazy ChatMarkdown (client/src/components/chat)",
  ];
}

/**
 * Invariant 2, from the chunk graph the build recorded (script/bundleStats.ts).
 * It used to read each chunk's sourcemap, but script/build.ts deletes the maps
 * before any check runs, so only a `drizzle:` text fallback ever ran and a
 * chunk carrying zod-to-openapi without drizzle would have passed.
 * A9 (CODEBASE_ANALYSIS_2026-10-03)
 */
export function drizzleChunkFailures(stats: BundleStats | null): string[] {
  // A missing stats file is reported once, by eagerLucideIconFailures.
  if (stats === null) return [];
  if (!Array.isArray(stats.drizzleChunks)) {
    return ["dist/bundle-stats.json has no drizzleChunks — rebuild with the current script/bundleStats.ts"];
  }
  return stats.drizzleChunks.map(
    (file) =>
      `${file} contains drizzle-orm/drizzle-zod/zod-to-openapi modules — a client file value-imports the @shared/schema barrel`,
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

  const stats = await readBundleStats();
  failures.push(
    ...drizzleChunkFailures(stats),
    ...eagerLucideIconFailures(stats),
    ...timelineMarkdownFailures(stats),
  );

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
