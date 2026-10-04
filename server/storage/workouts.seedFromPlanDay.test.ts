import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({
  db: { transaction: vi.fn() },
}));

import { db } from "../db";
import { makeExerciseSet } from "../services/ai/testFixtures";
import { WorkoutStorage } from "./workouts";

/**
 * A Drizzle query-builder stand-in: every chained call returns the builder,
 * and awaiting it yields the next queued result.
 */
function queryResult(rows: unknown) {
  const builder: Record<string, unknown> = {};
  for (const method of ["from", "where", "for", "limit", "innerJoin", "orderBy"]) {
    builder[method] = () => builder;
  }
  builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(rows).then(resolve, reject);
  return builder;
}

function runSeedTransaction(selectResults: unknown[][]) {
  const values = vi.fn().mockResolvedValue(undefined);
  const tx = {
    select: vi.fn(() => queryResult(selectResults.shift() ?? [])),
    insert: vi.fn(() => ({ values })),
  };
  vi.mocked(db.transaction).mockImplementation(((callback: (t: typeof tx) => unknown) =>
    callback(tx)) as never); // NOSONAR partial Drizzle transaction mock
  return { values };
}

describe("WorkoutStorage.seedExerciseSetsFromPlanDay unit stamps (D21, CODEBASE_ANALYSIS_2026-10-03)", () => {
  const storage = new WorkoutStorage();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps the prescription's stamp and stamps legacy rows with the athlete's current units", async () => {
    // The seed copied plan-day rows without their stamp, so a kg prescription
    // seeded for an athlete who had since switched to lbs read 2.2x light.
    const { values } = runSeedTransaction([
      [{ id: "log-1", planDayId: "pd-1" }], // locked parent workout
      [{ id: "pd-1" }], // plan day owned by this athlete
      [], // the workout has no sets yet
      [
        makeExerciseSet({ id: "p1", planDayId: "pd-1", workoutLogId: null, weight: 100, weightUnit: "kg", distanceUnit: "m" }),
        makeExerciseSet({ id: "p2", planDayId: "pd-1", workoutLogId: null, weight: 60, weightUnit: null, distanceUnit: null }),
      ],
      [{ weightUnit: "lbs", distanceUnit: "miles" }], // the athlete's preferences
    ]);

    expect(await storage.seedExerciseSetsFromPlanDay("log-1", "user-1")).toBe(2);

    expect(values).toHaveBeenCalledWith([
      expect.objectContaining({ workoutLogId: "log-1", weight: 100, weightUnit: "kg", distanceUnit: "m" }),
      expect.objectContaining({ workoutLogId: "log-1", weight: 60, weightUnit: "lbs", distanceUnit: "ft" }),
    ]);
  });

  it("does not read preferences when there is nothing to copy", async () => {
    const { values } = runSeedTransaction([[{ id: "log-1", planDayId: "pd-1" }], [{ id: "pd-1" }], [], []]);

    expect(await storage.seedExerciseSetsFromPlanDay("log-1", "user-1")).toBe(0);
    expect(values).not.toHaveBeenCalled();
  });
});
