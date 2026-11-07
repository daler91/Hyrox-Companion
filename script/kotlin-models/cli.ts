/**
 * Regenerates mobile/core's API models from docs/openapi.json.
 *
 *   pnpm mobile:models
 *
 * Replaces every file under the generated package directory, so a component
 * or operation removed from the document disappears from Kotlin too. CI runs
 * this and fails on any diff (.github/workflows/mobile.yml).
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { generateKotlinModels, KOTLIN_PACKAGE, type OpenApiDocument } from "./generate";
import { buildSamples } from "./samples";

const root = path.resolve(import.meta.dirname, "../..");
const outDir = path.join(root, "mobile/core/src/commonMain/kotlin", ...KOTLIN_PACKAGE.split("."));
const doc = JSON.parse(readFileSync(path.join(root, "docs/openapi.json"), "utf8")) as OpenApiDocument;

const files = generateKotlinModels(doc);
rmSync(outDir, { recursive: true, force: true });
for (const file of files) {
  const target = path.join(outDir, file.path);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, file.content, "utf8");
}
process.stdout.write(`Wrote ${files.length} files to ${path.relative(root, outDir)}\n`);

// Contract-test samples (ApiContractTest.kt), one file per operation.
const samplesDir = path.join(root, "mobile/core/src/commonTest/resources/api-samples");
const samples = buildSamples(doc);
rmSync(samplesDir, { recursive: true, force: true });
mkdirSync(samplesDir, { recursive: true });
for (const [name, sample] of samples) {
  writeFileSync(path.join(samplesDir, `${name}.json`), `${JSON.stringify(sample, null, 2)}\n`, "utf8");
}
process.stdout.write(`Wrote ${samples.size} sample files to ${path.relative(root, samplesDir)}\n`);
