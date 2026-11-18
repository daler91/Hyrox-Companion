// @vitest-environment node
/**
 * Actions are pinned to a commit with the release named in a trailing
 * comment. Every pin of the same commit should name the same release:
 * `pnpm/action-setup`'s v6.1.1 commit was labelled `# v4` in three places
 * (tech debt #68), which misleads whoever reads or bumps it.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const GITHUB_DIR = path.resolve(import.meta.dirname, "../../.github");
const PIN = /uses:\s*([^\s@]+)@([0-9a-f]{40})(?:\s+#\s*(\S+))?/g;

function yamlFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return yamlFiles(full);
    return /\.ya?ml$/.test(entry.name) ? [full] : [];
  });
}

/** `action@sha` → the release comments its pins carry, with where each appears. */
function pinLabels(): Map<string, Map<string, string[]>> {
  const labels = new Map<string, Map<string, string[]>>();
  for (const file of yamlFiles(GITHUB_DIR)) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(PIN)) {
      const [, action, sha, label] = match;
      if (!label) continue;
      const key = `${action}@${sha}`;
      const byLabel = labels.get(key) ?? new Map<string, string[]>();
      const where = byLabel.get(label) ?? [];
      where.push(path.relative(GITHUB_DIR, file));
      byLabel.set(label, where);
      labels.set(key, byLabel);
    }
  }
  return labels;
}

describe("workflow action pins", () => {
  it("finds the pins it compares", () => {
    expect([...pinLabels().keys()].some((key) => key.startsWith("actions/checkout@"))).toBe(true);
  });

  it("names one release for each pinned commit", () => {
    const conflicting = [...pinLabels()]
      .filter(([, byLabel]) => byLabel.size > 1)
      .map(([key, byLabel]) => ({ pin: key, labels: Object.fromEntries(byLabel) }));
    expect(conflicting).toEqual([]);
  });
});
