// @vitest-environment node
/**
 * The eager-icon guard: script/bundleStats.ts counts lucide-react icon modules
 * in the chunks first paint loads, and script/bundle-check.ts fails above the
 * shell's budget. PF19 (CODEBASE_ANALYSIS_2026-10-03): a `vendor-ui`
 * code-splitting group gathered every icon into one chunk the entry imports,
 * so first paint carried ~140 icons where the shell renders ~20.
 */
import type { Rollup } from "vite";
import { describe, expect, it } from "vitest";

import {
  eagerLucideIconFailures,
  MAX_EAGER_LUCIDE_ICONS,
  timelineMarkdownFailures,
} from "../../script/bundle-check";
import { type BundleStats, collectBundleStats, eagerChunks } from "../../script/bundleStats";

const ICONS = "/repo/node_modules/lucide-react/dist/esm/icons";

interface ChunkSpec {
  readonly isEntry?: boolean;
  readonly imports?: string[];
  readonly dynamicImports?: string[];
  readonly moduleIds?: string[];
  readonly facadeModuleId?: string;
}

function icons(...names: string[]): string[] {
  return names.map((name) => `${ICONS}/${name}.mjs`);
}

/** A bundle with just the chunk fields the stats read. */
function bundleOf(specs: Record<string, ChunkSpec>): Rollup.OutputBundle {
  const outputs = Object.entries(specs).map(([fileName, spec]) => [
    fileName,
    {
      type: "chunk",
      fileName,
      isEntry: spec.isEntry ?? false,
      imports: spec.imports ?? [],
      dynamicImports: spec.dynamicImports ?? [],
      moduleIds: spec.moduleIds ?? [],
      facadeModuleId: spec.facadeModuleId ?? null,
    },
  ]);
  const assets = [["assets/index.css", { type: "asset", fileName: "assets/index.css" }]];
  return Object.fromEntries([...outputs, ...assets]);
}

// The shell's own icons in the entry, a shared runtime chunk, and a lazy route
// (reached only through a dynamic import) with its own icons.
const SPLIT_BUNDLE = bundleOf({
  "assets/index.js": {
    isEntry: true,
    imports: ["assets/vendor-react.js"],
    dynamicImports: ["assets/Settings.js"],
    moduleIds: ["/repo/client/src/main.tsx", ...icons("sun", "moon", "log-out")],
  },
  "assets/vendor-react.js": { moduleIds: ["/repo/node_modules/react/index.js"] },
  "assets/Settings.js": {
    imports: ["assets/vendor-react.js"],
    moduleIds: icons("bell", "trash-2", "download", "upload"),
  },
});

describe("eagerChunks", () => {
  it("follows static imports from the entry, not dynamic ones", () => {
    const files = eagerChunks(SPLIT_BUNDLE).map((chunk) => chunk.fileName);
    expect(files.toSorted((left, right) => left.localeCompare(right))).toEqual([
      "assets/index.js",
      "assets/vendor-react.js",
    ]);
  });
});

describe("collectBundleStats", () => {
  it("counts the lazy routes' icons out of the eager graph", () => {
    expect(collectBundleStats(SPLIT_BUNDLE)).toMatchObject({ eagerLucideIcons: 3, totalLucideIcons: 7 });
  });

  it("counts them in when a shared icon chunk is statically imported", () => {
    const grouped = bundleOf({
      "assets/index.js": {
        isEntry: true,
        imports: ["assets/vendor-ui.js"],
        dynamicImports: ["assets/Settings.js"],
      },
      "assets/vendor-ui.js": { moduleIds: icons("sun", "moon", "bell", "trash-2") },
      "assets/Settings.js": { imports: ["assets/vendor-ui.js"] },
    });
    expect(collectBundleStats(grouped).eagerLucideIcons).toBe(4);
  });
});

describe("eagerLucideIconFailures", () => {
  const markdown = { timelineMarkdownModules: 0, totalMarkdownModules: 12 };

  it("passes within the shell's budget", () => {
    expect(eagerLucideIconFailures({ eagerLucideIcons: 20, totalLucideIcons: 139 , ...markdown })).toEqual([]);
  });

  it("fails when the lazy routes' icons are on first paint", () => {
    const failures = eagerLucideIconFailures({ eagerLucideIcons: 139, totalLucideIcons: 139 , ...markdown });
    expect(failures).toHaveLength(1);
    expect(failures.at(0)).toContain(`139 lucide-react icons (budget ${MAX_EAGER_LUCIDE_ICONS})`);
  });

  it("fails rather than passing blind", () => {
    expect(eagerLucideIconFailures(null).at(0)).toContain("bundle-stats.json is missing");
    expect(eagerLucideIconFailures({ eagerLucideIcons: 0, totalLucideIcons: 0 , ...markdown }).at(0)).toContain(
      "no longer matches",
    );
  });
});

const MARKDOWN = "/repo/node_modules/.pnpm/react-markdown@10.1.0/node_modules/react-markdown/lib/index.js";
const MICROMARK = "/repo/node_modules/.pnpm/micromark@4.0.2/node_modules/micromark/index.js";

/** The Timeline route, the embedded coach chat it reaches, and the markdown it renders with. */
function timelineBundle(chatImportsMarkdown: "statically" | "dynamically") {
  const markdownEdge =
    chatImportsMarkdown === "statically"
      ? { imports: ["assets/lib-markdown.js"] }
      : { dynamicImports: ["assets/ChatMarkdown.js"] };
  return bundleOf({
    "assets/index.js": { isEntry: true, dynamicImports: ["assets/Timeline.js"], moduleIds: ["/repo/client/src/main.tsx"] },
    "assets/Timeline.js": {
      facadeModuleId: "/repo/client/src/pages/Timeline.tsx",
      imports: ["assets/index.js", "assets/ChatMessage.js"],
      moduleIds: ["/repo/client/src/pages/Timeline.tsx"],
    },
    "assets/ChatMessage.js": { ...markdownEdge, moduleIds: ["/repo/client/src/components/ChatMessage.tsx"] },
    "assets/ChatMarkdown.js": {
      imports: ["assets/lib-markdown.js"],
      moduleIds: ["/repo/client/src/components/chat/ChatMarkdown.tsx"],
    },
    "assets/lib-markdown.js": { moduleIds: [MARKDOWN, MICROMARK] },
  });
}

describe("Timeline markdown stats (PF8)", () => {
  it("counts no markdown on the Timeline when the chat loads it lazily", () => {
    expect(collectBundleStats(timelineBundle("dynamically"))).toMatchObject({
      timelineMarkdownModules: 0,
      totalMarkdownModules: 2,
    });
  });

  it("counts it when something the Timeline reaches imports it statically", () => {
    expect(collectBundleStats(timelineBundle("statically")).timelineMarkdownModules).toBe(2);
  });

  it("reports no Timeline chunk as null rather than zero", () => {
    expect(collectBundleStats(SPLIT_BUNDLE).timelineMarkdownModules).toBeNull();
  });
});

describe("timelineMarkdownFailures", () => {
  const stats = (timelineMarkdownModules: number | null, totalMarkdownModules = 2): BundleStats => ({
    eagerLucideIcons: 20,
    totalLucideIcons: 139,
    timelineMarkdownModules,
    totalMarkdownModules,
  });

  it("passes when the Timeline carries no markdown", () => {
    expect(timelineMarkdownFailures(stats(0))).toEqual([]);
  });

  it("fails when it does", () => {
    expect(timelineMarkdownFailures(stats(2)).at(0)).toContain("the Timeline route loads 2 markdown modules");
  });

  it("fails rather than passing blind", () => {
    expect(timelineMarkdownFailures(stats(null)).at(0)).toContain("no longer fits");
    expect(timelineMarkdownFailures(stats(0, 0)).at(0)).toContain("no longer fits");
  });

  it("leaves a missing stats file to the icon guard's message", () => {
    expect(timelineMarkdownFailures(null)).toEqual([]);
  });
});
