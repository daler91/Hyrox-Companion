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
        // INVERTED (audit M24). This asserted time: 30 — the original session's
        // duration, copied alongside its distance, which prescribes the exact
        // pace the downshift exists to slow. Distance carries over so the
        // session keeps its shape; time is dropped so effort is not dictated.
        time: null,
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
      expect.objectContaining({ distance: 4000, time: null }),
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
    // A pure strength day has no run to borrow a distance from. It used to
    // produce a row with neither distance nor time — the athlete lost their
    // squats and got a blank prescription back (audit M24). A time-only easy
    // run is a usable session and still does not dictate pace.
    expect(result[0].structuredSetRows?.[0]).toEqual(
      expect.objectContaining({ distance: null, time: 30 }),
    );
  });
});

// AI14 (CODEBASE_ANALYSIS_2026-10-03): the auto-coach runs the governor on
// every pass, against the rows the previous pass wrote. Each test feeds one
// pass's output back in as the next pass's day.
describe("buildLoadGovernorSuggestions — repeat passes over the governor's own output", () => {
  function strengthRows(name: string, n: number) {
    return Array.from({ length: n }, (_, i) =>
      exercise({ exerciseName: name, category: "strength", setNumber: i + 1, reps: 5, weight: 100 }),
    );
  }

  /** The day as the next pass reads it: the rows and text the last pass wrote. */
  function afterPass(
    day: Parameters<typeof workout>[0],
    pass: ReturnType<typeof runGovernor>[number],
  ): Parameters<typeof workout>[0] {
    return {
      ...day,
      mainWorkout: pass.suggestion.recommendation,
      exerciseDetails: pass.structuredSetRows?.map((row) => ({
        exerciseName: row.exerciseName,
        category: row.category,
        setNumber: row.setNumber,
        reps: row.reps,
        weight: row.weight,
        distance: row.distance,
        time: row.time,
        notes: row.notes,
      })),
    };
  }

  it("cuts a structured day once, then holds it instead of compounding the cut", () => {
    const day = {
      id: "w1",
      date: "2026-05-23",
      focus: "Lower Strength",
      mainWorkout: "Back squat 5x5, deadlift 4x3",
      exerciseDetails: [...strengthRows("back_squat", 5), ...strengthRows("deadlift", 4)],
    };
    const yellow = [restriction("acwr_yellow_guard")];

    const [first] = runGovernor(yellow, [workout(day)]);
    expect(first.structuredSetRows).toHaveLength(6);

    const [second] = runGovernor(yellow, [workout(afterPass(day, first))]);
    // Still claimed (so the model and review notes leave the day alone), but
    // nothing more is cut: 9 → 6 sets, not 9 → 6 → 4 → 2.
    expect(second.held).toBe(true);
    expect(second.suggestion.workoutId).toBe("w1");
    expect(second.structuredSetRows).toBeUndefined();
  });

  it("holds a day it already converted to a recovery run rather than blanking the run", () => {
    const day = {
      id: "w1",
      date: "2026-05-23",
      focus: "Lower Strength",
      mainWorkout: "Heavy squats",
      exerciseDetails: strengthRows("back_squat", 5),
    };
    const danger = [restriction("acwr_danger_lock")];

    const [first] = runGovernor(danger, [workout(day)]);
    expect(first.structuredSetRows?.[0]).toEqual(expect.objectContaining({ time: 30 }));

    const converted = afterPass({ ...day, focus: "Recovery Run" }, first);
    const [second] = runGovernor(danger, [workout(converted)]);
    // The recovery text ("avoid hills, sprints, track work") reads as a hard
    // run, and rebuilding from the recovery_run row wrote distance and time
    // both null — the 30-minute run became a blank row.
    expect(second.held).toBe(true);
    expect(second.structuredSetRows).toBeUndefined();
  });

  it("holds a free-text day already converted to the recovery run", () => {
    const day = { id: "w1", date: "2026-05-23", focus: "Run", mainWorkout: "Hill repeats 8x60s" };
    const posterior = [restriction("posterior_chain_velocity_lock")];

    const [first] = runGovernor(posterior, [workout(day)]);
    const [second] = runGovernor(posterior, [workout(afterPass({ ...day, focus: "Recovery Run" }, first))]);

    expect(second.held).toBe(true);
  });

  it("still escalates a day it reduced to a recovery run when the danger lock arrives", () => {
    const day = {
      id: "w1",
      date: "2026-05-23",
      focus: "Lower Strength",
      mainWorkout: "Back squat 5x5",
      exerciseDetails: strengthRows("back_squat", 5),
    };
    const [reduced] = runGovernor([restriction("acwr_yellow_guard")], [workout(day)]);

    const [escalated] = runGovernor([restriction("acwr_danger_lock")], [workout(afterPass(day, reduced))]);

    expect(escalated.held).toBeUndefined();
    expect(escalated.focusOverride).toBe("Recovery Run");
    expect(escalated.structuredSetRows?.[0].exerciseName).toBe("recovery_run");
  });
});
