import { describe, expectTypeOf, it } from "vitest";

import type { MafTestMetrics } from "./maf";
import type { ExerciseSet, InsertExerciseSet, InsertWorkoutLog, WorkoutLog } from "./schema";
import { type Metres, type Minutes, minutes, type Seconds, seconds } from "./units";

/**
 * Tech debt #50: the unit brands stopped at the storage boundary. The Drizzle
 * rows and `MafTestMetrics` were plain `number`, so a seconds value assigned to
 * a minutes column compiled. These are type-level checks, enforced by
 * `pnpm check:test` in CI: they fail to compile if a brand comes off a column.
 */
describe("unit brands at the storage boundary", () => {
  it("types the minutes columns as Minutes, read and written", () => {
    expectTypeOf<WorkoutLog["duration"]>().toEqualTypeOf<Minutes | null>();
    expectTypeOf<ExerciseSet["time"]>().toEqualTypeOf<Minutes | null>();
    expectTypeOf<ExerciseSet["plannedTime"]>().toEqualTypeOf<Minutes | null>();
    expectTypeOf<InsertWorkoutLog["duration"]>().toEqualTypeOf<Minutes | null | undefined>();
    expectTypeOf<InsertExerciseSet["time"]>().toEqualTypeOf<Minutes | null | undefined>();
    expectTypeOf<InsertExerciseSet["plannedTime"]>().toEqualTypeOf<Minutes | null | undefined>();
  });

  it("types the MAF metrics in seconds and metres", () => {
    expectTypeOf<MafTestMetrics["durationSeconds"]>().toEqualTypeOf<Seconds | null>();
    expectTypeOf<MafTestMetrics["distanceMeters"]>().toEqualTypeOf<Metres | null>();
  });

  it("refuses seconds, or an untagged number, where minutes are stored", () => {
    const fortyFiveSeconds = seconds(45);
    // @ts-expect-error seconds are not minutes
    const fromSeconds: InsertExerciseSet["time"] = fortyFiveSeconds;
    // @ts-expect-error an untagged number must be tagged with its unit first
    const untagged: WorkoutLog["duration"] = 45;
    const tagged: WorkoutLog["duration"] = minutes(45);
    expectTypeOf([fromSeconds, untagged, tagged]).toBeArray();
  });
});
