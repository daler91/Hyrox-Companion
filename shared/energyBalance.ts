/**
 * Pure energy-balance calculator (Phase 4 of the nutrition↔training
 * integration): the day's energy in (logged food) vs energy out, closing the
 * loop on the static-multiplier TDEE in `shared/nutritionTargets.ts`.
 *
 * Energy out prefers MEASURED training calories (Strava/Garmin populate
 * `workout_logs.calories`). To avoid double-counting, a measured day uses
 * BMR × sedentary multiplier (digestion + non-exercise daily living) PLUS the
 * measured workout calories — never the static activity multiplier, which
 * already bakes an assumed training volume into TDEE. Days without device data
 * fall back to that static estimate, clearly labelled.
 *
 * Browser-safe and DB-free, mirroring `shared/sessionFuellingTargets.ts`:
 * typed Input/Result, `reasonCodes` + `explanation`, no I/O. Guidance only.
 */

import {
  ACTIVITY_MULTIPLIERS,
  type ActivityLevel,
  type BmrSex,
  calculateBmr,
} from "./nutritionTargets";

export interface EnergyBalanceInput {
  /** The day's logged food calories (energy in). */
  intakeKcal: number;
  /** Summed measured workout calories for the day; null/≤0 = no measurement. */
  measuredActiveKcal: number | null;
  /** BMR profile; balance is omitted (null) when any of these are missing. */
  bodyweightKg: number | null;
  heightCm: number | null;
  ageYears: number | null;
  sex: BmrSex;
  /** Static activity level for the estimated path; null assumes moderate. */
  activityLevel: ActivityLevel | null;
}

export interface EnergyBalanceSummary {
  inKcal: number;
  outKcal: number;
  /** in − out: positive = surplus, negative = deficit. */
  balanceKcal: number;
  bmrKcal: number;
  /** Training/activity calories above BMR (measured, or implied by the multiplier). */
  activeKcal: number;
  /** "measured" when device workout calories were used; "estimated" otherwise. */
  basis: "measured" | "estimated";
  reasonCodes: string[];
  explanation: string;
}

// The sedentary multiplier covers digestion + non-exercise daily living (NEAT),
// so measured workout calories stack on top without double-counting training.
const NEAT_MULTIPLIER = ACTIVITY_MULTIPLIERS.sedentary;

function hasBmrInputs(
  input: EnergyBalanceInput,
): input is EnergyBalanceInput & { bodyweightKg: number; heightCm: number; ageYears: number } {
  return (
    input.bodyweightKg != null &&
    input.bodyweightKg > 0 &&
    input.heightCm != null &&
    input.heightCm > 0 &&
    input.ageYears != null &&
    input.ageYears > 0
  );
}

/**
 * Derive the day's energy balance, or null when the profile can't support an
 * honest BMR (no bodyweight/height/age) — better no number than a wrong one.
 */
export function computeEnergyBalance(input: EnergyBalanceInput): EnergyBalanceSummary | null {
  if (!hasBmrInputs(input)) return null;

  const reasonCodes: string[] = [];
  if (input.sex == null) reasonCodes.push("sex_neutral_bmr");

  const bmr = calculateBmr({
    bodyweightKg: input.bodyweightKg,
    heightCm: input.heightCm,
    ageYears: input.ageYears,
    sex: input.sex,
  });

  const measured =
    input.measuredActiveKcal != null && input.measuredActiveKcal > 0
      ? input.measuredActiveKcal
      : null;

  let basis: EnergyBalanceSummary["basis"];
  let activeKcal: number;
  let outKcal: number;
  let explanation: string;

  if (measured != null) {
    basis = "measured";
    reasonCodes.push("measured_active_kcal");
    activeKcal = Math.round(measured);
    outKcal = Math.round(bmr * NEAT_MULTIPLIER + measured);
    // Print the daily-living component as out − active so the stated equation
    // always sums exactly (raw-BMR math vs rounded display can differ by 1).
    explanation =
      `Energy out = ${outKcal - activeKcal} kcal daily living (BMR × ${NEAT_MULTIPLIER}) + ` +
      `${activeKcal} kcal measured training = ${outKcal} kcal. Guidance only.`;
  } else {
    basis = "estimated";
    let level = input.activityLevel;
    if (level == null) {
      level = "moderate";
      reasonCodes.push("assumed_moderate_activity");
    }
    const tdee = bmr * ACTIVITY_MULTIPLIERS[level];
    activeKcal = Math.round(tdee - bmr);
    outKcal = Math.round(tdee);
    explanation =
      `Energy out = TDEE estimate ${outKcal} kcal (BMR ${Math.round(bmr)} kcal × ` +
      `${ACTIVITY_MULTIPLIERS[level]} ${level}). Connect Strava or Garmin for measured ` +
      `training calories. Guidance only.`;
  }

  const inKcal = Math.round(Math.max(0, input.intakeKcal));
  return {
    inKcal,
    outKcal,
    balanceKcal: inKcal - outKcal,
    bmrKcal: Math.round(bmr),
    activeKcal,
    basis,
    reasonCodes,
    explanation,
  };
}
