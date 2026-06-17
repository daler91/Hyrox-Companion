import { describe, expect, it } from "vitest";

import { applyMealTargetOverrides, computeMealFuelTargets, type MealFuelTargets, resolveEatingMeals } from "./mealFuelling";

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

  it("places recovery on lunch for a midday session and carb-loads breakfast", () => {
    const targets = computeMealFuelTargets({
      daily: DAILY,
      session: AM_SESSION,
      bodyweightKg: 75,
      workoutTiming: "midday",
      hasWorkout: true,
    }) as MealFuelTargets;

    expect(targets.pre_workout).toBeUndefined(); // no fasted pre slot at midday
    expect(targets.lunch?.role).toBe("post_workout_recovery");
    expect(targets.lunch?.carbG).toBe(53); // post-carb floor lands on lunch
    expect(targets.breakfast?.reasonCodes).toContain("pre_session_carbs");
    expect(sum(targets, "carbG")).toBeCloseTo(DAILY.carbG, 1);
    expect(sum(targets, "proteinG")).toBeCloseTo(DAILY.proteinG, 1);
    expect(sum(targets, "fatG")).toBeCloseTo(DAILY.fatG, 1);
  });

  it("places recovery on dinner for an evening session and carb-loads lunch", () => {
    const targets = computeMealFuelTargets({
      daily: DAILY,
      session: AM_SESSION,
      bodyweightKg: 75,
      workoutTiming: "evening",
      hasWorkout: true,
    }) as MealFuelTargets;

    expect(targets.dinner?.role).toBe("post_workout_recovery");
    expect(targets.dinner?.carbG).toBe(53);
    expect(targets.lunch?.reasonCodes).toContain("pre_session_carbs");
    expect(targets.breakfast?.role).toBe("standard");
    expect(sum(targets, "carbG")).toBeCloseTo(DAILY.carbG, 1);
    expect(sum(targets, "proteinG")).toBeCloseTo(DAILY.proteinG, 1);
    expect(sum(targets, "fatG")).toBeCloseTo(DAILY.fatG, 1);
  });
});

describe("meal schedule presets (3/4/5)", () => {
  it("3 meals: drops the snack(s) and reconciles onto dinner as the flex meal", () => {
    const targets = computeMealFuelTargets({
      daily: { calories: 2200, proteinG: 165, carbG: 250, fatG: 70 },
      session: null,
      bodyweightKg: 75,
      workoutTiming: "none",
      hasWorkout: false,
      mealSchedule: 3,
    }) as MealFuelTargets;

    expect(Object.keys(targets).sort()).toEqual(["breakfast", "dinner", "lunch"]);
    expect(targets.snack).toBeUndefined();
    expect(targets.snack_pm).toBeUndefined();
    expect(targets.dinner?.role).toBe("flex_remainder");
    expect(sum(targets, "carbG")).toBeCloseTo(250, 1);
    expect(sum(targets, "proteinG")).toBeCloseTo(165, 1);
    expect(sum(targets, "fatG")).toBeCloseTo(70, 1);
  });

  it("5 meals: adds an afternoon snack as the flex meal and still reconciles", () => {
    const targets = computeMealFuelTargets({
      daily: DAILY,
      session: null,
      bodyweightKg: 75,
      workoutTiming: "none",
      hasWorkout: false,
      mealSchedule: 5,
    }) as MealFuelTargets;

    expect(Object.keys(targets)).toHaveLength(5);
    expect(targets.snack_pm?.role).toBe("flex_remainder");
    expect(sum(targets, "carbG")).toBeCloseTo(DAILY.carbG, 1);
    expect(sum(targets, "proteinG")).toBeCloseTo(DAILY.proteinG, 1);
    expect(sum(targets, "fatG")).toBeCloseTo(DAILY.fatG, 1);
  });

  it("defaults to the 4-meal split when mealSchedule is omitted", () => {
    const targets = computeMealFuelTargets({
      daily: DAILY,
      session: null,
      bodyweightKg: 75,
      workoutTiming: "none",
      hasWorkout: false,
    }) as MealFuelTargets;
    expect(Object.keys(targets).sort()).toEqual(["breakfast", "dinner", "lunch", "snack"]);
    expect(targets.snack_pm).toBeUndefined();
  });

  it("3-meal evening workout: recovery on dinner wins over the flex role", () => {
    const targets = computeMealFuelTargets({
      daily: DAILY,
      session: AM_SESSION,
      bodyweightKg: 75,
      workoutTiming: "evening",
      hasWorkout: true,
      mealSchedule: 3,
    }) as MealFuelTargets;
    expect(targets.dinner?.role).toBe("post_workout_recovery");
    expect(targets.dinner?.carbG).toBe(53);
    expect(sum(targets, "carbG")).toBeCloseTo(DAILY.carbG, 1);
  });

  it("resolveEatingMeals maps each count to its ordered meal list", () => {
    expect(resolveEatingMeals(3)).toEqual(["breakfast", "lunch", "dinner"]);
    expect(resolveEatingMeals(4)).toEqual(["breakfast", "lunch", "dinner", "snack"]);
    expect(resolveEatingMeals(5)).toEqual(["breakfast", "lunch", "dinner", "snack", "snack_pm"]);
  });
});

describe("applyMealTargetOverrides", () => {
  const base = computeMealFuelTargets({
    daily: DAILY,
    session: null,
    bodyweightKg: 75,
    workoutTiming: "none",
    hasWorkout: false,
  }) as MealFuelTargets;

  it("pins overridden macros, recomputes calories, and flags user_override", () => {
    const merged = applyMealTargetOverrides(base, { dinner: { carbG: 999 } });
    expect(merged.dinner?.carbG).toBe(999);
    expect(merged.dinner?.calories).toBe(
      Math.round(
        (merged.dinner?.proteinG ?? 0) * 4 + (merged.dinner?.carbG ?? 0) * 4 + (merged.dinner?.fatG ?? 0) * 9,
      ),
    );
    expect(merged.dinner?.reasonCodes).toContain("user_override");
    // Untouched meals keep their original (reference-equal) target.
    expect(merged.breakfast).toBe(base.breakfast);
  });

  it("honours an explicit calorie-only override without touching macros", () => {
    const merged = applyMealTargetOverrides(base, { lunch: { calories: 700 } });
    expect(merged.lunch?.calories).toBe(700);
    expect(merged.lunch?.carbG).toBe(base.lunch?.carbG);
  });

  it("ignores overrides for meals that aren't active that day", () => {
    const merged = applyMealTargetOverrides(base, { snack_pm: { carbG: 50 } });
    expect(merged.snack_pm).toBeUndefined();
  });

  it("treats an all-null override as a no-op", () => {
    const merged = applyMealTargetOverrides(base, {
      dinner: { calories: null, carbG: null, proteinG: null, fatG: null },
    });
    expect(merged.dinner).toBe(base.dinner);
  });
});
