import { describe, expect, it } from "vitest";

import { buildLoadGovernorSuggestions } from "./trainingLoadGovernor";
import {
  CURRENT_DATE,
  exercise,
  restriction,
  summary,
  workout,
} from "./trainingLoadGovernor.testHelpers";

// These tests cover the SHAPE of the suggestion payload (focus override,
// targetField/action, recommendation text formatting, structured row
// generation) once a rule has fired. The rule-matching behavior itself is
// covered in trainingLoadGovernor.test.ts.
describe("buildLoadGovernorSuggestions — suggestion construction", () => {
  it("rewrites every suggestion's focus to 'Recovery Run' via focusOverride", () => {
    const result = buildLoadGovernorSuggestions(
      summary([restriction("posterior_chain_velocity_lock")]),
      [
        workout({
          id: "w1",
          date: "2026-05-23",
          focus: "Hill Session",
          mainWorkout: "Hill repeats",
        }),
      ],
      CURRENT_DATE,
    );
    expect(result[0].focusOverride).toBe("Recovery Run");
  });

  it("targets mainWorkout with action=replace and preserves the original focus on the suggestion payload", () => {
    const result = buildLoadGovernorSuggestions(
      summary([restriction("posterior_chain_velocity_lock")]),
      [
        workout({
          id: "w1",
          date: "2026-05-23",
          focus: "Hill Session",
          mainWorkout: "Hill repeats",
        }),
      ],
      CURRENT_DATE,
    );
    expect(result[0].suggestion).toMatchObject({
      workoutId: "w1",
      workoutDate: "2026-05-23",
      workoutFocus: "Hill Session",
      targetField: "mainWorkout",
      action: "replace",
    });
  });

  it("composes the recommendation with minutes and distance from the first running exercise", () => {
    const result = buildLoadGovernorSuggestions(
      summary([restriction("posterior_chain_velocity_lock")]),
      [
        workout({
          id: "w1",
          date: "2026-05-23",
          focus: "Run",
          mainWorkout: "Hill repeats",
          exerciseDetails: [
            exercise({
              exerciseName: "hill_repeats",
              category: "running",
              time: 45,
              distance: 6000.4,
            }),
            exercise({
              exerciseName: "easy_run",
              category: "running",
              time: 10,
              distance: 1000,
            }),
          ],
        }),
      ],
      CURRENT_DATE,
    );
    // 6000.4 should round DOWN to 6000.
    expect(result[0].suggestion.recommendation).toBe(
      "Flat low-intensity aerobic run - 45 min - 6000 m. Keep effort conversational and avoid hills, sprints, track work, and downhill braking.",
    );
  });

  it("omits the time/distance details when no running exercise is present", () => {
    const result = buildLoadGovernorSuggestions(
      summary([restriction("posterior_chain_velocity_lock")]),
      [
        workout({
          id: "w1",
          date: "2026-05-23",
          focus: "Run",
          mainWorkout: "Hill repeats",
          exerciseDetails: [exercise({ exerciseName: "back_squat", category: "strength" })],
        }),
      ],
      CURRENT_DATE,
    );
    expect(result[0].suggestion.recommendation).toBe(
      "Flat low-intensity aerobic run. Keep effort conversational and avoid hills, sprints, track work, and downhill braking.",
    );
  });

  it("emits a structured recovery_run row when exerciseDetails are populated", () => {
    const result = buildLoadGovernorSuggestions(
      summary([restriction("posterior_chain_velocity_lock")]),
      [
        workout({
          id: "plan-day-1",
          date: "2026-05-23",
          focus: "Run",
          mainWorkout: "Hill repeats",
          exerciseDetails: [
            exercise({
              exerciseName: "hill_repeats",
              category: "running",
              time: 30,
              distance: 5000,
            }),
          ],
        }),
      ],
      CURRENT_DATE,
    );
    expect(result[0].structuredSetRows).toEqual([
      expect.objectContaining({
        planDayId: "plan-day-1",
        workoutLogId: null,
        exerciseName: "recovery_run",
        category: "running",
        setNumber: 1,
        distance: 5000,
        time: 30,
        notes: "Load governor downshift: flat, low-intensity aerobic session.",
        confidence: 95,
        sortOrder: 0,
      }),
    ]);
  });

  it("omits structuredSetRows when exerciseDetails is undefined", () => {
    const result = buildLoadGovernorSuggestions(
      summary([restriction("posterior_chain_velocity_lock")]),
      [
        workout({
          id: "w1",
          date: "2026-05-23",
          focus: "Run",
          mainWorkout: "Hill repeats",
        }),
      ],
      CURRENT_DATE,
    );
    expect(result[0].structuredSetRows).toBeUndefined();
  });

  it("omits structuredSetRows when exerciseDetails is an empty array (length 0 is falsy)", () => {
    const result = buildLoadGovernorSuggestions(
      summary([restriction("posterior_chain_velocity_lock")]),
      [
        workout({
          id: "w1",
          date: "2026-05-23",
          focus: "Run",
          mainWorkout: "Hill repeats",
          exerciseDetails: [],
        }),
      ],
      CURRENT_DATE,
    );
    expect(result[0].structuredSetRows).toBeUndefined();
  });

  it("structured row reflects the FIRST running exercise's distance/time, ignoring later runs", () => {
    const result = buildLoadGovernorSuggestions(
      summary([restriction("posterior_chain_velocity_lock")]),
      [
        workout({
          id: "plan-day-1",
          date: "2026-05-23",
          focus: "Run",
          mainWorkout: "Hill repeats",
          exerciseDetails: [
            exercise({ exerciseName: "back_squat", category: "strength" }),
            exercise({
              exerciseName: "hill_repeats",
              category: "running",
              time: 25,
              distance: 4000,
            }),
            exercise({
              exerciseName: "easy_run",
              category: "running",
              time: 99,
              distance: 99999,
            }),
          ],
        }),
      ],
      CURRENT_DATE,
    );
    expect(result[0].structuredSetRows?.[0]).toEqual(
      expect.objectContaining({ distance: 4000, time: 25 }),
    );
  });
});
