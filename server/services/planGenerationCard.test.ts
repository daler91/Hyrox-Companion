import { describe, expect, it } from "vitest";

import { createMockAthleteFact } from "../../test/factories";
import { athleteCardLines, buildGenerationCard, generationCardConstraints } from "./planGenerationCard";

describe("buildGenerationCard", () => {
  it("adds what the athlete wrote for this plan that the card has no room for, stated today", () => {
    const card = buildGenerationCard([createMockAthleteFact()], "No sled at my gym. Bad left knee.", "2026-01-05");

    expect(card.facts).toEqual([
      { fact: "No sled at my gym", category: "equipment", reviewOn: "2026-03-01" },
      { fact: "Bad left knee.", category: "constraint", reviewOn: "2026-04-05" },
    ]);
    expect(generationCardConstraints(card)).toBe("No sled at my gym\nBad left knee.");
  });

  it("keeps a statement the athlete retired off the plan", () => {
    const card = buildGenerationCard([createMockAthleteFact({ active: false })], "No sled at my gym.", "2026-01-05");

    expect(card.facts).toEqual([]);
    expect(generationCardConstraints(card)).toBeNull();
  });
});

describe("athleteCardLines", () => {
  it("flags a fact past its review date, and adds nothing for an empty card", () => {
    const card = buildGenerationCard([createMockAthleteFact({ reviewOn: "2026-01-01" })], null, "2026-01-05");

    expect(athleteCardLines(card)).toContain("- Equipment: No sled at my gym (unconfirmed since 2026-01-01)");
    expect(athleteCardLines(buildGenerationCard([], null, "2026-01-05"))).toEqual([]);
    expect(athleteCardLines(undefined)).toEqual([]);
  });
});
