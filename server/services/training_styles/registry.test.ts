import { describe, expect, it } from "vitest";

import type { TrainingContext } from "../../gemini";
import { resolveTrainingStyle } from "./registry";

const baseContext: TrainingContext = {
  completionRate: 82,
  currentStreak: 6,
  completedWorkouts: 9,
  missedWorkouts: 1,
  skippedWorkouts: 1,
  coachingInsights: {
    rpeTrend: "stable",
    fatigueFlag: false,
    undertrainingFlag: false,
    decisionTree: { currentPhase: "aerobic_base", rationaleCodes: ["S8_INTENSITY_BLOCKED"] },
    planPhase: {
      currentWeek: 3,
      totalWeeks: 12,
      phaseLabel: "build",
      progressPct: 25,
      remainingPhases: ["peak", "taper", "race_week"],
    },
  },
};

describe("training style prompt context", () => {
  it("captures onboarding MAF style defaults and strict language", () => {
    const { strategy } = resolveTrainingStyle("maf_method");
    const prompt = strategy.buildPromptContext(baseContext, [{ id: "w-1", title: "Aerobic run" } as never]).promptSuffix ?? "";

    expect(prompt).toContain("Training style: maf_method");
    expect(prompt).toContain("strict intensity discipline around the MAF ceiling");
    expect(prompt).toContain("ceiling, not target");
    expect(prompt).toContain("monthly MAF test");
    expect(prompt).toContain("Analysis class template - compliant");
    expect(prompt).toContain("Analysis class template - non-compliant");
  });

  it("keeps style-specific divergence intentional for identical workouts (regression)", () => {
    const workouts = [{ id: "w-1", title: "Same workout" } as never];
    const mafPrompt = resolveTrainingStyle("maf_method").strategy.buildPromptContext(baseContext, workouts).promptSuffix ?? "";
    const balancedPrompt = resolveTrainingStyle("balanced_default").strategy.buildPromptContext(baseContext, workouts).promptSuffix ?? "";

    expect(mafPrompt).not.toEqual(balancedPrompt);
    expect(mafPrompt).toContain("Style core (MAF)");
    expect(balancedPrompt).toContain("Style core: balance progression");
  });

  it("suppresses intensity guidance during strict phases via phase constraints", () => {
    const context: TrainingContext = {
      ...baseContext,
      coachingInsights: {
        ...baseContext.coachingInsights,
        planPhase: {
          ...baseContext.coachingInsights!.planPhase!,
          phaseLabel: "race_week",
        },
      },
    };

    const prompt = resolveTrainingStyle("maf_method").strategy.buildPromptContext(context, []).promptSuffix ?? "";
    expect(prompt).toContain("Phase constraints (RACE WEEK): reduce work only");
  });
});
