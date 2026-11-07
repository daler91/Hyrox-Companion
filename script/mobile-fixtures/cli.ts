/**
 * Writes the golden fixtures the Kotlin ports are tested against.
 *
 *   pnpm mobile:fixtures            # every suite; deletes files of removed suites
 *   pnpm mobile:fixtures dateUtils  # only suites whose name starts with "dateUtils"
 *
 * The unit suite fails while a committed fixture differs from what its
 * suite produces (script/mobile-fixtures/fixtures.test.ts).
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { FIXTURES_DIR, loadSuites, renderSuite } from "./build";

const prefixes = process.argv.slice(2);
const all = await loadSuites();
const selected = prefixes.length > 0 ? all.filter((s) => prefixes.some((p) => s.name.startsWith(p))) : all;
if (selected.length === 0) throw new Error(`No fixture suite matches ${prefixes.join(", ")}`);

mkdirSync(FIXTURES_DIR, { recursive: true });
if (prefixes.length === 0) {
  const keep = new Set(all.map((s) => `${s.name}.json`));
  for (const file of readdirSync(FIXTURES_DIR)) if (!keep.has(file)) rmSync(path.join(FIXTURES_DIR, file));
}
for (const s of selected) writeFileSync(path.join(FIXTURES_DIR, `${s.name}.json`), renderSuite(s), "utf8");
process.stdout.write(`Wrote ${selected.length} fixture file(s) to ${path.relative(process.cwd(), FIXTURES_DIR)}\n`);
