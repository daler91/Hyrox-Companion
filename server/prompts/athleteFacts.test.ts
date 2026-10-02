import { describe, expect, it } from "vitest";

import { createMockTrainingContext } from "../../test/factories";
import { buildPromptDataSections } from "../gemini/suggestionService";
import type { CoachAthleteFact } from "../gemini/types";
import { buildSystemPrompt } from "../prompts";
import { formatAthleteConstraints } from "./athleteConstraints";
import { formatAthleteFactLines } from "./athleteFacts";

const TODAY = "2026-10-01";

const FACTS: CoachAthleteFact[] = [
  { fact: "No sled at my gym", category: "equipment", reviewOn: "2026-12-30" },
  { fact: "Bad left knee: no deep lunges", category: "constraint", reviewOn: "2026-09-15" },
];

describe("formatAthleteFactLines", () => {
  it("renders each fact in the athlete's words with what it is about", () => {
    const lines = formatAthleteFactLines(FACTS.slice(0, 1), TODAY);

    expect(lines).toEqual([
      "ATHLETE CARD (what the athlete told us is true every week, in their own words; these always apply):",
      "- Equipment: No sled at my gym",
    ]);
  });

  it("flags a fact past its review date instead of dropping it, and says what that means", () => {
    const lines = formatAthleteFactLines(FACTS, TODAY);

    expect(lines).toContain("- Constraint: Bad left knee: no deep lunges (unconfirmed since 2026-09-15)");
    expect(lines.at(-1)).toContain("check whether it still applies");
  });

  it("escapes markup in a fact, and renders nothing for an empty card", () => {
    expect(formatAthleteFactLines([{ fact: 'Knee sore for <3 weeks & "no lunges"', category: "other", reviewOn: "2026-12-30" }], TODAY)).toContain(
      '- Note: Knee sore for &lt;3 weeks &amp; "no lunges"',
    );
    expect(formatAthleteFactLines([], TODAY)).toEqual([]);
    expect(formatAthleteFactLines(undefined, TODAY)).toEqual([]);
  });
});

describe("the athlete card in the ATHLETE CONSTRAINTS block", () => {
  it("comes before the older free-text note, under the one precedence line", () => {
    const block = formatAthleteConstraints(
      createMockTrainingContext({ currentDate: TODAY, athleteFacts: FACTS, trainingConstraints: "Avoid heavy squats." }),
    );

    expect(block.indexOf("ATHLETE CARD")).toBeLessThan(block.indexOf("STANDING CONSTRAINTS"));
    expect(block.match(/the constraints win/g)).toHaveLength(1);
  });

  it("states the precedence when the card is all the athlete has", () => {
    expect(formatAthleteConstraints(createMockTrainingContext({ currentDate: TODAY, athleteFacts: FACTS }))).toContain(
      "the constraints win — program a substitute",
    );
  });
});

/**
 * The drift guard (coach-memory spec §4): `mafHr` once sat on TrainingContext
 * rendered by neither prompt. The card has to reach the chat prompt, in both
 * its branches, and the auto-coach prompt.
 */
describe("the athlete card reaches every coach prompt", () => {
  const withFacts = (totalWorkouts: number) =>
    createMockTrainingContext({ totalWorkouts, currentDate: TODAY, athleteFacts: FACTS });

  it("is in the chat prompt, for an athlete with logged workouts and one on day one", () => {
    for (const totalWorkouts of [12, 0]) {
      const prompt = buildSystemPrompt(withFacts(totalWorkouts));
      expect(prompt).toContain("ATHLETE CARD");
      expect(prompt).toContain("No sled at my gym");
    }
  });

  it("is in the auto-coach prompt", () => {
    const sections = buildPromptDataSections(withFacts(12), []).join("\n");

    expect(sections).toContain("ATHLETE CARD");
    expect(sections).toContain("Bad left knee: no deep lunges (unconfirmed since 2026-09-15)");
  });
});
