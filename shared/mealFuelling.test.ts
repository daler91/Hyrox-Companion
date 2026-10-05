import { describe, expect, it } from "vitest";

import {
  applyMealTargetOverrides,
  computeMealFuelTargets,
  type MealFuelDailyTarget,
  type MealFuelTarget,
  type MealFuelTargets,
  mergeMealOverride,
  resolveEatingMeals,
} from "./mealFuelling";

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

    expect(Object.keys(targets).sort((a, b) => a.localeCompare(b))).toEqual(["breakfast", "dinner", "lunch"]);
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
    expect(Object.keys(targets).sort((a, b) => a.localeCompare(b))).toEqual(["breakfast", "dinner", "lunch", "snack"]);
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

describe("computeMealFuelTargets reconciliation transparency", () => {
  /** Generous carbs so the carb reconciliation cannot be what clamps. */
  const CARBS_TO_SPARE = 600;

  function flexMealFor(proteinG: number, fatG: number): MealFuelTargets[keyof MealFuelTargets] {
    const targets = computeMealFuelTargets({
      daily: { calories: 2600, carbG: CARBS_TO_SPARE, proteinG, fatG },
      session: AM_SESSION,
      bodyweightKg: 75,
      workoutTiming: "am_pre_breakfast",
      hasWorkout: true,
    }) as MealFuelTargets;
    return targets.snack;
  }

  it("reports the clamp when protein and fat overshoot but carbs do not", () => {
    // The session's protein floor alone exceeds this athlete's whole daily
    // target, so the flex meal is pushed below zero and clamped. Reading only
    // the carb reconciliation called that "nothing was clamped" and the meal
    // carried no explanation for a plan that no longer sums to the target.
    expect(flexMealFor(1, 1)?.reasonCodes).toContain("reconcile_clamped");
  });

  it("stays quiet when every macro reconciles cleanly", () => {
    expect(flexMealFor(180, 80)?.reasonCodes).not.toContain("reconcile_clamped");
  });
});

// C21 (CODEBASE_ANALYSIS_2026-10-03): a calorie goal with only some macros set.
// Meal calories were built from the set macros alone, so the unset ones
// allocated zero kcal and the meals summed to a fraction of the goal.
describe("computeMealFuelTargets with a calorie goal and partial macros", () => {
  const kcalSum = (targets: MealFuelTargets) =>
    Object.values(targets).reduce((s, t) => s + t.calories, 0);

  it("sums meal calories to the goal for 2,500 kcal + 150 g protein", () => {
    const targets = computeMealFuelTargets({
      daily: { calories: 2500, proteinG: 150, carbG: null, fatG: null },
      session: null,
      bodyweightKg: 75,
      workoutTiming: "none",
      hasWorkout: false,
    }) as MealFuelTargets;

    expect(kcalSum(targets)).toBe(2500);
    // Protein still splits evenly; every meal carries more than its protein kcal.
    expect(sum(targets, "proteinG")).toBeCloseTo(150, 1);
    for (const t of Object.values(targets)) expect(t.calories).toBeGreaterThan(150);
    // The bigger meals get the bigger share, as with a calorie-only target.
    expect(targets.lunch?.calories).toBeGreaterThan(targets.snack?.calories ?? 0);
  });

  it("sums to the goal on a workout day with carbs set and protein/fat unset", () => {
    const targets = computeMealFuelTargets({
      daily: { calories: 2400, proteinG: null, carbG: 300, fatG: null },
      session: AM_SESSION,
      bodyweightKg: 75,
      workoutTiming: "am_pre_breakfast",
      hasWorkout: true,
    }) as MealFuelTargets;

    expect(kcalSum(targets)).toBe(2400);
    expect(sum(targets, "carbG")).toBeCloseTo(300, 1);
    // The fasted pre slot keeps its carb-only calories.
    expect(targets.pre_workout?.calories).toBe(120);
  });

  it("keeps the macro-only calories when every macro is set", () => {
    const targets = computeMealFuelTargets({
      daily: DAILY,
      session: null,
      bodyweightKg: 75,
      workoutTiming: "none",
      hasWorkout: false,
    }) as MealFuelTargets;
    for (const t of Object.values(targets)) {
      expect(t.calories).toBe(Math.round(t.proteinG * 4 + t.carbG * 4 + t.fatG * 9));
    }
  });

  it("does not shrink meals when the set macros already exceed the calorie goal", () => {
    const targets = computeMealFuelTargets({
      daily: { calories: 1500, proteinG: 150, carbG: 300, fatG: null },
      session: null,
      bodyweightKg: 75,
      workoutTiming: "none",
      hasWorkout: false,
    }) as MealFuelTargets;
    for (const t of Object.values(targets)) {
      expect(t.calories).toBe(Math.round(t.proteinG * 4 + t.carbG * 4));
    }
  });
});

// C21 (CODEBASE_ANALYSIS_2026-10-03): an override rebuilt the meal's calories
// from its macros alone, so on a day with an unset macro the meal lost the
// calories the engine had given it for that macro.
describe("applyMealTargetOverrides with a calorie goal and partial macros", () => {
  const proteinOnly = computeMealFuelTargets({
    daily: { calories: 2500, proteinG: 150, carbG: null, fatG: null },
    session: null,
    bodyweightKg: 75,
    workoutTiming: "none",
    hasWorkout: false,
  }) as MealFuelTargets;

  it("keeps lunch's share when only its protein is pinned (2,500 kcal + 150 g protein)", () => {
    expect(proteinOnly.lunch).toMatchObject({ calories: 720, proteinG: 37.5, carbG: 0, fatG: 0 });

    const merged = applyMealTargetOverrides(proteinOnly, { lunch: { proteinG: 50 } });

    // 720 kcal plus the 12.5 g of extra protein, not the 200 kcal in 50 g alone.
    expect(merged.lunch?.calories).toBe(770);
    expect(merged.lunch?.proteinG).toBe(50);
  });

  it("keeps the calories the old editor echoed beside 0 g unset macros", () => {
    // Its full payload: 0 g carbs and fat are the split's own 0 g, not
    // figures, so the echoed 720 kcal stands as a pinned figure.
    const merged = applyMealTargetOverrides(proteinOnly, {
      lunch: { calories: 720, proteinG: 50, carbG: 0, fatG: 0 },
    });
    expect(merged.lunch).toMatchObject({ calories: 720, proteinG: 50, carbG: 0, fatG: 0 });
  });

  it("draws a pinned unset macro from the share instead of counting it twice", () => {
    // 80 g carbs is 320 kcal of the 570 kcal the protein left unaccounted.
    const carbs = applyMealTargetOverrides(proteinOnly, { lunch: { carbG: 80 } });
    expect(carbs.lunch?.calories).toBe(720);
    // Past the share, the macros themselves set the figure: 160 g carbs is
    // 640 kcal, more than the 570 the share holds, with fat still at 0 g.
    const more = applyMealTargetOverrides(proteinOnly, { lunch: { carbG: 160 } });
    expect(more.lunch?.calories).toBe(150 + 640);
  });

  // C21 (CODEBASE_ANALYSIS_2026-10-03): once every macro has a figure the
  // share has no macro left to stand for, so the macros are the meal's energy.
  // Keeping the unfilled 70 kcal read 720 beside 650 kcal of macros.
  it("drops the share once every macro has a figure", () => {
    const merged = applyMealTargetOverrides(proteinOnly, { lunch: { carbG: 80, fatG: 20 } });
    expect(merged.lunch).toMatchObject({ calories: 150 + 320 + 180, proteinG: 37.5 });
  });

  it("keeps a calorie-only meal's calories when a macro is pinned", () => {
    const calorieOnly = computeMealFuelTargets({
      daily: { calories: 2500, proteinG: null, carbG: null, fatG: null },
      session: null,
      bodyweightKg: 75,
      workoutTiming: "none",
      hasWorkout: false,
    }) as MealFuelTargets;
    const lunchKcal = calorieOnly.lunch?.calories ?? 0;
    expect(lunchKcal).toBeGreaterThan(120);

    const merged = applyMealTargetOverrides(calorieOnly, { lunch: { proteinG: 30 } });

    expect(merged.lunch?.calories).toBe(lunchKcal);
  });
});

// C21 (CODEBASE_ANALYSIS_2026-10-03): the meal editor echoed every shown value
// back, so a calorie edit arrived with the meal's macros alongside it (0 g on
// a calorie-only day). Those counted as macro overrides, and the calories were
// rebuilt from the macros, dropping the athlete's number.
describe("applyMealTargetOverrides calorie edits", () => {
  const restDay = (daily: MealFuelDailyTarget) =>
    computeMealFuelTargets({
      daily,
      session: null,
      bodyweightKg: 75,
      workoutTiming: "none",
      hasWorkout: false,
    }) as MealFuelTargets;
  const calorieOnly = restDay({ calories: 2500, proteinG: null, carbG: null, fatG: null });
  const proteinOnly = restDay({ calories: 2500, proteinG: 150, carbG: null, fatG: null });

  it("honours a calorie edit on a calorie-only day when the macros are echoed as 0", () => {
    expect(calorieOnly.lunch).toMatchObject({ calories: 750, proteinG: 0, carbG: 0, fatG: 0 });

    const merged = applyMealTargetOverrides(calorieOnly, {
      lunch: { calories: 800, proteinG: 0, carbG: 0, fatG: 0 },
    });

    expect(merged.lunch).toMatchObject({ calories: 800, proteinG: 0, carbG: 0, fatG: 0 });
  });

  it("honours a calorie edit on a protein-only day when the macros are echoed", () => {
    const merged = applyMealTargetOverrides(proteinOnly, {
      lunch: { calories: 900, proteinG: 37.5, carbG: 0, fatG: 0 },
    });

    expect(merged.lunch).toMatchObject({ calories: 900, proteinG: 37.5, carbG: 0, fatG: 0 });
  });

  it("honours the calories-only payload the editor now sends", () => {
    const merged = applyMealTargetOverrides(calorieOnly, {
      lunch: { calories: 800, proteinG: null, carbG: null, fatG: null },
    });
    expect(merged.lunch?.calories).toBe(800);
  });

  it("lets pinned calories win over partly pinned macros, keeping both as set", () => {
    const merged = applyMealTargetOverrides(proteinOnly, { lunch: { calories: 900, proteinG: 50 } });
    // Not the 770 kcal the protein pin alone would give (720 plus 12.5 g protein).
    expect(merged.lunch).toMatchObject({ calories: 900, proteinG: 50, carbG: 0, fatG: 0 });

    const full = restDay(DAILY);
    const lowered = applyMealTargetOverrides(full, { dinner: { calories: 500, carbG: 100 } });
    expect(lowered.dinner).toMatchObject({ calories: 500, carbG: 100, proteinG: full.dinner?.proteinG });
  });

  it("keeps pinned calories as set on every day, even when they match the split", () => {
    const middayWorkout = computeMealFuelTargets({
      daily: { calories: 2500, proteinG: 150, carbG: null, fatG: null },
      session: { preCarbG: 60, postCarbG: 75, postProteinG: 30 },
      bodyweightKg: 75,
      workoutTiming: "midday",
      hasWorkout: true,
    }) as MealFuelTargets;
    expect(middayWorkout.lunch?.calories).not.toBe(720);
    // The suggested 720 kcal typed in beside 50 g protein: the same 720 on the
    // day it was saved and on a day whose split differs.
    const pin = { lunch: { calories: 720, proteinG: 50 } };

    expect(applyMealTargetOverrides(proteinOnly, pin).lunch?.calories).toBe(720);
    expect(applyMealTargetOverrides(middayWorkout, pin).lunch?.calories).toBe(720);
  });

  // The old editor saved all four shown values, so every stored row carries a
  // calorie figure beside its macros, and a row applies on later days too.
  it("lets a full macro set with an edit rule over the calories saved beside it", () => {
    const rest = restDay(DAILY);
    const middayWorkout = computeMealFuelTargets({
      daily: DAILY,
      session: { preCarbG: 60, postCarbG: 75, postProteinG: 30 },
      bodyweightKg: 75,
      workoutTiming: "midday",
      hasWorkout: true,
    }) as MealFuelTargets;
    expect(rest.lunch).toMatchObject({ calories: 780, proteinG: 45, carbG: 96, fatG: 24 });
    expect(middayWorkout.lunch?.calories).not.toBe(780);
    // Protein raised 45 -> 60 in the old editor, the shown 780 kcal echoed.
    const legacyRow = { lunch: { calories: 780, proteinG: 60, carbG: 96, fatG: 24 } };
    const macroKcal = 60 * 4 + 96 * 4 + 24 * 9;

    expect(applyMealTargetOverrides(rest, legacyRow).lunch?.calories).toBe(macroKcal);
    // Not the echoed 780, which the meal's own pinned macros contradict.
    expect(applyMealTargetOverrides(middayWorkout, legacyRow).lunch).toMatchObject({
      calories: macroKcal,
      proteinG: 60,
      carbG: 96,
      fatG: 24,
    });
  });

  // C21 (CODEBASE_ANALYSIS_2026-10-03): on a day that leaves macros unset, a
  // full set kept the meal's unset-macro share beside macros that could not
  // carry it: lunch pinned to 50/80/20 g read 770 kcal while its macros add up
  // to 700, whatever the calorie field said.
  it("makes a full macro set on a partial-macro day exactly its macros", () => {
    const pinned = { proteinG: 50, carbG: 80, fatG: 20 };
    const macroKcal = 50 * 4 + 80 * 4 + 20 * 9;

    expect(applyMealTargetOverrides(proteinOnly, { lunch: pinned }).lunch?.calories).toBe(macroKcal);
    const typed = applyMealTargetOverrides(proteinOnly, { lunch: { calories: 900, ...pinned } });
    expect(typed.lunch?.calories).toBe(macroKcal);
  });

  it("keeps pinned calories beside a set whose 0 g macros echo the split", () => {
    // 0 g carbs and fat are the split's own 0 g, not figures: the 900 stands.
    const proteinRaised = applyMealTargetOverrides(proteinOnly, {
      lunch: { calories: 900, proteinG: 50, carbG: 0, fatG: 0 },
    });
    expect(proteinRaised.lunch?.calories).toBe(900);
    // A row the old editor saved on a calorie-only day, then given 40 g
    // protein: its 800 kcal used to fall back to the split's 750.
    const legacy = applyMealTargetOverrides(calorieOnly, {
      lunch: { calories: 800, proteinG: 40, carbG: 0, fatG: 0 },
    });
    expect(legacy.lunch).toMatchObject({ calories: 800, proteinG: 40 });
  });

  // C21 (CODEBASE_ANALYSIS_2026-10-03): a 0 g pin is read as an echo only
  // while the meal holds a share of a calorie goal; with none to keep, the
  // split's calories are its macros' energy and the pin is a figure.
  it("counts 0 g pins as figures when the meal holds no calorie-goal share", () => {
    const pin = { calories: 900, proteinG: 50, carbG: 0, fatG: 0 };
    const noCalorieGoal = restDay({ calories: null, proteinG: 160, carbG: null, fatG: null });
    expect(noCalorieGoal.lunch).toMatchObject({ calories: 160, proteinG: 40, carbG: 0, fatG: 0 });
    expect(mergeMealOverride(noCalorieGoal.lunch as MealFuelTarget, pin)).toMatchObject({
      calories: 200,
      caloriesFromMacros: true,
    });
    // Set macros that already reach the calorie goal leave no share either.
    const goalReached = restDay({ calories: 500, proteinG: 150, carbG: null, fatG: null });
    expect(goalReached.lunch?.calories).toBe(150);
    expect(applyMealTargetOverrides(goalReached, { lunch: pin }).lunch?.calories).toBe(200);
    // Nor does a slot the calorie split skips: the fasted pre-workout snack is
    // its carbs alone, even on a calorie-goal day.
    const fasted = computeMealFuelTargets({
      daily: { calories: 2500, proteinG: 150, carbG: null, fatG: null },
      session: { preCarbG: 30, postCarbG: 60, postProteinG: 25 },
      bodyweightKg: 75,
      workoutTiming: "am_pre_breakfast",
      hasWorkout: true,
    }) as MealFuelTargets;
    expect(fasted.pre_workout).toMatchObject({ calories: 120, proteinG: 0, carbG: 30, fatG: 0 });
    expect(
      mergeMealOverride(fasted.pre_workout as MealFuelTarget, { calories: 300, proteinG: 10, carbG: 40, fatG: 0 }),
    ).toMatchObject({ calories: 200, caloriesFromMacros: true });
  });

  it("flags the calories the pinned macros set, which the editor shows locked", () => {
    const lunch = proteinOnly.lunch as MealFuelTarget;

    expect(mergeMealOverride(lunch, { calories: 900, proteinG: 50, carbG: 80, fatG: 20 })).toEqual({
      calories: 700,
      proteinG: 50,
      carbG: 80,
      fatG: 20,
      caloriesFromMacros: true,
    });
    // A partial pin, or 0 g echoes of the split, leave the calories open.
    expect(mergeMealOverride(lunch, { proteinG: 50 })).toMatchObject({ calories: 770, caloriesFromMacros: false });
    expect(mergeMealOverride(lunch, { calories: 900, proteinG: 50, carbG: 0, fatG: 0 }).caloriesFromMacros).toBe(false);
    // A full set that matches the split edits nothing, so pinned calories stand.
    const rest = restDay(DAILY).lunch as MealFuelTarget;
    expect(mergeMealOverride(rest, { calories: 800, proteinG: 45, carbG: 96, fatG: 24 })).toMatchObject({
      calories: 800,
      caloriesFromMacros: false,
    });
  });

  it("carries the stored override and the split it replaced, for the editor", () => {
    const merged = applyMealTargetOverrides(proteinOnly, { lunch: { proteinG: 50 } });

    expect(merged.lunch?.override).toEqual({ calories: null, proteinG: 50, carbG: null, fatG: null });
    expect(merged.lunch?.suggested).toEqual({ calories: 720, proteinG: 37.5, carbG: 0, fatG: 0 });
    expect(merged.dinner?.override).toBeUndefined();
    expect(merged.dinner?.suggested).toBeUndefined();
  });
});
