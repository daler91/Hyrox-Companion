/**
 * Weekly running mileage: what counts, in what unit, and what does not.
 */

import { describe, expect, it } from "vitest";

import { calculateTrainingOverview, type DistanceSet } from "../analyticsService";
import { makeWorkoutLog } from "../trainingLoadService.testHelpers";

const MONDAY = "2026-06-01";
const WEDNESDAY = "2026-06-03";
const NEXT_MONDAY = "2026-06-08";
const PERIOD = { from: MONDAY, to: "2026-06-14" };

/**
 * A logged set, stamped in metres unless told otherwise.
 *
 * Carries `exerciseName`/`workoutLogId` beyond what `DistanceSet` needs because
 * these go in through `calculateTrainingOverview`'s set argument, which the
 * coverage and movement-pattern builders read too — the mileage rollup is only
 * one of its consumers.
 */
function set(overrides: Partial<DistanceSet> = {}): DistanceSet {
  return {
    date: MONDAY,
    category: "running",
    distance: 5000,
    distanceUnit: "m",
    weightUnit: "kg",
    exerciseName: "easy_run",
    customLabel: null,
    workoutLogId: "log-1",
    ...overrides,
  } as DistanceSet;
}

function overviewOf(sets: DistanceSet[], distanceUnit = "km") {
  return calculateTrainingOverview(
    [makeWorkoutLog({ date: MONDAY })],
    sets as never,
    undefined,
    {
      period: PERIOD,
      distanceUnit,
      trainingLoadInput: { currentDate: "2026-06-14" },
    },
  );
}

const mileageOf = (sets: DistanceSet[], distanceUnit = "km"): number =>
  overviewOf(sets, distanceUnit).currentStats.totalRunningMeters;

describe("weekly running mileage", () => {
  it("sums each week's running into the week that holds it", () => {
    const overview = overviewOf([
      set(),
      set({ date: WEDNESDAY, distance: 8000 }),
      set({ date: NEXT_MONDAY, distance: 3000 }),
    ]);

    const byWeek = new Map(overview.weeklySummaries.map((w) => [w.weekStart, w.runningMeters]));
    expect(byWeek.get(MONDAY)).toBe(13_000);
    expect(byWeek.get(NEXT_MONDAY)).toBe(3000);
    expect(overview.currentStats.totalRunningMeters).toBe(16_000);
  });

  it("counts a rest week as zero rather than omitting it", () => {
    // The chart has to be able to draw the layoff — the same reason the weekly
    // rollup zero-fills its counts (audit H7, M10).
    const overview = overviewOf([set()]);
    const second = overview.weeklySummaries.find((w) => w.weekStart === NEXT_MONDAY);
    expect(second).toBeDefined();
    expect(second?.runningMeters).toBe(0);
  });

  it("ignores every other category, so sled pushes are not mileage", () => {
    // The reason this is running-only: 4x50 m of sled push is real work and
    // emphatically not two hundred metres of running.
    expect(
      mileageOf([
        set({ category: "functional", distance: 50 }),
        set({ category: "strength", distance: 50 }),
        set({ category: "conditioning", distance: 2000 }),
      ]),
    ).toBe(0);
  });

  it("reads each set through its OWN unit stamp", () => {
    // An athlete who switched km → miles has feet-stamped history. Summing the
    // raw numbers would add feet to metres and report roughly triple.
    expect(mileageOf([set({ distance: 16_404.2, distanceUnit: "ft" })], "miles")).toBe(5000);
  });

  it("totals the same whichever unit the athlete reads in", () => {
    // Metres are canonical; conversion happens at the display edge, so the
    // stored total cannot drift with a preference change.
    expect(mileageOf([set()], "km")).toBe(mileageOf([set()], "miles"));
  });

  it("mixes stamped units in one total without losing either", () => {
    expect(mileageOf([set(), set({ distance: 16_404.2, distanceUnit: "ft" })], "km")).toBe(10_000);
  });

  it("skips sets with no distance rather than counting a zero-length run", () => {
    expect(mileageOf([set({ distance: null }), set()])).toBe(5000);
  });

  it("reports zero for an athlete who logs no running", () => {
    expect(mileageOf([])).toBe(0);
  });
});
