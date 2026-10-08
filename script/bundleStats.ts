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
  /**
   * Markdown-stack modules (react-markdown, remark-gfm, rehype-sanitize,
   * micromark) the Timeline route loads with itself: its chunk and,
   * transitively, its static imports. Null when no chunk is the Timeline's.
   */
  readonly timelineMarkdownModules: number | null;
  /** Markdown-stack modules in the whole bundle. */
  readonly totalMarkdownModules: number;
  /**
   * Client chunks (bundle file names, e.g. assets/index-*.js) that carry drizzle-orm,
   * drizzle-zod or zod-to-openapi modules. Read from the chunk graph because
   * the sourcemaps that used to answer this are deleted before any check runs
   * (script/build.ts), which left only a minified-text heuristic.
   * A9 (CODEBASE_ANALYSIS_2026-10-03)
   */
  readonly drizzleChunks: readonly string[];
}

const BUNDLE_STATS_PATH = "dist/bundle-stats.json";
const LUCIDE_ICON_MODULE = /[\\/]lucide-react[\\/]dist[\\/]esm[\\/]icons[\\/]/;
const MARKDOWN_MODULE = /[\\/]node_modules[\\/](react-markdown|remark-gfm|rehype-sanitize|micromark)[\\/]/;
const TIMELINE_ROUTE_MODULE = /[\\/]client[\\/]src[\\/]pages[\\/]Timeline\.tsx$/;
/** The server-only schema graph: none of it may reach a browser chunk. */
const DRIZZLE_GRAPH_MODULE = /drizzle-orm|drizzle-zod|zod-to-openapi/;

function moduleCount(chunks: Iterable<Rollup.OutputChunk>, pattern: RegExp): number {
  let count = 0;
  for (const chunk of chunks) {
    count += chunk.moduleIds.filter((moduleId) => pattern.test(moduleId)).length;
  }
  return count;
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

/** The chunks matching `isRoot` and, transitively, their static imports. */
function staticClosure(
  bundle: Rollup.OutputBundle,
  isRoot: (chunk: Rollup.OutputChunk) => boolean,
): Rollup.OutputChunk[] {
  const chunksByFile = new Map<string, Rollup.OutputChunk>();
  for (const output of Object.values(bundle)) {
    if (output.type === "chunk") chunksByFile.set(output.fileName, output);
  }
  const closure = new Map<string, Rollup.OutputChunk>();
  for (const chunk of chunksByFile.values()) {
    if (isRoot(chunk)) addWithStaticImports(chunk, chunksByFile, closure);
  }
  return [...closure.values()];
}

/** The chunks first paint loads: each entry chunk and, transitively, its static imports. */
export function eagerChunks(bundle: Rollup.OutputBundle): Rollup.OutputChunk[] {
  return staticClosure(bundle, (chunk) => chunk.isEntry);
}

/**
 * The chunks the Timeline route loads with itself. It is the home page, so
 * what it carries every athlete pays for on a cold start, though it is a lazy
 * route and so outside {@link eagerChunks}.
 */
export function timelineChunks(bundle: Rollup.OutputBundle): Rollup.OutputChunk[] {
  return staticClosure(bundle, (chunk) => TIMELINE_ROUTE_MODULE.test(chunk.facadeModuleId ?? ""));
}

export function collectBundleStats(bundle: Rollup.OutputBundle): BundleStats {
  const allChunks = Object.values(bundle).filter(
    (output): output is Rollup.OutputChunk => output.type === "chunk",
  );
  const timeline = timelineChunks(bundle);
  return {
    eagerLucideIcons: moduleCount(eagerChunks(bundle), LUCIDE_ICON_MODULE),
    totalLucideIcons: moduleCount(allChunks, LUCIDE_ICON_MODULE),
    timelineMarkdownModules: timeline.length > 0 ? moduleCount(timeline, MARKDOWN_MODULE) : null,
    totalMarkdownModules: moduleCount(allChunks, MARKDOWN_MODULE),
    drizzleChunks: allChunks
      .filter((chunk) => chunk.moduleIds.some((moduleId) => DRIZZLE_GRAPH_MODULE.test(moduleId)))
      .map((chunk) => chunk.fileName),
  };
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
