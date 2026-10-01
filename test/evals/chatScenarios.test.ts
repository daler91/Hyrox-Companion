import { describe, expect, it } from "vitest";

import { buildSystemPrompt, CHAT_RED_FLAG_GUIDANCE } from "../../server/prompts";
import { analyzeChatSafety } from "../../server/services/aiSafety";
import { CHAT_SCENARIOS, type ChatScenario } from "./chatScenarios";

/**
 * The eval scenarios (I22) only test something if their fixtures reach the
 * coach. These run in CI, without a model, so a prompt change that stops
 * rendering a scenario's situation shows up here rather than as a silently
 * meaningless eval.
 */

function scenario(id: string): ChatScenario {
  const found = CHAT_SCENARIOS.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`No scenario ${id}`);
  return found;
}

/** The system prompt the chat would build for the scenario. */
function promptFor(id: string): string {
  const { context, message, history, focusedWorkout } = scenario(id);
  return buildSystemPrompt(context, undefined, undefined, {
    chatSafety: analyzeChatSafety(message, history ?? []),
    focusedWorkout,
  });
}

describe("the chat eval scenarios", () => {
  it("have unique ids, and facts and criteria for the judge", () => {
    const ids = CHAT_SCENARIOS.map((candidate) => candidate.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const candidate of CHAT_SCENARIOS) {
      expect(candidate.modes.length, candidate.id).toBeGreaterThan(0);
      expect(candidate.facts.length, candidate.id).toBeGreaterThan(0);
      expect(candidate.criteria.length, candidate.id).toBeGreaterThan(0);
    }
  });

  it("expect tool calls and canned results only where the coach has tools", () => {
    for (const candidate of CHAT_SCENARIOS) {
      if (candidate.mustCallOneOf || candidate.toolResults) expect(candidate.modes, candidate.id).toEqual(["tools"]);
    }
  });

  it("put each scenario's situation in front of the coach", () => {
    expect(analyzeChatSafety(scenario("red-flag-chest-pain").message, []).redFlagDetected).toBe(true);
    expect(promptFor("red-flag-chest-pain")).toContain(CHAT_RED_FLAG_GUIDANCE);
    expect(promptFor("load-governor-danger")).toContain("ACWR 1.62 — DANGER zone.");
    expect(promptFor("taper-race-week")).toContain("PLAN PHASE: Week 12 of 12 (RACE_WEEK phase");
    expect(promptFor("imperial-units")).toContain("Units: the athlete uses lbs and miles");
    expect(promptFor("focused-workout")).toContain("--- FOCUSED WORKOUT ---");
    expect(promptFor("focused-workout")).toContain("6 x 800 m at 5k pace");
  });
});
