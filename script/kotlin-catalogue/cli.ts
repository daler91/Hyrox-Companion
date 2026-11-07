/**
 * Regenerates the native app's exercise catalogue from the TypeScript tables.
 *
 *   pnpm mobile:catalogue
 *
 * Run it after changing EXERCISE_DEFINITIONS, EXERCISE_NAME_ALIASES or the
 * equipment tables. The unit suite fails while the committed file differs from
 * what the tables generate (script/kotlin-catalogue/catalogue.test.ts).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { CATALOGUE_PATH, generateExerciseCatalogue } from "./generate";

const root = path.resolve(import.meta.dirname, "../..");
const target = path.join(root, CATALOGUE_PATH);
mkdirSync(path.dirname(target), { recursive: true });
writeFileSync(target, generateExerciseCatalogue(), "utf8");
process.stdout.write(`Wrote ${CATALOGUE_PATH}\n`);
