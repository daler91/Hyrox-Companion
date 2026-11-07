/**
 * CLI for the OpenAPI breaking-change check (script/openapiBreaking.ts).
 *
 *   pnpm openapi:breaking <base.json> <head.json>
 *
 * Prints every finding and exits 1 when any is breaking. CI runs it on pull
 * requests against the base branch's docs/openapi.json; a deliberate breaking
 * change (paired with a MIN_APP_VERSION_* bump) is let through with the
 * `openapi-breaking-ok` label.
 */
import { readFileSync } from "node:fs";

import { findBreakingChanges, formatFindings } from "./openapiBreaking";

const [basePath, headPath] = process.argv.slice(2);
if (!basePath || !headPath) {
  process.stderr.write("Usage: pnpm openapi:breaking <base.json> <head.json>\n");
  process.exit(2);
}

const base = JSON.parse(readFileSync(basePath, "utf8")) as Parameters<typeof findBreakingChanges>[0];
const head = JSON.parse(readFileSync(headPath, "utf8")) as Parameters<typeof findBreakingChanges>[1];
const findings = findBreakingChanges(base, head);

if (findings.length === 0) {
  process.stdout.write("No breaking OpenAPI changes.\n");
  process.exit(0);
}

process.stdout.write(`${formatFindings(findings)}\n`);
const breaking = findings.filter((f) => f.severity === "breaking").length;
if (breaking > 0) {
  process.stderr.write(
    `\n${breaking} breaking change(s). Installed app builds would break. If this is deliberate, raise MIN_APP_VERSION_* and label the PR openapi-breaking-ok.\n`,
  );
  process.exit(1);
}
process.stdout.write("\nWarnings only; not failing.\n");
