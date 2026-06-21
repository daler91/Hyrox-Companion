import { describe, expect, it } from "vitest";

import { exercise, restriction, runGovernor, workout } from "./trainingLoadGovernor.testHelpers";

// These tests cover the SHAPE of the suggestion payload (focus override,
// targetField/action, recommendation text formatting, structured row
// generation) once a rule has fired. The rule-matching behavior itself is
// covered in trainingLoadGovernor.test.ts.
const POSTERIOR = "posterior_chain_velocity_lock";

/** Run the governor against one posterior-tripping workout. */
function downshiftOf(spec: Parameters<typeof workout>[0]) {
  return runGovernor([restriction(POSTERIOR)], [workout(spec)]);
}

describe("buildLoadGovernorSuggestions — suggestion construction", () => {
  it("rewrites the focus to 'Recovery Run' via focusOverride", () => {
    const result = downshiftOf({
      id: "w1",
      date: "2026-05-23",
      focus: "Hill Session",
      mainWorkout: "Hill repeats",
    });
    expect(result[0].focusOverride).toBe("Recovery Run");
  });

  it("targets mainWorkout with action=replace and preserves the original focus", () => {
    const result = downshiftOf({
      id: "w1",
      date: "2026-05-23",
      focus: "Hill Session",
      mainWorkout: "Hill repeats",
    });
    expect(result[0].suggestion).toMatchObject({
      workoutId: "w1",
      workoutDate: "2026-05-23",
      workoutFocus: "Hill Session",
      targetField: "mainWorkout",
      action: "replace",
    });
  });

  it("composes the recommendation with minutes and distance from the first running exercise", () => {
    const result = downshiftOf({
      id: "w1",
      date: "2026-05-23",
      mainWorkout: "Hill repeats",
      exerciseDetails: [
        exercise({ exerciseName: "hill_repeats", time: 45, distance: 6000.4 }),
        exercise({ exerciseName: "easy_run", time: 10, distance: 1000 }),
      ],
    });
    // 6000.4 should round DOWN to 6000.
    expect(result[0].suggestion.recommendation).toBe(
      "Flat low-intensity aerobic run - 45 min - 6000 m. Keep effort conversational and avoid hills, sprints, track work, and downhill braking.",
    );
  });

  it("omits the time/distance details when no running exercise is present", () => {
    const result = downshiftOf({
      id: "w1",
      date: "2026-05-23",
      mainWorkout: "Hill repeats",
      exerciseDetails: [exercise({ exerciseName: "back_squat", category: "strength" })],
    });
    expect(result[0].suggestion.recommendation).toBe(
      "Flat low-intensity aerobic run. Keep effort conversational and avoid hills, sprints, track work, and downhill braking.",
    );
  });

  it("emits a structured recovery_run row when exerciseDetails are populated", () => {
    const result = downshiftOf({
      id: "plan-day-1",
      date: "2026-05-23",
      mainWorkout: "Hill repeats",
      exerciseDetails: [exercise({ exerciseName: "hill_repeats", time: 30, distance: 5000 })],
    });
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

  it.each([
    { name: "exerciseDetails is undefined", spec: {} },
    {
      name: "exerciseDetails is an empty array (length 0 is falsy)",
      spec: { exerciseDetails: [] },
    },
  ])("omits structuredSetRows when $name", ({ spec }) => {
    const result = downshiftOf({
      id: "w1",
      date: "2026-05-23",
      mainWorkout: "Hill repeats",
      ...spec,
    });
    expect(result[0].structuredSetRows).toBeUndefined();
  });

  it("structured row reflects the FIRST running exercise's distance/time, ignoring later runs", () => {
    const result = downshiftOf({
      id: "plan-day-1",
      date: "2026-05-23",
      mainWorkout: "Hill repeats",
      exerciseDetails: [
        exercise({ exerciseName: "back_squat", category: "strength" }),
        exercise({ exerciseName: "hill_repeats", time: 25, distance: 4000 }),
        exercise({ exerciseName: "easy_run", time: 99, distance: 99999 }),
      ],
    });
    expect(result[0].structuredSetRows?.[0]).toEqual(
      expect.objectContaining({ distance: 4000, time: 25 }),
    );
  });
});

describe("buildLoadGovernorSuggestions — graduated (reduce/cap) downshifts", () => {
  function strengthRows(name: string, n: number) {
    return Array.from({ length: n }, () =>
      exercise({ exerciseName: name, category: "strength", reps: 5, weight: 200 }),
    );
  }

  it("caution (yellow) trims a structured session's sets and keeps its title", () => {
    const result = runGovernor(
      [restriction("acwr_yellow_guard")],
      [workout({
        id: "w1",
        date: "2026-05-23",
        focus: "Strength",
        mainWorkout: "Working sets",
        exerciseDetails: strengthRows("deadlift", 5),
      })],
    );
    expect(result).toHaveLength(1);
    expect(result[0].focusOverride).toBeUndefined(); // keeps the original title
    expect(result[0].suggestion).toMatchObject({ targetField: "mainWorkout", action: "replace" });
    // round(5 * 2/3) = 3 sets kept, all deadlift, renumbered 1..3.
    const rows = result[0].structuredSetRows;
    expect(rows).toHaveLength(3);
    expect(rows?.every((r) => r.exerciseName === "deadlift")).toBe(true);
    expect(rows?.map((r) => r.setNumber)).toEqual([1, 2, 3]);
  });

  it("on-ramp keeps more volume than caution (round(5 * 4/5) = 4 sets)", () => {
    const result = runGovernor(
      [restriction("acwr_onramp")],
      [workout({
        id: "w1",
        date: "2026-05-23",
        focus: "Strength",
        mainWorkout: "Squats",
        exerciseDetails: strengthRows("back_squat", 5),
      })],
    );
    expect(result[0].structuredSetRows).toHaveLength(4);
    expect(result[0].focusOverride).toBeUndefined();
  });

  it("caution free-text appends a notes cue instead of rewriting the prescription", () => {
    const result = runGovernor(
      [restriction("acwr_yellow_guard")],
      [workout({ id: "w1", date: "2026-05-23", focus: "Strength", mainWorkout: "Heavy deadlift triples" })],
    );
    expect(result[0].focusOverride).toBeUndefined();
    expect(result[0].structuredSetRows).toBeUndefined();
    expect(result[0].suggestion).toMatchObject({ targetField: "notes", action: "append" });
    expect(result[0].suggestion.recommendation).toContain("cut total volume");
  });

  it("caution falls back to a notes cue when no set can be dropped (single-set exercises)", () => {
    const result = runGovernor(
      [restriction("acwr_yellow_guard")],
      [workout({
        id: "w1",
        date: "2026-05-23",
        focus: "Strength",
        mainWorkout: "Working sets",
        exerciseDetails: [
          exercise({ exerciseName: "deadlift", category: "strength", reps: 5, weight: 200 }),
          exercise({ exerciseName: "back_squat", category: "strength", reps: 5, weight: 150 }),
        ],
      })],
    );
    expect(result[0].structuredSetRows).toBeUndefined();
    expect(result[0].suggestion.targetField).toBe("notes");
  });

  it("danger still swaps to a full Recovery Run (contrast with caution)", () => {
    const result = runGovernor(
      [restriction("acwr_danger_lock")],
      [workout({
        id: "w1",
        date: "2026-05-23",
        focus: "Strength",
        mainWorkout: "Heavy squats",
        exerciseDetails: strengthRows("back_squat", 5),
      })],
    );
    expect(result[0].focusOverride).toBe("Recovery Run");
    expect(result[0].structuredSetRows?.[0].exerciseName).toBe("recovery_run");
  });
});
