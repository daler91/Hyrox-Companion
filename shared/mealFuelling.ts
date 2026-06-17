/**
 * Per-meal fuel targets — the nutrition↔training USP. Distributes the day's
 * (load-adjusted) daily target across the day's meals, placing the session's
 * pre/post fuelling anchors first so carbs land when the athlete needs them.
 *
 * v1 assumes the workout is in the MORNING, before a full breakfast
 * (`workoutTiming: "am_pre_breakfast"`): a `pre_workout` slot gets light fast
 * carbs and BREAKFAST is the post-workout recovery meal (carb + protein
 * floors from the session target). Rest days get an even, lower-carb split.
 *
 * The single seam for a future workout time-of-day field is `workoutTiming`:
 * add a `WorkoutTiming` value and the matching active-slot/role branch below
 * (e.g. a `pm_post_dinner` timing would activate the literal `post_workout`
 * slot and make dinner the pre meal). Nothing above this module changes — the
 * route just stops passing the hard-coded "am_pre_breakfast".
 *
 * Browser-safe and DB-free, mirroring shared/sessionFuellingTargets.ts: typed
 * Input/Result shapes, `reasonCodes` + `rationale` for transparency, no I/O.
 * The numbers are coaching guidance (the daily target split, with the session
 * anchors placed first) — not prescriptions.
 */
import type { MealType } from "./schema/tables";

export type WorkoutTiming = "am_pre_breakfast" | "none";

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

export interface MealFuelInput {
  daily: MealFuelDailyTarget;
  /** The primary workout's session anchors, or null on a rest day. */
  session: MealFuelSessionAnchor | null;
  bodyweightKg: number | null;
  workoutTiming: WorkoutTiming;
  hasWorkout: boolean;
}

/** Targets keyed by meal. Inactive slots are OMITTED (not zero-filled). */
export type MealFuelTargets = Partial<Record<MealType, MealFuelTarget>>;

const KCAL_PER_G = { protein: 4, carb: 4, fat: 9 } as const;

// Even protein across meals already encodes bodyweight (the daily target is
// ~1.8 g/kg); the g/kg anchor is only the fallback when no daily protein is set.
const PROTEIN_PER_MEAL_FALLBACK_G = 25;
const PROTEIN_G_PER_KG_PER_MEAL = 0.35;
const PROTEIN_PER_MEAL_MIN_G = 20;
const PROTEIN_PER_MEAL_MAX_G = 45;

// Carb split for the carbs LEFT after the pre/post anchors are placed.
const CARB_WEIGHTS_WORKOUT: Partial<Record<MealType, number>> = {
  lunch: 0.35,
  dinner: 0.4,
  snack: 0.25,
};
const CARB_WEIGHTS_REST: Partial<Record<MealType, number>> = {
  breakfast: 0.25,
  lunch: 0.3,
  dinner: 0.3,
  snack: 0.15,
};

// Fat split — kept low pre/post (fast carbs / lean recovery); lunch & dinner
// carry the bulk. Pre-workout fat is always 0.
const FAT_WEIGHTS_WORKOUT: Partial<Record<MealType, number>> = {
  breakfast: 0.1,
  lunch: 0.4,
  dinner: 0.4,
  snack: 0.1,
};
const FAT_WEIGHTS_REST: Partial<Record<MealType, number>> = {
  breakfast: 0.2,
  lunch: 0.35,
  dinner: 0.35,
  snack: 0.1,
};

// Fallback split when a target carries calories but no macros to break down.
const CALORIE_WEIGHTS: Partial<Record<MealType, number>> = {
  breakfast: 0.25,
  lunch: 0.3,
  dinner: 0.3,
  snack: 0.15,
};

// The flexible meal that absorbs reconciliation drift so Σ meals == daily.
const FLEX_MEAL: MealType = "snack";

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
  for (const [meal, w] of Object.entries(weights) as [MealType, number][]) {
    out.set(meal, round1((total * w) / sumW));
  }
  return out;
}

/** Push the rounding/anchor residue into the flex meal so Σ == daily target.
 *  Returns true when the flex meal had to be clamped at 0 (residual remains). */
function reconcileToDaily(map: Map<MealType, number>, dailyTotal: number | null): boolean {
  if (dailyTotal == null) return false;
  let sum = 0;
  for (const v of map.values()) sum += v;
  const drift = round1(dailyTotal - sum);
  if (drift === 0 || !map.has(FLEX_MEAL)) return false;
  const next = round1((map.get(FLEX_MEAL) ?? 0) + drift);
  map.set(FLEX_MEAL, Math.max(0, next));
  return next < 0;
}

function allocateCarbs(
  dailyCarbG: number | null,
  session: MealFuelSessionAnchor | null,
  hasPre: boolean,
  isWorkout: boolean,
): { map: Map<MealType, number>; anchorExceeds: boolean } {
  const map = new Map<MealType, number>();
  const preCarb = hasPre && session ? Math.max(0, round1(session.preCarbG)) : 0;
  const postFloor = isWorkout && session ? Math.max(0, round1(session.postCarbG)) : 0;
  if (hasPre) map.set("pre_workout", preCarb);
  if (isWorkout) map.set("breakfast", postFloor);

  if (dailyCarbG == null) {
    // No daily carb target: just the session anchors (other meals 0).
    if (!isWorkout) map.set("breakfast", 0);
    for (const meal of ["lunch", "dinner", "snack"] as MealType[]) map.set(meal, 0);
    return { map, anchorExceeds: false };
  }

  const anchored = preCarb + postFloor;
  const anchorExceeds = anchored > dailyCarbG + 0.05;
  const remaining = Math.max(0, round1(dailyCarbG - anchored));
  const split = splitByWeights(remaining, isWorkout ? CARB_WEIGHTS_WORKOUT : CARB_WEIGHTS_REST);
  if (!isWorkout) map.set("breakfast", split.get("breakfast") ?? 0);
  for (const meal of ["lunch", "dinner", "snack"] as MealType[])
    map.set(meal, split.get(meal) ?? 0);
  return { map, anchorExceeds };
}

function allocateProtein(
  dailyProteinG: number | null,
  session: MealFuelSessionAnchor | null,
  isWorkout: boolean,
  hasPre: boolean,
  bodyweightKg: number | null,
): { map: Map<MealType, number>; floorBound: boolean } {
  const map = new Map<MealType, number>();
  if (hasPre) map.set("pre_workout", 0);
  const proteinMeals: MealType[] = ["breakfast", "lunch", "dinner", "snack"];
  const floor = isWorkout && session ? Math.max(0, round1(session.postProteinG)) : 0;

  if (dailyProteinG == null) {
    const perMeal =
      bodyweightKg && bodyweightKg > 0
        ? clamp(
            Math.round(bodyweightKg * PROTEIN_G_PER_KG_PER_MEAL),
            PROTEIN_PER_MEAL_MIN_G,
            PROTEIN_PER_MEAL_MAX_G,
          )
        : PROTEIN_PER_MEAL_FALLBACK_G;
    for (const meal of proteinMeals) map.set(meal, perMeal);
    if (isWorkout) map.set("breakfast", Math.max(perMeal, floor));
    return { map, floorBound: isWorkout && floor > perMeal };
  }

  const even = round1(dailyProteinG / proteinMeals.length);
  const floorBound = isWorkout && floor > even;
  if (floorBound) {
    map.set("breakfast", floor);
    const rest = round1((dailyProteinG - floor) / (proteinMeals.length - 1));
    for (const meal of proteinMeals) if (meal !== "breakfast") map.set(meal, Math.max(0, rest));
  } else {
    for (const meal of proteinMeals) map.set(meal, even);
  }
  return { map, floorBound };
}

function allocateFat(
  dailyFatG: number | null,
  hasPre: boolean,
  isWorkout: boolean,
): Map<MealType, number> {
  const map = new Map<MealType, number>();
  if (hasPre) map.set("pre_workout", 0);
  const fatMeals: MealType[] = ["breakfast", "lunch", "dinner", "snack"];
  if (dailyFatG == null) {
    for (const meal of fatMeals) map.set(meal, 0);
    return map;
  }
  const split = splitByWeights(dailyFatG, isWorkout ? FAT_WEIGHTS_WORKOUT : FAT_WEIGHTS_REST);
  for (const meal of fatMeals) map.set(meal, split.get(meal) ?? 0);
  return map;
}

function buildRationale(
  role: MealRole,
  t: { carbG: number; proteinG: number; calories: number },
): string {
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
 * `pre_workout` appears only when the morning session warrants pre-fuelling, and
 * the literal `post_workout` slot stays inactive under the AM assumption because
 * breakfast carries the recovery role.
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

  // A workout day needs both the flag and the session anchors; if anchors are
  // missing we degrade gracefully to a rest-day split.
  const isWorkout =
    input.hasWorkout && input.workoutTiming === "am_pre_breakfast" && input.session != null;
  const session = isWorkout ? input.session : null;
  const hasPre = isWorkout && session != null && session.preCarbG > 0;

  const activeMeals: MealType[] = [
    ...(hasPre ? (["pre_workout"] as MealType[]) : []),
    "breakfast",
    "lunch",
    "dinner",
    "snack",
  ];

  const roles = new Map<MealType, MealRole>();
  if (hasPre) roles.set("pre_workout", "pre_workout_fast_carbs");
  roles.set("breakfast", isWorkout ? "post_workout_recovery" : "standard");
  roles.set("lunch", "standard");
  roles.set("dinner", "standard");
  roles.set("snack", "flex_remainder");

  const noMacros = daily.proteinG == null && daily.carbG == null && daily.fatG == null;
  if (noMacros) {
    // Calorie-only target: split kcal by weight, no macro breakdown to give.
    return buildCalorieOnly(activeMeals, roles, hasPre, daily.calories ?? 0);
  }

  const { map: carbMap, anchorExceeds } = allocateCarbs(daily.carbG, session, hasPre, isWorkout);
  const { map: proteinMap, floorBound } = allocateProtein(
    daily.proteinG,
    session,
    isWorkout,
    hasPre,
    input.bodyweightKg,
  );
  const fatMap = allocateFat(daily.fatG, hasPre, isWorkout);

  const carbClamped = reconcileToDaily(carbMap, daily.carbG);
  reconcileToDaily(proteinMap, daily.proteinG);
  reconcileToDaily(fatMap, daily.fatG);

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

    const reasonCodes: string[] = [];
    if (role === "pre_workout_fast_carbs") reasonCodes.push("pre_workout_fuel");
    if (role === "post_workout_recovery") {
      reasonCodes.push("post_workout_recovery");
      if (floorBound) reasonCodes.push("post_protein_floor");
    }
    if (anchorExceeds && (role === "pre_workout_fast_carbs" || role === "post_workout_recovery")) {
      reasonCodes.push("carbs_anchor_exceeds_daily");
    }
    if (role === "standard") reasonCodes.push(isWorkout ? "standard_split" : "rest_day_even");
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
      rationale: buildRationale(role, { carbG, proteinG, calories }),
    };
  }
  return out;
}

/** Calorie-only target (no macros set): split kcal by weight; macros stay 0. */
function buildCalorieOnly(
  activeMeals: MealType[],
  roles: Map<MealType, MealRole>,
  hasPre: boolean,
  dailyCalories: number,
): MealFuelTargets {
  // Give the pre-workout slot a small, fixed share; split the rest by weights.
  const preShare = hasPre ? Math.min(dailyCalories, 120) : 0;
  const kcalMap = new Map<MealType, number>();
  if (hasPre) kcalMap.set("pre_workout", preShare);
  const split = splitByWeights(Math.max(0, dailyCalories - preShare), CALORIE_WEIGHTS);
  for (const meal of ["breakfast", "lunch", "dinner", "snack"] as MealType[])
    kcalMap.set(meal, split.get(meal) ?? 0);
  reconcileToDaily(kcalMap, dailyCalories);

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
