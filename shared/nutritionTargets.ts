/**
 * Pure calculators for nutrition targets. DB-free and browser-safe (imported by
 * both the server route layer and the client TargetsDialog), mirroring the style
 * of `shared/maf.ts`: typed Input/Result shapes, `reasonCodes` + `explanation`
 * for transparency, and no I/O.
 *
 * Two concerns live here:
 *   1. Feature A — a calorie + macro target from the athlete's profile
 *      (Mifflin–St Jeor BMR → TDEE → goal adjustment → g/kg macros).
 *   2. Feature B — the training-day-aware "effective" target: scale a baseline's
 *      carbs (and therefore calories) by a day's actual training load (UTSS),
 *      keeping protein/fat anchored to bodyweight.
 */

export type ActivityLevel = "sedentary" | "light" | "moderate" | "active" | "very_active";
export type WeightGoalDirection = "lose" | "maintain" | "gain";
// BMR needs a binary sex term; null / "prefer not to say" → a neutral midpoint.
export type BmrSex = "male" | "female" | null;

// Mifflin–St Jeor activity multipliers (BMR → TDEE).
export const ACTIVITY_MULTIPLIERS: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};

const KCAL_PER_KG_BODYWEIGHT = 7700; // ~7700 kcal per kg of body mass
const KCAL_PER_G_PROTEIN = 4;
const KCAL_PER_G_CARB = 4;
const KCAL_PER_G_FAT = 9;
const DAYS_PER_WEEK = 7;

// g/kg anchors — the chosen macro method. Overridable per call.
export const DEFAULT_PROTEIN_G_PER_KG = 1.8;
export const DEFAULT_FAT_G_PER_KG = 1.0;

// Calorie floors so an aggressive deficit can't produce an unsafe target.
const CALORIE_FLOOR_FEMALE = 1200;
const CALORIE_FLOOR_DEFAULT = 1500;

function roundKcal(n: number): number {
  return Math.round(n);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export interface BmrInput {
  bodyweightKg: number;
  heightCm: number;
  ageYears: number;
  sex: BmrSex;
}

/**
 * Mifflin–St Jeor BMR (kcal/day). The sex term is +5 (male) or −161 (female);
 * when sex is unknown (null / "prefer not to say") we use the midpoint (−78) so
 * the estimate is unbiased rather than defaulting to one sex.
 */
export function calculateBmr(input: BmrInput): number {
  const base = 10 * input.bodyweightKg + 6.25 * input.heightCm - 5 * input.ageYears;
  let sexTerm: number;
  if (input.sex === "male") sexTerm = 5;
  else if (input.sex === "female") sexTerm = -161;
  else sexTerm = (5 + -161) / 2;
  return base + sexTerm;
}

export interface NutritionTargetInput extends BmrInput {
  activityLevel: ActivityLevel;
  goalDirection: WeightGoalDirection;
  /** Magnitude of target weight change per week (kg, >= 0); ignored when maintaining. */
  goalRateKgPerWeek: number;
  proteinGPerKg?: number;
  fatGPerKg?: number;
}

export interface NutritionTargetResult {
  bmr: number;
  tdee: number;
  calories: number;
  proteinG: number;
  carbG: number;
  fatG: number;
  /** Signed kcal/day applied to TDEE for the goal (negative = deficit). */
  goalCalorieDelta: number;
  reasonCodes: string[];
  warning: string | null;
  explanation: string;
}

/**
 * Full target derivation: BMR → TDEE → goal-adjusted calories → g/kg macros with
 * carbs filling the remainder. Pure; all rounding happens here so callers store
 * tidy numbers.
 */
export function calculateNutritionTarget(input: NutritionTargetInput): NutritionTargetResult {
  const reasonCodes: string[] = [];
  let warning: string | null = null;

  const bmr = calculateBmr(input);
  if (input.sex == null) reasonCodes.push("sex_neutral_bmr");

  const tdee = bmr * ACTIVITY_MULTIPLIERS[input.activityLevel];

  const dailyKcalFromRate = (Math.abs(input.goalRateKgPerWeek) * KCAL_PER_KG_BODYWEIGHT) / DAYS_PER_WEEK;
  let goalCalorieDelta = 0;
  if (input.goalDirection === "lose") goalCalorieDelta = -dailyKcalFromRate;
  else if (input.goalDirection === "gain") goalCalorieDelta = dailyKcalFromRate;

  let calories = tdee + goalCalorieDelta;

  const floor = input.sex === "female" ? CALORIE_FLOOR_FEMALE : CALORIE_FLOOR_DEFAULT;
  if (calories < floor) {
    calories = floor;
    warning = `Calorie target floored at ${floor} kcal for safety.`;
    reasonCodes.push("calorie_floor_applied");
  }

  const proteinG = (input.proteinGPerKg ?? DEFAULT_PROTEIN_G_PER_KG) * input.bodyweightKg;
  const fatG = (input.fatGPerKg ?? DEFAULT_FAT_G_PER_KG) * input.bodyweightKg;
  const proteinFatKcal = proteinG * KCAL_PER_G_PROTEIN + fatG * KCAL_PER_G_FAT;

  // Carbs fill the remainder; guard against negative (very low calories relative
  // to bodyweight) by clamping to 0 and re-raising calories to keep the macros
  // internally consistent with the stated calorie number.
  let carbKcal = calories - proteinFatKcal;
  if (carbKcal < 0) {
    carbKcal = 0;
    warning = warning ?? "Protein and fat alone meet the calorie target; carbs set to 0.";
    reasonCodes.push("carbs_clamped_zero");
    calories = proteinFatKcal;
  }
  const carbG = carbKcal / KCAL_PER_G_CARB;

  const deltaSign = goalCalorieDelta >= 0 ? "+" : "";
  return {
    bmr: roundKcal(bmr),
    tdee: roundKcal(tdee),
    calories: roundKcal(calories),
    proteinG: round1(proteinG),
    carbG: round1(carbG),
    fatG: round1(fatG),
    goalCalorieDelta: roundKcal(goalCalorieDelta),
    reasonCodes,
    warning,
    explanation:
      `BMR ${roundKcal(bmr)} kcal (Mifflin–St Jeor), TDEE ${roundKcal(tdee)} kcal ` +
      `(×${ACTIVITY_MULTIPLIERS[input.activityLevel]}), goal ${deltaSign}${roundKcal(goalCalorieDelta)} kcal ` +
      `→ ${roundKcal(calories)} kcal. Protein ${round1(proteinG)}g + fat ${round1(fatG)}g ` +
      `anchored to ${input.bodyweightKg}kg; carbs ${round1(carbG)}g fill the remainder.`,
  };
}

// ---------------------------------------------------------------------------
// Feature B — training-day-aware effective target.
// ---------------------------------------------------------------------------

export interface PeriodizationConfig {
  enabled: boolean;
  /** UTSS at which the effective carbs equal the baseline carbs. */
  referenceUtss: number;
  /** Δ carb grams per +1 UTSS above the reference. */
  carbGramsPerUtss: number;
}

export interface BaselineTarget {
  calories: number | null;
  proteinG: number | null;
  carbG: number | null;
  fatG: number | null;
}

export interface EffectiveTargetResult {
  calories: number | null;
  proteinG: number | null;
  carbG: number | null;
  fatG: number | null;
  /** Signed carb grams applied vs the baseline (post-floor, so the UI note is honest). */
  carbDeltaG: number;
  /** True when the carb/calorie values were actually load-scaled. */
  scaled: boolean;
}

/**
 * Scale a baseline target's carbs (and therefore calories) by a day's actual
 * training load. Protein and fat are unchanged (anchored to bodyweight). Linear:
 * `carbs = baseCarbs + (dayUtss − referenceUtss) × carbGramsPerUtss`, floored at
 * 0g. Returns the baseline unchanged when periodisation is off or there is no
 * carb baseline to scale.
 */
export function effectiveTarget(
  base: BaselineTarget,
  dayUtss: number,
  config: PeriodizationConfig,
): EffectiveTargetResult {
  if (!config.enabled || base.carbG == null) {
    return { ...base, carbDeltaG: 0, scaled: false };
  }
  const rawDelta = (dayUtss - config.referenceUtss) * config.carbGramsPerUtss;
  const newCarbG = Math.max(0, base.carbG + rawDelta);
  const carbDeltaG = round1(newCarbG - base.carbG);
  const carbCalDelta = carbDeltaG * KCAL_PER_G_CARB;
  return {
    proteinG: base.proteinG,
    fatG: base.fatG,
    carbG: round1(newCarbG),
    calories: base.calories == null ? null : roundKcal(base.calories + carbCalDelta),
    carbDeltaG,
    scaled: true,
  };
}

/**
 * Sensible periodisation defaults derived from a baseline target + the athlete's
 * typical daily load, computed where the target is created (the pure functions
 * above stay config-driven for testability). The slope is half-proportional so a
 * rest day (UTSS 0) keeps roughly half the baseline carbs rather than zero.
 */
export function defaultPeriodizationConfig(
  baselineCarbG: number,
  recentAvgDailyUtss: number,
): { referenceUtss: number; carbGramsPerUtss: number } {
  const referenceUtss = recentAvgDailyUtss > 0 ? round1(recentAvgDailyUtss) : 50;
  const carbGramsPerUtss = round1((baselineCarbG / referenceUtss) * 0.5);
  return { referenceUtss, carbGramsPerUtss };
}
