/**
 * Per-meal fuel targets — the nutrition↔training USP. Distributes the day's
 * (load-adjusted) daily target across the day's meals, placing the session's
 * pre/post fuelling anchors first so carbs land when the athlete needs them.
 *
 * The session's local time-of-day drives WHICH meals are the pre/recovery meals
 * (`workoutTiming`):
 *   - `am_pre_breakfast` — a dedicated `pre_workout` slot gets light fast carbs
 *     and BREAKFAST is the post-workout recovery meal.
 *   - `midday` — BREAKFAST carb-loads before the session and LUNCH is recovery.
 *   - `evening` — LUNCH carb-loads before the session and DINNER is recovery.
 *   - `none` — rest day: an even, lower-carb split.
 * The recovery meal carries the post carb + protein floors from the session
 * target; fat is kept low there (lean recovery) and off the pre slot.
 *
 * How many eating meals the day is split across is per-user configurable
 * (`mealSchedule`: 3/4/5); the workout pre slot is layered on top per timing.
 *
 * Browser-safe and DB-free, mirroring shared/sessionFuellingTargets.ts: typed
 * Input/Result shapes, `reasonCodes` + `rationale` for transparency, no I/O.
 * The numbers are coaching guidance (the daily target split, with the session
 * anchors placed first) — not prescriptions.
 */
import type { MealType } from "./schema/tables";

export type WorkoutTiming = "am_pre_breakfast" | "midday" | "evening" | "none";

export type MealRole =
  | "pre_workout_fast_carbs"
  | "post_workout_recovery"
  | "standard"
  | "flex_remainder";

export interface MealFuelTarget {
  calories: number;
  carbG: number;
  proteinG: number;
  fatG: number;
  role: MealRole;
  reasonCodes: string[];
  /** One short coaching line, in the voice of sessionFuellingTargets. */
  rationale: string;
}

/** The day's effective target (post load-periodisation); any field may be null. */
export interface MealFuelDailyTarget {
  calories: number | null;
  proteinG: number | null;
  carbG: number | null;
  fatG: number | null;
}

/** The day's session fuelling anchors, straight from computeSessionFuellingTarget. */
export interface MealFuelSessionAnchor {
  preCarbG: number;
  postCarbG: number;
  postProteinG: number;
}

/** How many eating meals per day the daily target is split across. */
export type MealScheduleCount = 3 | 4 | 5;

/** The default (and pre-feature) split: breakfast / lunch / dinner / snack. */
export const DEFAULT_MEAL_SCHEDULE: MealScheduleCount = 4;

export interface MealFuelInput {
  daily: MealFuelDailyTarget;
  /** The primary workout's session anchors, or null on a rest day. */
  session: MealFuelSessionAnchor | null;
  bodyweightKg: number | null;
  workoutTiming: WorkoutTiming;
  hasWorkout: boolean;
  /** Eating meals/day (3/4/5). Defaults to 4 — the prior fixed split. */
  mealSchedule?: MealScheduleCount;
}

/** Targets keyed by meal. Inactive slots are OMITTED (not zero-filled). */
export type MealFuelTargets = Partial<Record<MealType, MealFuelTarget>>;

/**
 * The eating meals (in render order) for a meals-per-day preset. The workout
 * `pre_workout` slot is layered on top per timing; the trailing snack(s) are the
 * flex tail that absorbs reconciliation drift.
 */
export function resolveEatingMeals(schedule: MealScheduleCount): MealType[] {
  switch (schedule) {
    case 3:
      return ["breakfast", "lunch", "dinner"];
    case 5:
      return ["breakfast", "lunch", "dinner", "snack", "snack_pm"];
    default:
      return ["breakfast", "lunch", "dinner", "snack"];
  }
}

const KCAL_PER_G = { protein: 4, carb: 4, fat: 9 } as const;

// Even protein across meals already encodes bodyweight (the daily target is
// ~1.8 g/kg); the g/kg anchor is only the fallback when no daily protein is set.
const PROTEIN_PER_MEAL_FALLBACK_G = 25;
const PROTEIN_G_PER_KG_PER_MEAL = 0.35;
const PROTEIN_PER_MEAL_MIN_G = 20;
const PROTEIN_PER_MEAL_MAX_G = 45;

// Even-ish base split weights across the eating meals — used alike for the carb,
// fat, and calorie remainder (after the session anchors), renormalised over
// whichever meals actually receive it (so 3/4/5-meal schedules all work).
const MEAL_SPLIT_WEIGHTS: Partial<Record<MealType, number>> = {
  breakfast: 0.25,
  lunch: 0.3,
  dinner: 0.3,
  snack: 0.15,
  snack_pm: 0.15,
};
// The recovery meal stays leaner — carbs/protein forward, fat held back.
const RECOVERY_FAT_WEIGHT = 0.1;

/** The meal that absorbs reconciliation drift so Σ meals == daily: the trailing
 *  snack when present, else the last eating meal. */
function resolveFlexMeal(eatingMeals: MealType[]): MealType {
  if (eatingMeals.includes("snack_pm")) return "snack_pm";
  if (eatingMeals.includes("snack")) return "snack";
  return eatingMeals[eatingMeals.length - 1];
}

interface TimingPlan {
  /** The post-workout recovery meal (carb + protein floors, leaner fat). */
  recoveryMeal: MealType;
  /** A dedicated pre_workout slot for fast carbs (fasted morning only). */
  preSlot: boolean;
  /** An existing meal that carb-loads before the session (midday/evening). */
  preMeal: MealType | null;
}

/** Map the session's timing to which meals are the pre / recovery meals. */
function resolveTimingPlan(timing: WorkoutTiming): TimingPlan | null {
  switch (timing) {
    case "am_pre_breakfast":
      return { recoveryMeal: "breakfast", preSlot: true, preMeal: null };
    case "midday":
      return { recoveryMeal: "lunch", preSlot: false, preMeal: "breakfast" };
    case "evening":
      return { recoveryMeal: "dinner", preSlot: false, preMeal: "lunch" };
    default:
      return null;
  }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Split a total across meals by (renormalised) weights, rounded to 0.1g. */
function splitByWeights(
  total: number,
  weights: Partial<Record<MealType, number>>,
): Map<MealType, number> {
  const out = new Map<MealType, number>();
  const sumW = Object.values(weights).reduce((s, w) => s + (w ?? 0), 0);
  if (sumW <= 0 || total <= 0) {
    for (const meal of Object.keys(weights) as MealType[]) out.set(meal, 0);
    return out;
  }
  for (const meal of Object.keys(weights) as MealType[]) {
    const w = weights[meal] ?? 0;
    out.set(meal, round1((total * w) / sumW));
  }
  return out;
}

/** Weights from `base` restricted to `meals` so splitByWeights renormalises. */
function pickWeights(
  base: Partial<Record<MealType, number>>,
  meals: MealType[],
): Partial<Record<MealType, number>> {
  const out: Partial<Record<MealType, number>> = {};
  for (const meal of meals) {
    const w = base[meal];
    if (w != null) out[meal] = w;
  }
  return out;
}

/** Push the rounding/anchor residue into the flex meal so Σ == daily target.
 *  Returns true when the flex meal had to be clamped at 0 (residual remains). */
function reconcileToDaily(
  map: Map<MealType, number>,
  dailyTotal: number | null,
  flexMeal: MealType,
): boolean {
  if (dailyTotal == null) return false;
  let sum = 0;
  for (const v of map.values()) sum += v;
  const drift = round1(dailyTotal - sum);
  if (drift === 0 || !map.has(flexMeal)) return false;
  const next = round1((map.get(flexMeal) ?? 0) + drift);
  map.set(flexMeal, Math.max(0, next));
  return next < 0;
}

function allocateCarbs(
  dailyCarbG: number | null,
  session: MealFuelSessionAnchor | null,
  plan: TimingPlan | null,
  hasPreSlot: boolean,
  eatingMeals: MealType[],
): { map: Map<MealType, number>; anchorExceeds: boolean } {
  const map = new Map<MealType, number>();
  const recovery = plan?.recoveryMeal ?? null;
  const preCarbAmt = session ? Math.max(0, round1(session.preCarbG)) : 0;
  const postFloor = plan != null && session != null ? Math.max(0, round1(session.postCarbG)) : 0;
  const slotCarb = hasPreSlot ? preCarbAmt : 0;
  const preMealCarb = plan?.preMeal != null && session != null ? preCarbAmt : 0;

  if (hasPreSlot) map.set("pre_workout", slotCarb);
  if (recovery) map.set(recovery, postFloor);
  const distMeals = eatingMeals.filter((meal) => meal !== recovery);

  if (dailyCarbG == null) {
    // No daily carb target: just the session anchors (other meals 0).
    for (const meal of distMeals) map.set(meal, 0);
    if (plan?.preMeal) map.set(plan.preMeal, preMealCarb);
    return { map, anchorExceeds: false };
  }

  const anchored = slotCarb + preMealCarb + postFloor;
  const anchorExceeds = anchored > dailyCarbG + 0.05;
  const remaining = Math.max(0, round1(dailyCarbG - anchored));
  const split = splitByWeights(remaining, pickWeights(MEAL_SPLIT_WEIGHTS, distMeals));
  for (const meal of distMeals) map.set(meal, split.get(meal) ?? 0);
  // Front-load the pre carbs onto the pre meal (midday/evening), on top of its share.
  if (plan?.preMeal) map.set(plan.preMeal, round1((map.get(plan.preMeal) ?? 0) + preMealCarb));
  return { map, anchorExceeds };
}

function allocateProtein(
  dailyProteinG: number | null,
  session: MealFuelSessionAnchor | null,
  plan: TimingPlan | null,
  hasPreSlot: boolean,
  bodyweightKg: number | null,
  eatingMeals: MealType[],
): { map: Map<MealType, number>; floorBound: boolean } {
  const map = new Map<MealType, number>();
  if (hasPreSlot) map.set("pre_workout", 0);
  const recovery = plan?.recoveryMeal ?? null;
  const floor = plan != null && session != null && recovery ? Math.max(0, round1(session.postProteinG)) : 0;

  if (dailyProteinG == null) {
    const perMeal =
      bodyweightKg && bodyweightKg > 0
        ? clamp(
            Math.round(bodyweightKg * PROTEIN_G_PER_KG_PER_MEAL),
            PROTEIN_PER_MEAL_MIN_G,
            PROTEIN_PER_MEAL_MAX_G,
          )
        : PROTEIN_PER_MEAL_FALLBACK_G;
    for (const meal of eatingMeals) map.set(meal, perMeal);
    if (recovery) map.set(recovery, Math.max(perMeal, floor));
    return { map, floorBound: recovery != null && floor > perMeal };
  }

  const even = round1(dailyProteinG / eatingMeals.length);
  const floorBound = recovery != null && floor > even;
  if (floorBound) {
    map.set(recovery, floor);
    const rest = round1((dailyProteinG - floor) / (eatingMeals.length - 1));
    for (const meal of eatingMeals) if (meal !== recovery) map.set(meal, Math.max(0, rest));
  } else {
    for (const meal of eatingMeals) map.set(meal, even);
  }
  return { map, floorBound };
}

function allocateFat(
  dailyFatG: number | null,
  plan: TimingPlan | null,
  hasPreSlot: boolean,
  eatingMeals: MealType[],
): Map<MealType, number> {
  const map = new Map<MealType, number>();
  if (hasPreSlot) map.set("pre_workout", 0);
  if (dailyFatG == null) {
    for (const meal of eatingMeals) map.set(meal, 0);
    return map;
  }
  const recovery = plan?.recoveryMeal ?? null;
  const weights: Partial<Record<MealType, number>> = {};
  for (const meal of eatingMeals) {
    weights[meal] = meal === recovery ? RECOVERY_FAT_WEIGHT : (MEAL_SPLIT_WEIGHTS[meal] ?? 0);
  }
  const split = splitByWeights(dailyFatG, weights);
  for (const meal of eatingMeals) map.set(meal, split.get(meal) ?? 0);
  return map;
}

function buildRationale(
  role: MealRole,
  t: { carbG: number; proteinG: number; calories: number },
  isPreMeal: boolean,
): string {
  if (isPreMeal) return `Carb-load before your session — ${t.carbG}g carbs.`;
  switch (role) {
    case "pre_workout_fast_carbs":
      return `~${t.carbG}g fast carbs to fuel this morning's session.`;
    case "post_workout_recovery":
      return `Your post-workout refuel — ${t.carbG}g carbs + ${t.proteinG}g protein to recover.`;
    case "flex_remainder":
      return "Flexible — fills whatever's left to hit your daily target.";
    default:
      return `~${t.calories} kcal to round out the day — steady carbs, protein, and fat.`;
  }
}

/**
 * Distribute the day's effective daily target across meal slots. Returns null
 * when no daily target is set (nothing to distribute), mirroring how the daily
 * summary returns a null effective target. Active slots only (a Partial record):
 * `pre_workout` appears only for a fasted-morning session that warrants
 * pre-fuelling; otherwise the pre carbs front-load an existing meal and the
 * recovery role lands on the meal after the session (breakfast/lunch/dinner).
 */
export function computeMealFuelTargets(input: MealFuelInput): MealFuelTargets | null {
  const { daily } = input;
  if (
    daily.calories == null &&
    daily.proteinG == null &&
    daily.carbG == null &&
    daily.fatG == null
  ) {
    return null;
  }

  const eatingMeals = resolveEatingMeals(input.mealSchedule ?? DEFAULT_MEAL_SCHEDULE);
  const flexMeal = resolveFlexMeal(eatingMeals);

  // A workout day needs the flag, the session anchors, and a timing with a plan;
  // otherwise we degrade gracefully to a rest-day split.
  const plan = input.hasWorkout && input.session != null ? resolveTimingPlan(input.workoutTiming) : null;
  const session = plan != null ? input.session : null;
  const hasPreSlot = plan != null && plan.preSlot && session != null && session.preCarbG > 0;
  const recovery = plan?.recoveryMeal ?? null;
  const preMeal = plan?.preMeal ?? null;
  const isWorkout = plan != null;

  const activeMeals: MealType[] = [
    ...(hasPreSlot ? (["pre_workout"] as MealType[]) : []),
    ...eatingMeals,
  ];

  const roles = new Map<MealType, MealRole>();
  if (hasPreSlot) roles.set("pre_workout", "pre_workout_fast_carbs");
  for (const meal of eatingMeals) roles.set(meal, "standard");
  roles.set(flexMeal, "flex_remainder");
  if (recovery) roles.set(recovery, "post_workout_recovery");

  const noMacros = daily.proteinG == null && daily.carbG == null && daily.fatG == null;
  if (noMacros) {
    // Calorie-only target: split kcal by weight, no macro breakdown to give.
    return buildCalorieOnly(activeMeals, roles, hasPreSlot, daily.calories ?? 0, eatingMeals, flexMeal);
  }

  const { map: carbMap, anchorExceeds } = allocateCarbs(daily.carbG, session, plan, hasPreSlot, eatingMeals);
  const { map: proteinMap, floorBound } = allocateProtein(
    daily.proteinG,
    session,
    plan,
    hasPreSlot,
    input.bodyweightKg,
    eatingMeals,
  );
  const fatMap = allocateFat(daily.fatG, plan, hasPreSlot, eatingMeals);

  const carbClamped = reconcileToDaily(carbMap, daily.carbG, flexMeal);
  reconcileToDaily(proteinMap, daily.proteinG, flexMeal);
  reconcileToDaily(fatMap, daily.fatG, flexMeal);

  const usedBodyweightFallback =
    daily.proteinG == null && (input.bodyweightKg == null || input.bodyweightKg <= 0);

  const out: MealFuelTargets = {};
  for (const meal of activeMeals) {
    const carbG = round1(carbMap.get(meal) ?? 0);
    const proteinG = round1(proteinMap.get(meal) ?? 0);
    const fatG = round1(fatMap.get(meal) ?? 0);
    const calories = Math.round(
      proteinG * KCAL_PER_G.protein + carbG * KCAL_PER_G.carb + fatG * KCAL_PER_G.fat,
    );
    const role = roles.get(meal) ?? "standard";
    const isPreMeal = preMeal != null && meal === preMeal;

    const reasonCodes: string[] = [];
    if (role === "pre_workout_fast_carbs") reasonCodes.push("pre_workout_fuel");
    if (role === "post_workout_recovery") {
      reasonCodes.push("post_workout_recovery");
      if (floorBound) reasonCodes.push("post_protein_floor");
    }
    if (anchorExceeds && (role === "pre_workout_fast_carbs" || role === "post_workout_recovery")) {
      reasonCodes.push("carbs_anchor_exceeds_daily");
    }
    if (isPreMeal) reasonCodes.push("pre_session_carbs");
    if (role === "standard" && !isPreMeal) reasonCodes.push(isWorkout ? "standard_split" : "rest_day_even");
    if (role === "flex_remainder") {
      reasonCodes.push("flex_remainder");
      if (carbClamped) reasonCodes.push("reconcile_clamped");
    }
    if (usedBodyweightFallback) reasonCodes.push("no_bodyweight_defaults");

    out[meal] = {
      calories,
      carbG,
      proteinG,
      fatG,
      role,
      reasonCodes,
      rationale: buildRationale(role, { carbG, proteinG, calories }, isPreMeal),
    };
  }
  return out;
}

/** Calorie-only target (no macros set): split kcal by weight; macros stay 0. */
function buildCalorieOnly(
  activeMeals: MealType[],
  roles: Map<MealType, MealRole>,
  hasPreSlot: boolean,
  dailyCalories: number,
  eatingMeals: MealType[],
  flexMeal: MealType,
): MealFuelTargets {
  // Give the pre-workout slot a small, fixed share; split the rest by weights.
  const preShare = hasPreSlot ? Math.min(dailyCalories, 120) : 0;
  const kcalMap = new Map<MealType, number>();
  if (hasPreSlot) kcalMap.set("pre_workout", preShare);
  const split = splitByWeights(Math.max(0, dailyCalories - preShare), pickWeights(MEAL_SPLIT_WEIGHTS, eatingMeals));
  for (const meal of eatingMeals) kcalMap.set(meal, split.get(meal) ?? 0);
  reconcileToDaily(kcalMap, dailyCalories, flexMeal);

  const out: MealFuelTargets = {};
  for (const meal of activeMeals) {
    const calories = Math.round(kcalMap.get(meal) ?? 0);
    const role = roles.get(meal) ?? "standard";
    out[meal] = {
      calories,
      carbG: 0,
      proteinG: 0,
      fatG: 0,
      role,
      reasonCodes: ["calorie_only_target"],
      rationale: `~${calories} kcal — set carb/protein/fat goals for a full per-meal breakdown.`,
    };
  }
  return out;
}

/** A per-meal override: any field null ⇒ keep the computed value for that meal. */
export interface MealFuelOverride {
  calories?: number | null;
  carbG?: number | null;
  proteinG?: number | null;
  fatG?: number | null;
}

/**
 * Apply user per-meal overrides on top of the computed targets. Only meals that
 * are active that day are touched; a null field keeps the computed number.
 * Calories are recomputed from the final macros (matching the engine) whenever a
 * macro is overridden, else an explicit calorie override is honoured. The edited
 * meal is flagged with a `user_override` reason code. We deliberately do NOT
 * re-reconcile — an explicit edit is the athlete's intent, not a cue to silently
 * move macros they didn't touch (so the day's sum may differ, which is expected).
 */
export function applyMealTargetOverrides(
  targets: MealFuelTargets,
  overrides: Partial<Record<MealType, MealFuelOverride>>,
): MealFuelTargets {
  const out: MealFuelTargets = {};
  for (const key of Object.keys(targets) as MealType[]) {
    const target = targets[key];
    if (!target) continue;
    const ov = overrides[key];
    if (!ov || (ov.calories == null && ov.carbG == null && ov.proteinG == null && ov.fatG == null)) {
      out[key] = target;
      continue;
    }
    const carbG = round1(ov.carbG ?? target.carbG);
    const proteinG = round1(ov.proteinG ?? target.proteinG);
    const fatG = round1(ov.fatG ?? target.fatG);
    const macroOverridden = ov.carbG != null || ov.proteinG != null || ov.fatG != null;
    const calories = macroOverridden
      ? Math.round(proteinG * KCAL_PER_G.protein + carbG * KCAL_PER_G.carb + fatG * KCAL_PER_G.fat)
      : Math.round(ov.calories ?? target.calories);
    out[key] = {
      ...target,
      calories,
      carbG,
      proteinG,
      fatG,
      reasonCodes: [...target.reasonCodes, "user_override"],
      rationale: "Custom target you set for this meal.",
    };
  }
  return out;
}
