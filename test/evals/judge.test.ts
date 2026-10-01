import { beforeEach, describe, expect, it, vi } from "vitest";

import { generateJsonText } from "../../server/ai/providers";
import { CHAT_SCENARIOS, type ChatScenario } from "./chatScenarios";
import { buildJudgeInput, JUDGE_SYSTEM_PROMPT, judgeRun, parseVerdicts } from "./judge";

vi.mock("../../server/ai/providers", () => ({ generateJsonText: vi.fn() }));

function scenario(id: string): ChatScenario {
  const found = CHAT_SCENARIOS.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`No scenario ${id}`);
  return found;
}

const DISMISSED = scenario("dismissed-proposal");

describe("buildJudgeInput", () => {
  it("gives the judge the facts, the conversation with its notes, the reply as data, and numbered criteria", () => {
    const input = buildJudgeInput(DISMISSED, { reply: "No, it's still on Saturday.", calls: [] });

    expect(input).toContain(`- ${DISMISSED.facts[0]}`);
    expect(input).toContain("Athlete: Move my long run to Friday.");
    expect(input).toContain("(App note to the coach: The athlete dismissed the plan changes the coach proposed; the plan was not changed.)");
    expect(input).toContain("Athlete: So is my long run on Friday now?\n</conversation>");
    expect(input).toContain("<coach_reply>\nNo, it's still on Saturday.\n</coach_reply>");
    expect(input).toContain("Tools the coach called: none");
    expect(input).toContain(`1. ${DISMISSED.criteria[0]}\n2. ${DISMISSED.criteria[1]}`);
  });

  it("names the tools called and what a proposal asked for", () => {
    const input = buildJudgeInput(scenario("yes-please-tools"), {
      reply: "On it.",
      calls: ["get_workouts", "propose_plan_changes"],
      proposalRequest: "Move Saturday's long run to Sunday",
    });

    expect(input).toContain("Tools the coach called: get_workouts, propose_plan_changes");
    expect(input).toContain("It asked propose_plan_changes for: Move Saturday's long run to Sunday");
  });
});

describe("parseVerdicts", () => {
  it("reads each criterion's verdict by its number", () => {
    const verdicts = parseVerdicts(
      DISMISSED,
      JSON.stringify({
        results: [
          { criterion: 2, pass: true, reason: "It never says Friday." },
          { criterion: 1, pass: false, reason: "It doesn't say where the run is." },
        ],
      }),
    );

    expect(verdicts).toEqual([
      { criterion: DISMISSED.criteria[0], pass: false, reason: "It doesn't say where the run is." },
      { criterion: DISMISSED.criteria[1], pass: true, reason: "It never says Friday." },
    ]);
  });

  it("fails what the judge left out, or every criterion when its answer isn't the JSON asked for", () => {
    const partial = parseVerdicts(DISMISSED, JSON.stringify({ results: [{ criterion: 1, pass: true, reason: "Yes." }] }));
    expect(partial[1]).toEqual({ criterion: DISMISSED.criteria[1], pass: false, reason: "The judge did not grade this criterion." });

    expect(parseVerdicts(DISMISSED, "All good!").every((verdict) => !verdict.pass)).toBe(true);
  });
});

describe("judgeRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("asks the reasoning model, at low effort, with the judge's rules", async () => {
    vi.mocked(generateJsonText).mockResolvedValue({
      text: JSON.stringify({ results: [{ criterion: 1, pass: true, reason: "Yes." }, { criterion: 2, pass: true, reason: "Yes." }] }),
      model: "judge",
    });

    const verdicts = await judgeRun(DISMISSED, { reply: "Still Saturday.", calls: [] });

    expect(generateJsonText).toHaveBeenCalledWith(
      expect.objectContaining({ systemInstruction: JUDGE_SYSTEM_PROMPT, modelRole: "reasoning", reasoningEffort: "low", label: "eval-judge" }),
    );
    expect(verdicts.every((verdict) => verdict.pass)).toBe(true);
  });
});
