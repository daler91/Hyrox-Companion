import { describe, expect, it } from "vitest";

import { buildWorkoutEnginePlan, type WorkoutEngineInput } from "./enginePlan";

function input(overrides: Partial<WorkoutEngineInput> = {}): WorkoutEngineInput {
  return {
    lens: "hyrox",
    experience: "intermediate",
    primaryLifts: [
      { slot: "squat", exercise: "front_squat", sessions: 2 },
      { slot: "pull", exercise: "bent_over_row", sessions: 0 },
    ],
    goal: "HYROX Open",
    totalWeeks: 8,
    daysPerWeek: 4,
    hasRace: true,
    today: "2026-09-20",
    weightUnit: "kg",
    distanceUnit: "km",
    division: "open",
    gender: "female",
    sets: [
      { exerciseName: "front_squat", workoutLogId: "a", date: "2026-09-08", reps: 5, weight: 60 },
      { exerciseName: "front_squat", workoutLogId: "b", date: "2026-09-15", reps: 5, weight: 62.5 },
    ],
    logs: [
      { id: "r1", date: "2026-09-10", focus: "Run", distanceMeters: 5000, duration: 27 },
      { id: "r2", date: "2026-09-17", focus: "Run", distanceMeters: 8000, duration: 48 },
    ],
    ...overrides,
  };
}

describe("buildWorkoutEnginePlan", () => {
  it("covers every week of the plan", () => {
    const plan = buildWorkoutEnginePlan(input());
    expect(plan.outline).toHaveLength(8);
    expect(plan.weeks).toHaveLength(8);
    expect(plan.runVolume).toHaveLength(8);
    for (const lift of plan.lifts) expect(lift.weeks).toHaveLength(8);
  });

  it("estimates the primary lifts it has history for and fits paces to the runs", () => {
    const plan = buildWorkoutEnginePlan(input());
    expect(plan.lifts.map((lift) => [lift.exercise, lift.estimate?.e1rm ?? null])).toEqual([
      ["front_squat", 77.1],
      ["bent_over_row", null],
    ]);
    expect(plan.paces?.basis.date).toBe("2026-09-10");
    expect(plan.runBaseline).toEqual({ weeklyKm: 3.3, longestRunKm: 8, runsPerWeek: 0.5 });
  });

  it("keeps one weekly rhythm through a phase, so every chunk shares it", () => {
    const plan = buildWorkoutEnginePlan(input());
    const days = (week: number) => plan.weeks[week - 1].sessions.map((session) => session.day);
    expect(days(1)).toEqual(days(2));
    expect(days(1)).toEqual(days(4));
  });

  it("loads station doses from the race standard, minus the stations the athlete can't do", () => {
    const plan = buildWorkoutEnginePlan(input({ constraints: "no sled at my gym" }));
    const early = plan.stations.early!;
    expect(early.doses.map((dose) => dose.station)).not.toContain("sled_push");
    expect(early.doses.find((dose) => dose.station === "wall_balls")?.load).toBe(4);
  });

  it("has no stations and no running backbone for a strength goal", () => {
    const plan = buildWorkoutEnginePlan(input({ lens: "strength" }));
    expect(plan.stations).toEqual({});
    expect(plan.runVolume).toEqual([]);
  });

  it("trains stations for a non-HYROX goal that asked for one as a focus area", () => {
    const plan = buildWorkoutEnginePlan(input({ lens: "general", focusAreas: ["wall_balls"] }));
    expect(plan.stations.early).toBeDefined();
  });
});
