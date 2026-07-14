import { describe, expect, it, vi } from "vitest";

import {
  buildPlanAdjustmentUserPrompt,
  parseAndValidatePlanAdjustment,
} from "./planAdjustmentService";
import type { TrainingContext } from "./types";

vi.mock("../ai/providers", () => ({
  generateJsonText: vi.fn(),
}));

function validChange(overrides: Record<string, unknown> = {}) {
  return {
    planDayId: "day-1",
    updatedFields: { mainWorkout: "5x1km run at race pace" },
    rationale: "Practices race pacing before the event.",
    ...overrides,
  };
}

describe("parseAndValidatePlanAdjustment", () => {
  it("returns the validated envelope", () => {
    const result = parseAndValidatePlanAdjustment(
      JSON.stringify({ summaryMessage: "Swapped Thursday for your class.", changes: [validChange()] }),
    );

    expect(result).not.toBeNull();
    expect(result?.summaryMessage).toBe("Swapped Thursday for your class.");
    expect(result?.changes).toHaveLength(1);
    expect(result?.changes[0].planDayId).toBe("day-1");
  });

  it("returns null on unparseable JSON", () => {
    expect(parseAndValidatePlanAdjustment("not json")).toBeNull();
  });

  it("returns null when the envelope is missing a summaryMessage", () => {
    expect(
      parseAndValidatePlanAdjustment(JSON.stringify({ changes: [validChange()] })),
    ).toBeNull();
  });

  it("drops invalid changes but keeps the valid ones", () => {
    const result = parseAndValidatePlanAdjustment(
      JSON.stringify({
        summaryMessage: "Two changes.",
        changes: [
          validChange(),
          { planDayId: "day-2" }, // no updatedFields
          { planDayId: "day-3", updatedFields: {}, rationale: "empty fields" },
          validChange({ planDayId: "day-4", updatedFields: { expectedRpe: 99 } }), // out of range
        ],
      }),
    );

    expect(result?.changes.map((c) => c.planDayId)).toEqual(["day-1"]);
  });

  it("accepts an empty changes array (coach declines / clarifies)", () => {
    const result = parseAndValidatePlanAdjustment(
      JSON.stringify({ summaryMessage: "Which day do you mean?", changes: [] }),
    );

    expect(result?.changes).toEqual([]);
  });

  it("normalizes ampersands in summary, rationale, and text fields", () => {
    const result = parseAndValidatePlanAdjustment(
      JSON.stringify({
        summaryMessage: "Strength & conditioning day updated.",
        changes: [
          validChange({
            updatedFields: { mainWorkout: "Squats & lunges", notes: "Slow & controlled" },
            rationale: "Balance & recovery",
          }),
        ],
      }),
    );

    expect(result?.summaryMessage).toBe("Strength and conditioning day updated.");
    expect(result?.changes[0].updatedFields.mainWorkout).toBe("Squats and lunges");
    expect(result?.changes[0].updatedFields.notes).toBe("Slow and controlled");
    expect(result?.changes[0].rationale).toBe("Balance and recovery");
  });

  it("caps the number of changes at 14", () => {
    const changes = Array.from({ length: 20 }, (_, i) =>
      validChange({ planDayId: `day-${i}` }),
    );
    const result = parseAndValidatePlanAdjustment(
      JSON.stringify({ summaryMessage: "Lots of changes.", changes }),
    );

    expect(result?.changes).toHaveLength(14);
  });
});

describe("buildPlanAdjustmentUserPrompt", () => {
  const trainingContext = {
    completionRate: 80,
    currentStreak: 3,
    completedWorkouts: 12,
    currentDate: "2026-07-14",
    exerciseBreakdown: {},
    structuredExerciseStats: {},
    recentWorkouts: [],
  } as unknown as TrainingContext;

  const upcomingWorkouts = [
    { id: "day-1", date: "2026-07-16", focus: "Tempo Run", mainWorkout: "40min tempo" },
    { id: "day-2", date: "2026-07-17", focus: "EMOM", mainWorkout: "EMOM 20" },
  ];

  it("includes day IDs, structure-block restrictions, focus hint, and the sanitized request", () => {
    const prompt = buildPlanAdjustmentUserPrompt({
      trainingContext,
      upcomingWorkouts,
      structureBlockDayIds: new Set(["day-2"]),
      userMessage: "I want to go to a hyrox class <b>this week</b>",
      history: [{ role: "user", content: "how was my week?" }],
      focusPlanDayId: "day-1",
    });

    expect(prompt).toContain("ID: day-1");
    expect(prompt).toContain("ID: day-2");
    expect(prompt).toContain("STRUCTURE-BLOCK DAYS");
    expect(prompt).toContain("day-2");
    expect(prompt).toContain("FOCUSED DAY");
    expect(prompt).toContain("<user_input>");
    // XML-ish user content is entity-encoded so it can't break the tags.
    expect(prompt).toContain("&lt;b&gt;this week&lt;/b&gt;");
    expect(prompt).toContain("--- RECENT CONVERSATION ---");
    expect(prompt).toContain("Athlete: how was my week?");
  });

  it("omits optional sections when their inputs are absent", () => {
    const prompt = buildPlanAdjustmentUserPrompt({
      trainingContext,
      upcomingWorkouts,
      structureBlockDayIds: new Set(),
      userMessage: "make friday easier",
      history: [],
    });

    expect(prompt).not.toContain("STRUCTURE-BLOCK DAYS");
    expect(prompt).not.toContain("FOCUSED DAY");
    expect(prompt).not.toContain("--- RECENT CONVERSATION ---");
  });
});
