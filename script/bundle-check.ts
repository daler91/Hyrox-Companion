import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Client-bundle regression guard. CI's build workflow never runs `pnpm build`,
 * so the two structural bundle invariants below are otherwise only protected by
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
 */

const DIST = "dist/public";

/** Run both invariant checks against dist/. Returns [] when the bundle is clean. */
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
  for (const file of await readdir(assets)) {
    if (!file.endsWith(".js")) continue;
    const mapPath = path.join(assets, `${file}.map`);
    // Prefer sourcemap sources (exact). When the Sentry plugin deleted the maps
    // (SENTRY_AUTH_TOKEN set), fall back to drizzle's Symbol.for("drizzle:*")
    // registry keys, which survive minification.
    const bad = await readFile(mapPath, "utf8").then(
      (m) =>
        ((JSON.parse(m) as { sources?: string[] }).sources ?? []).some((s) =>
          /drizzle-orm|drizzle-zod|zod-to-openapi/.test(s),
        ),
      async () => (await readFile(path.join(assets, file), "utf8")).includes("drizzle:"),
    );
    if (bad) {
      failures.push(
        `${file} contains drizzle-orm/drizzle-zod runtime code — a client file value-imports the @shared/schema barrel`,
      );
    }
  }

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
