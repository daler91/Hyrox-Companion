import { describe, expect, it } from "vitest";

import { describeOnboardingGoal, ONBOARDING_GOALS } from "../onboardingGoals";

describe("describeOnboardingGoal", () => {
  it("has a sentence of its own for every goal", () => {
    const sentences = ONBOARDING_GOALS.map((goal) => describeOnboardingGoal(goal.id));
    expect(new Set(sentences).size).toBe(ONBOARDING_GOALS.length);
    expect(describeOnboardingGoal("endurance")).toBe(
      "Build my running endurance for HYROX's eight 1 km runs",
    );
  });

  it("names the division in the functional goal", () => {
    expect(describeOnboardingGoal("functional")).toBe(
      "Complete HYROX Open feeling strong on every station",
    );
    expect(describeOnboardingGoal("functional", { division: "pro" })).toBe(
      "Complete HYROX Pro feeling strong on every station",
    );
  });

  it("treats an unknown goal as the default functional goal", () => {
    expect(describeOnboardingGoal("unknown")).toBe(describeOnboardingGoal("functional"));
  });

  it("adds the race date when there is one", () => {
    expect(describeOnboardingGoal("strength", { raceDate: "2026-11-15" })).toBe(
      "Get stronger for HYROX: heavier sled push and pull, and steadier lunges and wall balls, racing on 2026-11-15",
    );
  });
});
