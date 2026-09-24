import { describe, expect, it } from "vitest";

import { buildTrainingTargets } from "./trainingTargets";

const lift = (exerciseName: string, date: string, weight: number, reps = 5) => ({
  exerciseName,
  workoutLogId: `${exerciseName}-${date}`,
  date,
  reps,
  weight,
  weightUnit: "kg",
});

describe("buildTrainingTargets", () => {
  const sets = [
    lift("bench_press", "2026-09-01", 70),
    lift("bench_press", "2026-09-08", 70),
    lift("bench_press", "2026-09-15", 70),
    lift("front_squat", "2026-09-02", 85),
    lift("front_squat", "2026-09-09", 85),
  ];

  it("lists the plan's primary lifts first, with RPE-8 working loads", () => {
    const targets = buildTrainingTargets({
      sets,
      logs: [],
      weightUnit: "kg",
      distanceUnit: "km",
      priority: ["front_squat"],
    });
    expect(targets?.lifts.map((entry) => entry.exercise)).toEqual(["front_squat", "bench_press"]);
    // 85 x 5 with two in reserve → e1RM 104.8; 5 @ RPE 8 is its 7-rep load.
    expect(targets?.lifts[0]).toMatchObject({ e1rm: 104.8, fiveAtRpe8: 85, eightAtRpe8: 77.5 });
    expect(targets?.paces).toBeNull();
  });

  it("orders by evidence without a priority, and fits run paces when there are runs", () => {
    const targets = buildTrainingTargets({
      sets,
      logs: [
        { id: "r1", date: "2026-09-04", focus: "Run", distanceMeters: 5000, duration: 25 },
        { id: "r2", date: "2026-09-11", focus: "Run", distanceMeters: 8000, duration: 45 },
      ],
      weightUnit: "kg",
      distanceUnit: "km",
    });
    expect(targets?.lifts[0]?.exercise).toBe("bench_press");
    expect(targets?.paces?.basis.date).toBe("2026-09-04");
  });

  it("is null with nothing to report", () => {
    expect(
      buildTrainingTargets({ sets: [], logs: [], weightUnit: "kg", distanceUnit: "km" }),
    ).toBeNull();
  });
});
