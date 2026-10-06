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

import { eagerLucideIconFailures, MAX_EAGER_LUCIDE_ICONS } from "../../script/bundle-check";
import { collectBundleStats, eagerChunks } from "../../script/bundleStats";

const ICONS = "/repo/node_modules/lucide-react/dist/esm/icons";

interface ChunkSpec {
  readonly isEntry?: boolean;
  readonly imports?: string[];
  readonly dynamicImports?: string[];
  readonly moduleIds?: string[];
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
    expect(collectBundleStats(SPLIT_BUNDLE)).toEqual({ eagerLucideIcons: 3, totalLucideIcons: 7 });
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
  it("passes within the shell's budget", () => {
    expect(eagerLucideIconFailures({ eagerLucideIcons: 20, totalLucideIcons: 139 })).toEqual([]);
  });

  it("fails when the lazy routes' icons are on first paint", () => {
    const failures = eagerLucideIconFailures({ eagerLucideIcons: 139, totalLucideIcons: 139 });
    expect(failures).toHaveLength(1);
    expect(failures.at(0)).toContain(`139 lucide-react icons (budget ${MAX_EAGER_LUCIDE_ICONS})`);
  });

  it("fails rather than passing blind", () => {
    expect(eagerLucideIconFailures(null).at(0)).toContain("bundle-stats.json is missing");
    expect(eagerLucideIconFailures({ eagerLucideIcons: 0, totalLucideIcons: 0 }).at(0)).toContain(
      "no longer matches",
    );
  });
});
