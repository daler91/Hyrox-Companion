import { describe, expect, it } from "vitest";

import { computeMealFuelTargets, type MealFuelTargets } from "./mealFuelling";

// A typical morning session for a 75kg athlete (matches sessionFuellingTargets):
// computeSessionFuellingTarget({ durationMin: 60, rpe: 6, bodyweightKg: 75 }).
const AM_SESSION = { preCarbG: 30, postCarbG: 53, postProteinG: 23 };
const DAILY = { calories: 2600, proteinG: 180, carbG: 320, fatG: 80 };

function sum(targets: MealFuelTargets, key: "carbG" | "proteinG" | "fatG"): number {
  return Math.round(Object.values(targets).reduce((s, t) => s + (t?.[key] ?? 0), 0) * 10) / 10;
}

describe("computeMealFuelTargets", () => {
  it("reconciles each macro to the daily target on a morning-workout day", () => {
    const t = computeMealFuelTargets({
      daily: DAILY,
      session: AM_SESSION,
      bodyweightKg: 75,
      workoutTiming: "am_pre_breakfast",
      hasWorkout: true,
    });
    expect(t).not.toBeNull();
    const targets = t as MealFuelTargets;
    expect(sum(targets, "carbG")).toBeCloseTo(DAILY.carbG, 1);
    expect(sum(targets, "proteinG")).toBeCloseTo(DAILY.proteinG, 1);
    expect(sum(targets, "fatG")).toBeCloseTo(DAILY.fatG, 1);
  });

  it("places the session anchors: pre_workout fast carbs + breakfast as recovery", () => {
    const targets = computeMealFuelTargets({
      daily: DAILY,
      session: AM_SESSION,
      bodyweightKg: 75,
      workoutTiming: "am_pre_breakfast",
      hasWorkout: true,
    }) as MealFuelTargets;

    expect(targets.pre_workout).toMatchObject({
      role: "pre_workout_fast_carbs",
      carbG: 30,
      proteinG: 0,
      fatG: 0,
    });
    expect(targets.breakfast?.role).toBe("post_workout_recovery");
    expect(targets.breakfast?.carbG).toBe(53); // post-carb floor
    expect(targets.breakfast?.proteinG).toBeGreaterThanOrEqual(AM_SESSION.postProteinG);
    expect(targets.snack?.role).toBe("flex_remainder");
    // The literal post_workout slot stays inactive under the AM assumption.
    expect(targets.post_workout).toBeUndefined();
  });

  it("omits the pre_workout slot for a short, easy session (no pre-fuelling)", () => {
    const targets = computeMealFuelTargets({
      daily: DAILY,
      session: { preCarbG: 0, postCarbG: 16, postProteinG: 23 },
      bodyweightKg: 75,
      workoutTiming: "am_pre_breakfast",
      hasWorkout: true,
    }) as MealFuelTargets;
    expect(targets.pre_workout).toBeUndefined();
    expect(targets.breakfast?.role).toBe("post_workout_recovery");
    expect(targets.breakfast?.carbG).toBe(16);
  });

  it("on a rest day: no pre/post slots, an even-ish split that still reconciles", () => {
    const targets = computeMealFuelTargets({
      daily: { calories: 2200, proteinG: 165, carbG: 250, fatG: 70 },
      session: null,
      bodyweightKg: 75,
      workoutTiming: "none",
      hasWorkout: false,
    }) as MealFuelTargets;

    expect(targets.pre_workout).toBeUndefined();
    expect(targets.breakfast?.role).toBe("standard");
    expect(targets.breakfast?.reasonCodes).toContain("rest_day_even");
    expect(sum(targets, "carbG")).toBeCloseTo(250, 1);
    expect(sum(targets, "proteinG")).toBeCloseTo(165, 1);
    expect(sum(targets, "fatG")).toBeCloseTo(70, 1);
  });

  it("uses bodyweight-free fallbacks when bodyweight is missing", () => {
    const targets = computeMealFuelTargets({
      daily: { calories: null, proteinG: null, carbG: 300, fatG: null },
      session: { preCarbG: 30, postCarbG: 60, postProteinG: 25 },
      bodyweightKg: null,
      workoutTiming: "am_pre_breakfast",
      hasWorkout: true,
    }) as MealFuelTargets;
    // Only carbs are targeted; protein/fat fall back without a daily goal.
    expect(sum(targets, "carbG")).toBeCloseTo(300, 1);
    expect(targets.breakfast?.proteinG).toBeGreaterThanOrEqual(25);
    for (const t of Object.values(targets))
      expect(t?.reasonCodes).toContain("no_bodyweight_defaults");
  });

  it("returns null when no daily target is set", () => {
    expect(
      computeMealFuelTargets({
        daily: { calories: null, proteinG: null, carbG: null, fatG: null },
        session: AM_SESSION,
        bodyweightKg: 75,
        workoutTiming: "am_pre_breakfast",
        hasWorkout: true,
      }),
    ).toBeNull();
  });

  it("honours the session anchors when they exceed a low daily carb target", () => {
    const targets = computeMealFuelTargets({
      daily: { calories: 1800, proteinG: 150, carbG: 60, fatG: 70 },
      session: AM_SESSION, // pre 30 + post 53 = 83 > 60
      bodyweightKg: 75,
      workoutTiming: "am_pre_breakfast",
      hasWorkout: true,
    }) as MealFuelTargets;
    expect(targets.pre_workout?.carbG).toBe(30);
    expect(targets.breakfast?.carbG).toBe(53);
    expect(targets.breakfast?.reasonCodes).toContain("carbs_anchor_exceeds_daily");
    // Anchors win: the day's carb total is allowed to exceed the (low) target.
    expect(sum(targets, "carbG")).toBeGreaterThanOrEqual(60);
  });

  it("handles a calorie-only target (no macros) by splitting kcal", () => {
    const targets = computeMealFuelTargets({
      daily: { calories: 2000, proteinG: null, carbG: null, fatG: null },
      session: null,
      bodyweightKg: 75,
      workoutTiming: "none",
      hasWorkout: false,
    }) as MealFuelTargets;
    const kcal = Object.values(targets).reduce((s, t) => s + (t?.calories ?? 0), 0);
    expect(kcal).toBeCloseTo(2000, 0);
    for (const t of Object.values(targets)) expect(t?.reasonCodes).toContain("calorie_only_target");
  });
});
