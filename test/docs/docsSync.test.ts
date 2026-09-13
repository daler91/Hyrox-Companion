/**
 * Pins the canonical doc catalogues to the code they describe.
 *
 * Three lists in the docs are enumerations of things the server registers:
 * pg-boss queues, cron advisory-lock keys, and environment variables. Each one
 * has silently drifted from the code at least once — the cron table was five
 * jobs short, the queue table four, and `nutritionEmbeddingBackfill` existed in
 * no document at all — because nothing fails when someone adds a queue and
 * stops there.
 *
 * These tests are that failure. Add a queue, a cron job or an env var and the
 * matching test goes red until the canonical doc lists it. Same idea as
 * `shared/schema/checkConstraints.test.ts`, which pins a rendered CHECK to the
 * constant it comes from so the migration can't be forgotten.
 *
 * WHY PARSE SOURCE TEXT rather than import the modules: `server/env.ts`
 * validates the environment and writes to stderr at import time, and
 * `server/queue.ts` pulls in pg-boss. Reading the files keeps this a fast,
 * side-effect-free unit test.
 *
 * IF ONE OF THESE FAILS: add the missing entry to the doc named in the failure
 * message. Do not add a second copy to another document — the duplicated cron
 * and queue tables in `docs/server.md` are exactly what drifted, and they were
 * replaced by links to the canonical lists. Extend the canonical one.
 */
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const read = (relative: string): string =>
  fs.readFileSync(path.join(ROOT, relative), "utf8");

/** Every .ts under server/, excluding tests. */
function serverSources(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".ts") && !entry.name.includes(".test.")) out.push(full);
    }
  };
  walk(path.join(ROOT, "server"));
  return out;
}

/**
 * Queue names actually registered with pg-boss: the string literals passed to
 * `queue.createQueue(...)` / `queue.work(...)`, resolving a `const X = "..."`
 * indirection, plus the `queueName:` properties the shared email-worker helper
 * is called with.
 */
function registeredQueueNames(): Set<string> {
  const sources = serverSources().map((f) => fs.readFileSync(f, "utf8"));
  const constants = new Map<string, string>();
  for (const src of sources) {
    for (const m of src.matchAll(/(?:export\s+)?const\s+([A-Z][A-Z0-9_]*)\s*=\s*"([a-z][a-z0-9-]+)"/g)) {
      constants.set(m[1], m[2]);
    }
  }
  const names = new Set<string>();
  for (const src of sources) {
    for (const m of src.matchAll(/queue\.(?:createQueue|work)\(\s*([A-Za-z_"][^,)\s]*)/g)) {
      const arg = m[1];
      if (arg.startsWith('"')) names.add(arg.replaceAll('"', ""));
      else if (constants.has(arg)) names.add(constants.get(arg)!);
    }
    for (const m of src.matchAll(/queueName:\s*"([a-z][a-z0-9-]+)"/g)) names.add(m[1]);
  }
  return names;
}

/** The keys of the CRON_LOCK_KEYS registry in server/cron.ts. */
function cronLockKeys(): string[] {
  const block = /export const CRON_LOCK_KEYS = \{([\s\S]*?)\} as const;/.exec(read("server/cron.ts"));
  if (!block) throw new Error("CRON_LOCK_KEYS registry not found in server/cron.ts");
  return [...block[1].matchAll(/^\s*([a-zA-Z][a-zA-Z0-9]*)\s*:/gm)].map((m) => m[1]);
}

/** Top-level keys of the Zod object in server/env.ts. */
function envSchemaKeys(): string[] {
  return [...new Set([...read("server/env.ts").matchAll(/^ {4}([A-Z][A-Z0-9_]+):/gm)].map((m) => m[1]))];
}

describe("docs stay in sync with the code they enumerate", () => {
  it("integrations.md lists every registered pg-boss queue", () => {
    const doc = read("docs/integrations.md");
    const queues = [...registeredQueueNames()].sort();

    // Guard the extractor itself: if this ever reads zero, the regexes stopped
    // matching and every assertion below would vacuously pass.
    expect(queues.length).toBeGreaterThan(0);

    const undocumented = queues.filter((q) => !doc.includes(`\`${q}\``));
    expect(undocumented, `Add these queues to docs/integrations.md § Job Types: ${undocumented.join(", ")}`).toEqual([]);
  });

  it("integrations.md lists every cron advisory-lock key", () => {
    const doc = read("docs/integrations.md");
    const keys = cronLockKeys();
    expect(keys.length).toBeGreaterThan(0);

    const undocumented = keys.filter((k) => !doc.includes(`\`${k}\``));
    expect(undocumented, `Add these cron jobs to docs/integrations.md § Registered Cron Jobs: ${undocumented.join(", ")}`).toEqual([]);
  });

  it("env-reference.md documents every variable in the env.ts schema", () => {
    const doc = read("docs/env-reference.md");
    const keys = envSchemaKeys();
    expect(keys.length).toBeGreaterThan(0);

    const undocumented = keys.filter((k) => !doc.includes(`\`${k}\``));
    expect(undocumented, `Add these variables to docs/env-reference.md: ${undocumented.join(", ")}`).toEqual([]);
  });
});
