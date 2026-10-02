// @vitest-environment node
import { afterAll, describe, expect, it } from "vitest";

import { CHAT_SCENARIOS, type ChatEvalMode } from "./chatScenarios";
import { type CoachRun, judgeRun } from "./judge";
import { runScenario, toolCallFailures } from "./runChatScenario";

/**
 * The coach chat scenario evals (AI coach chat review, I22), against the
 * configured text provider with an LLM judge. Off by default: they cost money
 * and depend on a live model. `pnpm eval:chat` runs them; AI_EVAL_MODES=tools
 * (or classic) runs one mode.
 */
const runEval = process.env.RUN_AI_EVAL === "true";
const modes = new Set((process.env.AI_EVAL_MODES ?? "classic,tools").split(",").map((mode) => mode.trim()));

interface ReportRow {
  readonly scenario: string;
  readonly mode: ChatEvalMode;
  readonly result: string;
}
const report: ReportRow[] = [];

const FAILED_HINT =
  "The coach's request failed: a provider error or missing key, or the output validator refusing a restricted phrase in the reply (such as 'system prompt'), which the athlete would see as an error. Check the log above.";

async function failuresFor(scenario: (typeof CHAT_SCENARIOS)[number], mode: ChatEvalMode): Promise<{ run?: CoachRun; failures: string[] }> {
  let run: CoachRun;
  try {
    run = await runScenario(scenario, mode);
  } catch (error) {
    return { failures: [`${FAILED_HINT} (${error instanceof Error ? error.message : String(error)})`] };
  }
  const verdicts = await judgeRun(scenario, run);
  return {
    run,
    failures: [
      ...toolCallFailures(scenario, run),
      ...verdicts.filter((verdict) => !verdict.pass).map((verdict) => `${verdict.criterion} — ${verdict.reason}`),
    ],
  };
}

describe.runIf(runEval)("coach chat scenarios", () => {
  afterAll(() => {
    // The summary, for the log of a prompt or model change.
    console.table(report);
  });

  for (const scenario of CHAT_SCENARIOS) {
    for (const mode of scenario.modes.filter((candidate) => modes.has(candidate))) {
      it(`${scenario.id} (${mode}): ${scenario.title}`, async () => {
        const { run, failures } = await failuresFor(scenario, mode);
        report.push({ scenario: scenario.id, mode, result: failures.length === 0 ? "pass" : `FAIL (${failures.length})` });
        const shown = run ? `Reply: ${run.reply}\nCalls: ${run.calls.join(", ") || "none"}` : "No reply.";
        expect(failures, shown).toEqual([]);
      }, 180_000);
    }
  }
});
