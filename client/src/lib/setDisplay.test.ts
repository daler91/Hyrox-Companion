import { describe, expect, it } from "vitest";

import { makeExerciseSet } from "@/test/factories/exerciseSetFactory";

import { toPreferenceScale, toPreferenceScaleAll } from "./setDisplay";

// The same athletes as the shared stamp matrix (shared/unitConversion.test.ts).
const KG_ATHLETE = { weightUnit: "kg", distanceUnit: "km" };
const LB_ATHLETE = { weightUnit: "lbs", distanceUnit: "miles" };

describe("toPreferenceScale", () => {
  it("returns the very same row when it is already stamped in the athlete's units", () => {
    const set = makeExerciseSet({ weight: 100, plannedWeight: 90, weightUnit: "kg", distance: 400, distanceUnit: "m" });

    expect(toPreferenceScale(set, KG_ATHLETE)).toBe(set);
  });

  it("converts a row written in the other unit and re-stamps it (finding D2)", () => {
    // 100 kg logged, athlete now prefers lb: the number must read 220, not 100.
    const set = makeExerciseSet({ weight: 100, plannedWeight: 90, weightUnit: "kg" });

    const scaled = toPreferenceScale(set, LB_ATHLETE);

    expect(scaled).toMatchObject({ weight: 220, plannedWeight: 198, weightUnit: "lbs" });
    expect(set.weight).toBe(100);
  });

  it("converts the distance axis the same way, in the stored unit of the new preference", () => {
    // A miles athlete stores feet: 1312 ft is a 400 m row.
    const set = makeExerciseSet({ distance: 1312, plannedDistance: 3281, distanceUnit: "ft" });

    const scaled = toPreferenceScale(set, KG_ATHLETE);

    expect(scaled).toMatchObject({ distance: 400, plannedDistance: 1000, distanceUnit: "m" });
  });

  it("scales the two axes independently", () => {
    const set = makeExerciseSet({ weight: 100, weightUnit: "kg", distance: 5000, distanceUnit: "m" });

    const scaled = toPreferenceScale(set, LB_ATHLETE);

    expect(scaled).toMatchObject({ weight: 220, weightUnit: "lbs", distance: 16404, distanceUnit: "ft" });
  });

  it("leaves a legacy row's values exactly as they are and gives it the current stamp", () => {
    // Unstamped rows read as the current preference, as every read path did
    // before L4. Nothing to convert; the copy only records what unit that is.
    const set = makeExerciseSet({ weight: 100, plannedWeight: 90, distance: 400, plannedDistance: 500 });

    const scaled = toPreferenceScale(set, LB_ATHLETE);

    expect(scaled).toMatchObject({
      weight: 100,
      plannedWeight: 90,
      distance: 400,
      plannedDistance: 500,
      weightUnit: "lbs",
      distanceUnit: "ft",
    });
    expect(scaled).not.toBe(set);
  });

  it("keeps null values null on both axes", () => {
    const set = makeExerciseSet({ weight: null, plannedWeight: null, distance: null, plannedDistance: null, weightUnit: "kg", distanceUnit: "m" });

    const scaled = toPreferenceScale(set, LB_ATHLETE);

    expect(scaled).toMatchObject({ weight: null, plannedWeight: null, distance: null, plannedDistance: null });
  });

  it("is a no-op when applied to its own output", () => {
    const scaled = toPreferenceScale(makeExerciseSet({ weight: 100, weightUnit: "kg" }), LB_ATHLETE);

    expect(toPreferenceScale(scaled, LB_ATHLETE)).toBe(scaled);
  });

  it("does not drop the fields it does not touch", () => {
    const set = makeExerciseSet({ id: "s-9", reps: 5, time: 12, notes: "hard", weight: 100, weightUnit: "kg" });

    expect(toPreferenceScale(set, LB_ATHLETE)).toMatchObject({ id: "s-9", reps: 5, time: 12, notes: "hard" });
  });
});

describe("toPreferenceScaleAll", () => {
  it("returns the same array when no row needed converting", () => {
    const sets = [makeExerciseSet({ weightUnit: "kg", distanceUnit: "m" })];

    expect(toPreferenceScaleAll(sets, KG_ATHLETE)).toBe(sets);
  });

  it("converts only the rows that need it and keeps the others by reference", () => {
    const stampedInLb = makeExerciseSet({ id: "a", weight: 225, weightUnit: "lbs", distanceUnit: "ft" });
    const stampedInKg = makeExerciseSet({ id: "b", weight: 100, weightUnit: "kg", distanceUnit: "m" });

    const scaled = toPreferenceScaleAll([stampedInLb, stampedInKg], LB_ATHLETE);

    expect(scaled[0]).toBe(stampedInLb);
    expect(scaled[1]).toMatchObject({ id: "b", weight: 220, weightUnit: "lbs" });
  });
});
