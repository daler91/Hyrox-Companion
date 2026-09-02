import { execFileSync } from "node:child_process";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "..", "..");

/**
 * Two tracked paths that differ only by case (`.Jules/` and `.jules/`, once)
 * cannot coexist on a case-insensitive filesystem: a macOS or Windows checkout
 * silently collapses them into one directory, and every commit from such a
 * clone then edits whichever copy git happened to write last. The journals
 * forked that way once and diverged for weeks. Fail fast instead.
 */
describe("tracked paths", () => {
  it("never differ only by case", () => {
    const tracked = execFileSync("git", ["-C", repoRoot, "ls-files", "-z"], { encoding: "utf8" })
      .split("\0")
      .filter(Boolean);

    const byFoldedPath = new Map<string, string[]>();
    for (const file of tracked) {
      // Every ancestor directory is a path too: `.Jules/palette.md` and
      // `.jules/bolt.md` collide at the directory even though the files differ.
      const segments = file.split("/");
      for (let depth = 1; depth <= segments.length; depth += 1) {
        const original = segments.slice(0, depth).join("/");
        const folded = original.toLowerCase();
        const seen = byFoldedPath.get(folded) ?? [];
        if (!seen.includes(original)) seen.push(original);
        byFoldedPath.set(folded, seen);
      }
    }

    const collisions = [...byFoldedPath.values()].filter((variants) => variants.length > 1);
    expect(collisions).toEqual([]);
  });
});
