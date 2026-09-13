/**
 * Pins the canonical doc catalogues to the code they describe.
 *
 * Several lists in the docs are enumerations of things the repo registers:
 * pg-boss queues, cron advisory-lock keys, environment variables, storage
 * domains, schema tables, and CI workflows. Every one of them has silently
 * drifted from the code at least once — the cron table was five jobs short,
 * the queue table four, `nutritionEmbeddingBackfill` existed in no document at
 * all, `exercise_load_tags` was the only table with no section in
 * `docs/database.md`, and `docs/testing.md` listed eight of the nine workflows
 * — because nothing fails when someone adds one and stops there.
 *
 * These tests are that failure. Add a queue, a cron job, an env var, a table or
 * a workflow and the matching test goes red until the canonical doc lists it.
 * Same idea as `shared/schema/checkConstraints.test.ts`, which pins a rendered
 * CHECK to the constant it comes from so the migration can't be forgotten.
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

/** Domain names registered on the composed storage facade. */
function storageDomains(): string[] {
  const body = /export const storage: IStorage = \{([\s\S]*?)\n\};/.exec(read("server/storage/index.ts"));
  if (!body) throw new Error("storage facade object not found in server/storage/index.ts");
  return [...body[1].matchAll(/^\s+([a-zA-Z]+)[,:]/gm)].map((m) => m[1]);
}

/**
 * Every table name declared with `pgTable(...)` anywhere in shared/schema/.
 * Scans the directory rather than just `tables.ts` so a table added to a new
 * schema module is still pinned.
 */
function schemaTableNames(): string[] {
  const dir = path.join(ROOT, "shared/schema");
  const names = new Set<string>();
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".ts") || entry.name.includes(".test.")) continue;
    const src = fs.readFileSync(path.join(dir, entry.name), "utf8");
    // `\s*` spans the newline in the multi-line `pgTable(\n  "name",` form.
    for (const m of src.matchAll(/export const \w+ = pgTable\(\s*"([a-z][a-z0-9_]*)"/g)) {
      names.add(m[1]);
    }
  }
  return [...names].sort();
}

/** Every workflow file GitHub Actions will run. */
function workflowFiles(): string[] {
  const dir = path.join(ROOT, ".github/workflows");
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
    .sort();
}

/** Every markdown file in the repo, excluding dependencies. */
function markdownFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".md")) out.push(full);
    }
  };
  walk(ROOT);
  return out;
}

/**
 * GitHub's heading-anchor slug: lowercase, drop punctuation,each space becomes one
 * hyphen. Spaces are NOT collapsed — "Core & Security" is `core--security`.
 */
function headingAnchors(md: string): Set<string> {
  const set = new Set<string>();
  for (const m of md.matchAll(/^#{1,6}\s+(.+?)\s*$/gm)) {
    const slug = m[1]
      .toLowerCase()
      .replace(/`/g, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/ /g, "-");
    set.add(slug);
  }
  return set;
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

  it("database.md documents every domain on the storage facade", () => {
    const doc = read("docs/database.md");
    const domains = storageDomains();
    expect(domains.length).toBeGreaterThan(0);

    // Compare against the facade block database.md reproduces, property for
    // property — it is a copy of this exact object and drifted from it before.
    const documentedBlock = /export const storage: IStorage = \{([\s\S]*?)\n\};/.exec(doc);
    expect(documentedBlock, "docs/database.md no longer contains the storage facade code block").not.toBeNull();
    const documented = new Set(
      [...documentedBlock![1].matchAll(/^\s+([a-zA-Z]+)[,:]/gm)].map((m) => m[1]),
    );

    const undocumented = domains.filter((d) => !documented.has(d));
    expect(undocumented, `Add these storage domains to the facade block in docs/database.md: ${undocumented.join(", ")}`).toEqual([]);
  });

  it("database.md documents every table in the schema", () => {
    const doc = read("docs/database.md");
    const tables = schemaTableNames();
    expect(tables.length).toBeGreaterThan(0);

    // database.md documents a table one of two ways, and both count: most get
    // their own `### <table>` section, while the nutrition tables are listed
    // inline under § Nutrition tables and covered column-by-column in
    // nutrition.md. A bare mention inside a fenced block does NOT count —
    // `exercise_load_tags` went undocumented for exactly that reason, appearing
    // only inside a migration *filename* in a code block.
    const undocumented = tables.filter(
      (t) => !doc.includes(`\`${t}\``) && !new RegExp(`^#{3}\\s+${t}\\s*$`, "m").test(doc),
    );
    expect(
      undocumented,
      `Add a "### <table>" section to docs/database.md § Schema Tables for: ${undocumented.join(", ")}`,
    ).toEqual([]);
  });

  it("testing.md lists every CI workflow", () => {
    const doc = read("docs/testing.md");
    const workflows = workflowFiles();
    expect(workflows.length).toBeGreaterThan(0);

    const undocumented = workflows.filter((w) => !doc.includes(`\`${w}\``));
    expect(
      undocumented,
      `Add these workflows to docs/testing.md § CI/CD Test Workflows: ${undocumented.join(", ")}`,
    ).toEqual([]);
  });

  it("every internal documentation link and heading anchor resolves", () => {
    const files = markdownFiles();
    expect(files.length).toBeGreaterThan(0);

    const anchorCache = new Map<string, Set<string> | null>();
    const anchorsFor = (file: string): Set<string> | null => {
      if (!anchorCache.has(file)) {
        anchorCache.set(file, fs.existsSync(file) ? headingAnchors(fs.readFileSync(file, "utf8")) : null);
      }
      return anchorCache.get(file) ?? null;
    };

    const broken: string[] = [];
    for (const file of files) {
      const md = fs.readFileSync(file, "utf8");
      for (const m of md.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
        const target = m[1].trim();
        if (/^(https?:|mailto:|#!)/.test(target)) continue;
        const [rel, frag] = target.split("#");
        const here = path.relative(ROOT, file);

        if (!rel) {
          const anchors = anchorsFor(file);
          if (frag && anchors && !anchors.has(frag)) broken.push(`${here} -> #${frag}`);
          continue;
        }
        const abs = path.resolve(path.dirname(file), rel);
        if (!fs.existsSync(abs)) {
          broken.push(`${here} -> ${rel} (no such file)`);
          continue;
        }
        if (frag && abs.endsWith(".md")) {
          const anchors = anchorsFor(abs);
          if (anchors && !anchors.has(frag)) broken.push(`${here} -> ${rel}#${frag}`);
        }
      }
    }
    expect(broken, `Broken documentation links:\n  ${broken.join("\n  ")}`).toEqual([]);
  });
});
