/**
 * The "best time" personal record: a time is only a record against a time for
 * the same amount of work — C1 (CODEBASE_ANALYSIS_2026-10-03). Keeping the raw
 * minimum per exercise crowned the shortest piece every time, on the PR tab,
 * in the AI coach's context and in the weekly email's PR count.
 */

import { describe, expect, it } from "vitest";

import type { SlimLoggedExerciseSet } from "../../storage/shared";
import { calculatePersonalRecords, countPersonalRecordsInRange } from "../analyticsService";

function makeSet(overrides: Partial<SlimLoggedExerciseSet> = {}): SlimLoggedExerciseSet {
  return {
    exerciseName: "skierg",
    category: "functional",
    date: "2026-01-15",
    workoutLogId: "w1",
    customLabel: null,
    reps: null,
    weight: null,
    distance: null,
    time: null,
    weightUnit: null,
    distanceUnit: null,
    ...overrides,
  };
}

const ski = (distance: number | null, time: number, date: string, workoutLogId: string) =>
  makeSet({ distance, time, date, workoutLogId });

describe("best time compares like-for-like work only (C1)", () => {
  it("does not crown a shorter piece as the best time", () => {
    const prs = calculatePersonalRecords([
      ski(1000, 4, "2026-01-05", "w1"),
      ski(1000, 3.9, "2026-01-08", "w2"),
      ski(250, 0.9, "2026-01-12", "w3"),
    ]);
    expect(prs["skierg"].bestTime).toEqual({ value: 3.9, date: "2026-01-08", workoutLogId: "w2" });
  });

  it("records no best time for runs logged by time alone", () => {
    // A bare time on distance-carrying work is a duration: the shortest easy
    // run is not the athlete's best one.
    const prs = calculatePersonalRecords([
      makeSet({ exerciseName: "easy_run", category: "running", time: 30, date: "2026-01-10", workoutLogId: "w1" }),
      makeSet({ exerciseName: "easy_run", category: "running", time: 20, date: "2026-01-15", workoutLogId: "w2" }),
    ]);
    expect(prs["easy_run"]?.bestTime).toBeUndefined();
  });

  it("does not count a shorter piece as a PR in the weekly email's count", () => {
    const prs = calculatePersonalRecords([
      ski(1000, 4, "2026-01-05", "w1"),
      ski(1000, 4.1, "2026-01-08", "w2"),
      ski(250, 0.9, "2026-01-12", "w3"),
    ]);
    // 250 m in 0:54 is not faster than 1000 m in 4:00, so the week holds no PR.
    expect(countPersonalRecordsInRange(prs, "2026-01-12", "2026-01-18")).toBe(0);
  });

  it("headlines the distance the athlete repeats most", () => {
    const prs = calculatePersonalRecords([
      ski(1000, 4, "2026-01-05", "w1"),
      ski(250, 0.95, "2026-01-08", "w2"),
      ski(250, 0.9, "2026-01-12", "w3"),
      ski(250, 0.92, "2026-01-15", "w4"),
    ]);
    expect(prs["skierg"].bestTime?.value).toBe(0.9);
  });

  it("reports no best time for runs that never repeat a distance", () => {
    // A Strava runner's history: every run a different length. None of them is
    // a record of anything, least of all the shortest.
    const run = (distance: number, time: number, date: string, workoutLogId: string) =>
      makeSet({ exerciseName: "run", category: "running", distance, time, date, workoutLogId });
    const prs = calculatePersonalRecords([
      run(8000, 42, "2026-01-05", "w1"),
      run(3000, 15, "2026-01-08", "w2"),
      run(12000, 65, "2026-01-12", "w3"),
    ]);
    expect(prs["run"].bestTime).toBeUndefined();
    expect(prs["run"].maxDistance?.value).toBe(12000);
  });

  it("treats distances within a small tolerance, read through their unit stamps, as one piece", () => {
    const row = (distance: number, distanceUnit: string, time: number, date: string, workoutLogId: string) =>
      makeSet({ exerciseName: "rowing", distance, distanceUnit, time, date, workoutLogId });
    const prs = calculatePersonalRecords(
      [
        row(1000, "m", 3.8, "2026-01-05", "w1"),
        // 3,280 ft is 999.7 m: the same 1k, logged after a switch to miles.
        row(3280, "ft", 3.7, "2026-01-12", "w2"),
        row(500, "m", 1.7, "2026-01-15", "w3"),
      ],
      { distanceUnit: "km" },
    );
    expect(prs["rowing"].bestTime).toEqual({ value: 3.7, date: "2026-01-12", workoutLogId: "w2" });
  });

  it("keeps a time with no distance apart from times that have one", () => {
    const prs = calculatePersonalRecords([
      ski(1000, 4, "2026-01-05", "w1"),
      ski(1000, 3.9, "2026-01-08", "w2"),
      ski(null, 2, "2026-01-12", "w3"),
    ]);
    expect(prs["skierg"].bestTime?.value).toBe(3.9);
  });

  it("compares rep-sized timed work only at the same reps", () => {
    const balls = (reps: number, time: number, date: string, workoutLogId: string) =>
      makeSet({ exerciseName: "wall_balls", reps, time, date, workoutLogId });
    const prs = calculatePersonalRecords([
      balls(100, 5, "2026-01-05", "w1"),
      balls(100, 4.8, "2026-01-08", "w2"),
      balls(50, 2.2, "2026-01-12", "w3"),
    ]);
    expect(prs["wall_balls"].bestTime?.value).toBe(4.8);
  });

  it("still keeps the LONGEST hold, however many holds a set records", () => {
    const plank = (reps: number | null, time: number, date: string, workoutLogId: string) =>
      makeSet({ exerciseName: "plank", category: "strength", reps, time, date, workoutLogId });
    const prs = calculatePersonalRecords([
      plank(null, 1.5, "2026-01-05", "w1"),
      plank(3, 1, "2026-01-12", "w2"),
    ]);
    expect(prs["plank"].bestTime?.value).toBe(1.5);
  });
});
