import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { WorkoutSuggestion } from "@shared/schema";
import {
  actionShift,
  influenceScore,
  keywordPresence,
  priorityShift,
  rationaleDrift,
  suggestionCountDelta,
  targetOverlap,
  verdict,
  type ScenarioScore,
  type SuggestionBundle,
} from "./metrics";
import type { Scenario } from "./scenarios";

// NOTE: `generateWorkoutSuggestions` and `SCENARIOS` are dynamically
// imported inside `main()` so that importing the harness does not
// trigger the server's env validation until after we've confirmed the
// user really wants to run against live Gemini.

/**
 * Tier 2 — Live Gemini influence harness.
 *
 * Guarded by RUN_COACH_HARNESS=1 so it never runs in CI by accident.
 * Emits:
 *   script/coach-influence/output/coach-influence-report.json
 *   script/coach-influence/output/coach-influence-report.md
 *
 * Each scenario swings exactly ONE input between baseline and variant.
 * The output report tells us which inputs actually move Gemini's
 * suggestions — i.e. which of the coach's declared signals the model
 * is really weighing.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const RUNS_PER_CONDITION = Number(process.env.COACH_HARNESS_RUNS ?? 3);

function log(...args: unknown[]) {
  // harness is a CLI script, stdout is the right channel
  console.log("[coach-influence]", ...args);
}

type GenerateFn = (
  ctx: Scenario["baseline"],
  upcoming: Scenario["upcoming"],
  goal?: string,
  rag?: string,
) => Promise<WorkoutSuggestion[]>;

async function runCondition(
  scenario: Scenario,
  which: "baseline" | "variant",
  generate: GenerateFn,
): Promise<SuggestionBundle[]> {
  const ctx = which === "baseline" ? scenario.baseline : scenario.variant;
  const bundles: SuggestionBundle[] = [];
  for (let i = 0; i < RUNS_PER_CONDITION; i++) {
    const suggestions = await generate(
      ctx,
      scenario.upcoming,
      scenario.goal,
      scenario.rag,
    );
    bundles.push(suggestions);
    log(`  ${scenario.key} [${which} ${i + 1}/${RUNS_PER_CONDITION}] ${suggestions.length} suggestions`);
  }
  return bundles;
}

function scoreScenario(
  scenario: Scenario,
  baseline: SuggestionBundle[],
  variant: SuggestionBundle[],
): ScenarioScore {
  const kw = keywordPresence(variant, scenario.expectedKeywords);
  const m = {
    suggestionCountDelta: suggestionCountDelta(baseline, variant),
    targetOverlap: targetOverlap(baseline, variant),
    actionShift: actionShift(baseline, variant),
    priorityShift: priorityShift(baseline, variant),
    rationaleDrift: rationaleDrift(baseline, variant),
    keywordRatio: kw.ratio,
    keywordMatched: kw.matched,
  };
  return {
    input: scenario.label,
    ...m,
    influence: influenceScore(m),
  };
}

function renderMarkdown(scores: ScenarioScore[], noiseFloor: number): string {
  const lines = [
    "# AI Coach Influence Report",
    "",
    `Runs per condition: **${RUNS_PER_CONDITION}**. Scenarios: **${scores.length}**.`,
    `Noise floor (control scenario influence): **${noiseFloor.toFixed(3)}**.`,
    "",
    "Each row swings ONE input between baseline and variant; higher influence = Gemini",
    "weighs that input more. Any score at/below the noise floor means the model is",
    "effectively ignoring that input in the current prompt.",
    "",
    "| Input | Influence | TargetΔ | RationaleΔ | PriorityΔ | Keywords | Verdict |",
    "| --- | ---: | ---: | ---: | ---: | --- | --- |",
  ];
  const renderKeywords = (score: ScenarioScore): string => {
    if (score.keywordMatched.length > 0) {
      return score.keywordMatched.map(w => `\`${w}\``).join(" ");
    }
    return score.keywordRatio === 0 ? "—" : "none";
  };

  for (const s of scores) {
    const v = verdict(s.influence, noiseFloor);
    const kw = renderKeywords(s);
    lines.push(
      `| ${s.input} | ${s.influence.toFixed(3)} | ${s.targetOverlap.toFixed(2)} | ${s.rationaleDrift.toFixed(2)} | ${s.priorityShift.toFixed(2)} | ${kw} | ${v} |`,
    );
  }
  lines.push(
    "",
    "## How to read",
    "- **TargetΔ**: fraction of suggestions that changed *which* workout/field they target.",
    "- **RationaleΔ**: cosine distance between the TF-IDF of baseline vs variant rationales.",
    "- **PriorityΔ**: L1 shift between `high/medium/low` priority distributions.",
    "- **Keywords**: which of the scenario's expected signal words appeared in variant rationales.",
    "- **Verdict**:",
    "  - `IGNORED` — at or near the control noise floor; Gemini is not responding to this input.",
    "  - `WEAK`/`MODERATE`/`STRONG` — progressively meaningful signal.",
    "",
    "If you see `IGNORED` rows, the input is either not in the prompt (run the",
    "Tier 1 test `suggestionService.promptInclusion.test.ts`) or it is in the prompt",
    "but too buried/weakly worded for Gemini to pick up — fix the prompt, don't",
    "add more inputs.",
    "",
  );
  return lines.join("\n");
}

async function main() {
  if (process.env.RUN_COACH_HARNESS !== "1") {
    console.error(
      "Refusing to run without RUN_COACH_HARNESS=1. This script calls the live Gemini API and costs money. Set RUN_COACH_HARNESS=1 and GEMINI_API_KEY to proceed.",
    );
    process.exit(2);
  }
  if (!process.env.GEMINI_API_KEY) {
    console.error("GEMINI_API_KEY is required.");
    process.exit(2);
  }

  const { generateWorkoutSuggestions } = await import(
    "../../server/gemini/suggestionService"
  );
  const { SCENARIOS } = await import("./scenarios");

  const started = Date.now();
  const scores: ScenarioScore[] = [];

  for (const scenario of SCENARIOS) {
    log(`Scenario ${scenario.key}: ${scenario.label}`);
    const baseline = await runCondition(scenario, "baseline", generateWorkoutSuggestions);
    const variant = await runCondition(scenario, "variant", generateWorkoutSuggestions);
    const score = scoreScenario(scenario, baseline, variant);
    scores.push(score);
    log(
      `  → influence=${score.influence.toFixed(3)} targetΔ=${score.targetOverlap.toFixed(2)} rationaleΔ=${score.rationaleDrift.toFixed(2)}`,
    );
  }

  const control = scores.find(s => s.input.startsWith("Control"));
  const noiseFloor = control?.influence ?? 0;

  const outDir = resolve(__dirname, "output");
  mkdirSync(outDir, { recursive: true });

  const jsonPath = resolve(outDir, "coach-influence-report.json");
  const mdPath = resolve(outDir, "coach-influence-report.md");

  writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        runsPerCondition: RUNS_PER_CONDITION,
        noiseFloor,
        durationMs: Date.now() - started,
        scores: scores.map(s => ({ ...s, verdict: verdict(s.influence, noiseFloor) })),
      },
      null,
      2,
    ),
  );
  writeFileSync(mdPath, renderMarkdown(scores, noiseFloor));

  log(`Wrote ${jsonPath}`);
  log(`Wrote ${mdPath}`);
}

try {
  await main();
} catch (err) {
  console.error(err);
  process.exit(1);
}
