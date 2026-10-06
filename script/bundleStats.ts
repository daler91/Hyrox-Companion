import { readFile, writeFile } from "node:fs/promises";

import type { Plugin, Rollup } from "vite";

/**
 * Facts about the client bundle that script/bundle-check.ts asserts on, taken
 * from the bundler's own chunk graph while it still has it: exact module ids,
 * where dist/ only holds minified code. Written beside dist/public, not into
 * it, so it is never served or precached; script/build.ts clears dist/ before
 * each build, so the file always describes the bundle next to it.
 */
export interface BundleStats {
  /** lucide-react icon modules in the chunks first paint loads. */
  readonly eagerLucideIcons: number;
  /** lucide-react icon modules in the whole bundle, eager or lazy. */
  readonly totalLucideIcons: number;
}

const BUNDLE_STATS_PATH = "dist/bundle-stats.json";
const LUCIDE_ICON_MODULE = /[\\/]lucide-react[\\/]dist[\\/]esm[\\/]icons[\\/]/;

function lucideIconCount(chunk: Rollup.OutputChunk): number {
  return chunk.moduleIds.filter((moduleId) => LUCIDE_ICON_MODULE.test(moduleId)).length;
}

function addWithStaticImports(
  chunk: Rollup.OutputChunk,
  chunksByFile: ReadonlyMap<string, Rollup.OutputChunk>,
  eager: Map<string, Rollup.OutputChunk>,
): void {
  if (eager.has(chunk.fileName)) return;
  eager.set(chunk.fileName, chunk);
  for (const imported of chunk.imports) {
    const next = chunksByFile.get(imported);
    if (next) addWithStaticImports(next, chunksByFile, eager);
  }
}

/** The chunks first paint loads: each entry chunk and, transitively, its static imports. */
export function eagerChunks(bundle: Rollup.OutputBundle): Rollup.OutputChunk[] {
  const chunksByFile = new Map<string, Rollup.OutputChunk>();
  for (const output of Object.values(bundle)) {
    if (output.type === "chunk") chunksByFile.set(output.fileName, output);
  }
  const eager = new Map<string, Rollup.OutputChunk>();
  for (const chunk of chunksByFile.values()) {
    if (chunk.isEntry) addWithStaticImports(chunk, chunksByFile, eager);
  }
  return [...eager.values()];
}

export function collectBundleStats(bundle: Rollup.OutputBundle): BundleStats {
  const sumIcons = (chunks: Iterable<Rollup.OutputChunk>): number =>
    [...chunks].reduce((count, chunk) => count + lucideIconCount(chunk), 0);
  const allChunks = Object.values(bundle).filter(
    (output): output is Rollup.OutputChunk => output.type === "chunk",
  );
  return { eagerLucideIcons: sumIcons(eagerChunks(bundle)), totalLucideIcons: sumIcons(allChunks) };
}

/**
 * Vite plugin: records {@link BundleStats} after each production build.
 * PF19 (CODEBASE_ANALYSIS_2026-10-03)
 */
export function bundleStatsPlugin(): Plugin {
  return {
    name: "bundle-stats",
    apply: "build",
    writeBundle(_outputOptions, bundle) {
      return writeFile(BUNDLE_STATS_PATH, JSON.stringify(collectBundleStats(bundle)));
    },
  };
}

/** What the last production build recorded, or null when it recorded nothing. */
export function readBundleStats(): Promise<BundleStats | null> {
  return readFile(BUNDLE_STATS_PATH, "utf8").then(
    (text) => JSON.parse(text) as BundleStats,
    () => null,
  );
}
