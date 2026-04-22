/**
 * Regenerates docs/openapi.json from the Zod-backed OpenAPI registry.
 *
 * Run via `pnpm docs:openapi`. CI (.github/workflows/build.yml) runs the
 * same command and fails the build on any uncommitted diff so the
 * snapshot can never drift silently from the Zod schemas.
 */
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { generateOpenApiDocument } from "../shared/openapi";

const here = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(here, "..", "docs", "openapi.json");

const doc = generateOpenApiDocument();
writeFileSync(outPath, `${JSON.stringify(doc, null, 2)}\n`, "utf8");

process.stdout.write(`Wrote ${outPath}\n`);
