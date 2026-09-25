/**
 * The Training Overview carries load by body system for the load window.
 */

import { describe, expect, it } from "vitest";

import type { ExerciseSetWithDate } from "../analyticsService";
import { calculateTrainingOverview } from "../analyticsService";
import { makeWorkoutLog } from "../trainingLoadService.testHelpers";

describe("calculateTrainingOverview — load by body system", () => {
  it("splits the load window's sessions by body system, as of the load window's date", () => {
    const run = makeWorkoutLog({
      id: "run",
      date: "2026-05-20",
      mainWorkout: "",
      duration: 30,
      rpe: 5,
    });
    const set = {
      id: "set-1",
      workoutLogId: "run",
      date: "2026-05-20",
      exerciseName: "easy_run",
      category: "running",
      setNumber: 1,
      time: 30,
    } as ExerciseSetWithDate;

    const result = calculateTrainingOverview([], [], undefined, {
      trainingLoadInput: { workoutLogs: [run], exerciseSets: [set], currentDate: "2026-05-22" },
    });

    expect(result.bodySystemLoad?.asOf).toBe("2026-05-22");
    // 30 min × RPE 5 = 150: a full share for the heart and for foot-strike, half for the legs.
    expect(result.bodySystemLoad?.systems.map((s) => [s.system, s.current])).toEqual([
      ["aerobic", 150],
      ["running_impact", 150],
      ["leg_muscle", 75],
      ["upper_pull", 0],
    ]);
  });
});
