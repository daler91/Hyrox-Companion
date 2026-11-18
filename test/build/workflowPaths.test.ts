// @vitest-environment node
/**
 * A workflow that filters both `push` and `pull_request` by path should watch
 * the same paths in both: otherwise a change that runs the workflow once it
 * lands on main is never checked in the pull request that makes it.
 * `mobile.yml` ran on a push touching `mobile-release.yml` but not on a pull
 * request that did (tech debt #66).
 *
 * The repo has no YAML parser, so this reads the `paths:` lists under each
 * trigger line by line. The workflows keep the two-space layout it expects.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const WORKFLOWS_DIR = path.resolve(import.meta.dirname, "../../.github/workflows");

/** The `paths:` entries under `on.<trigger>`, or null when that trigger has none. */
function triggerPaths(workflow: string, trigger: "push" | "pull_request"): string[] | null {
  const lines = workflow.split("\n");
  const start = lines.findIndex((line) => line === `  ${trigger}:`);
  if (start === -1) return null;
  let inPaths = false;
  const paths: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^ {0,2}\S/.test(line)) break; // the next trigger, or the end of `on:`
    if (line.trim().startsWith("#") || line.trim() === "") continue;
    if (line === "    paths:") {
      inPaths = true;
      continue;
    }
    if (inPaths) {
      const entry = /^ {6}- (.+)$/.exec(line);
      if (!entry) break;
      paths.push(entry[1].trim());
    }
  }
  return inPaths ? paths : null;
}

const workflows = readdirSync(WORKFLOWS_DIR)
  .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
  .map((name) => ({ name, text: readFileSync(path.join(WORKFLOWS_DIR, name), "utf8") }));

describe("workflow path filters", () => {
  it("finds the filters it compares", () => {
    const mobile = workflows.find((workflow) => workflow.name === "mobile.yml");
    expect(mobile && triggerPaths(mobile.text, "push")).toContain("mobile/**");
  });

  it.each(workflows.map((workflow) => [workflow.name, workflow.text] as const))(
    "%s watches the same paths on push and pull_request",
    (_name, text) => {
      const push = triggerPaths(text, "push");
      const pullRequest = triggerPaths(text, "pull_request");
      if (push === null || pullRequest === null) return;
      expect([...pullRequest].sort()).toEqual([...push].sort());
    },
  );
});
