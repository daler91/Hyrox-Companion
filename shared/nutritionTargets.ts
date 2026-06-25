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
// Feature B — training-aware effective target.
//
// The baseline carbs flex with training in three ways, each opt-in via config so
// an existing flat/periodised target is byte-for-byte unchanged until enabled:
//   • base load   — today's actual UTSS (the original single-day behaviour);
//   • recovery    — PAST: top up carbs (+ protein) after hard recent days so a
//                   light day inside a hard block stays fuelled for glycogen
//                   resynthesis and repair rather than snapping to baseline;
//   • pre-load    — FUTURE: bring carbs forward ahead of an imminent big planned
//                   session, and carb-load through taper / race week.
// Protein/fat stay anchored to bodyweight except for the recovery protein bump.
// ---------------------------------------------------------------------------

export type TrainingPhase = "early" | "build" | "peak" | "taper" | "race_week";

export interface PeriodizationConfig {
  enabled: boolean;
  /** UTSS at which the effective carbs equal the baseline carbs. */
  referenceUtss: number;
  /** Δ carb grams per +1 UTSS above the reference. */
  carbGramsPerUtss: number;
  // --- Adaptive (window-aware) knobs. All optional; omitted ⇒ that behaviour is
  //     off, so the single-day path stays identical to before. ---
  /** PAST: add carbs (+ protein) for recovery after hard recent days. */
  recoveryEnabled?: boolean;
  /** Extra protein, as a fraction of baseline protein, on a fully depleted
   *  recovery day (scaled by how depleted/fatigued the day actually is). */
  recoveryProteinBumpFrac?: number;
  /** FUTURE: Δ carb grams pre-loaded per +1 planned UTSS (above reference) for an
   *  upcoming session, proximity-weighted by 1/daysAhead. 0 / omitted ⇒ off. */
  preloadCarbGramsPerUtss?: number;
  /** How many days ahead an upcoming session pulls carbs forward (default 1). */
  preloadDaysAhead?: number;
  /** Enable taper damping + race-week carb-loading from the plan phase. */
  phaseAware?: boolean;
  /** Cap on the positive carb delta (g) so adjustments can't compound absurdly. */
  maxCarbDeltaG?: number;
}

/**
 * A small window of training context around a day: the day's own load, recent
 * ACTUAL load (for recovery), upcoming PLANNED load (for pre-loading), and the
 * fitness/fatigue/phase signals the load engine already computes. Pure callers
 * pass an empty window (see {@link effectiveTarget}) to get the single-day path.
 */
export interface TrainingLoadWindow {
  /** Today's actual training load (UTSS); 0 on a rest day. */
  dayUtss: number;
  /** Trailing actual daily UTSS (excluding today), for the recovery signal. */
  recentLoads: number[];
  /** Acute fatigue (7-day EWMA of UTSS); null until the load engine is seeded. */
  acuteEwma: number | null;
  /** Chronic fitness (28-day EWMA of UTSS); null until seeded. */
  chronicEwma: number | null;
  /** Training Stress Balance / "Form" (chronic − acute); negative ⇒ fatigued. */
  tsb: number | null;
  /** Upcoming planned sessions within the pre-load horizon. */
  upcoming: { daysAhead: number; plannedUtss: number }[];
  /** Plan phase, when known, for taper / race-week behaviour. */
  phase: TrainingPhase | null;
  /** Days until the race, when a race date is set. */
  daysUntilRace: number | null;
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
  /** Signed carb grams applied vs the baseline (post-floor/cap, so the UI note is
   *  honest). Equals baseLoadDeltaG + recoveryDeltaG + preloadDeltaG. */
  carbDeltaG: number;
  /** Component of carbDeltaG attributable to today's load. */
  baseLoadDeltaG: number;
  /** Component of carbDeltaG attributable to recovery from recent load. */
  recoveryDeltaG: number;
  /** Component of carbDeltaG attributable to pre-loading for upcoming load. */
  preloadDeltaG: number;
  /** Signed protein grams applied vs the baseline (recovery bump; 0 otherwise). */
  proteinDeltaG: number;
  /** True when the carb/calorie values were actually load-scaled. */
  scaled: boolean;
  /** Transparency: machine-readable drivers of the adjustment. */
  reasonCodes: string[];
  /** Transparency: a one-line human explanation of the adjustment. */
  explanation: string;
}

// --- Adaptive periodisation tuning (used only when the matching knob is on). ---
/** Default recovery protein bump: up to +15% of baseline protein when depleted. */
const DEFAULT_RECOVERY_PROTEIN_BUMP_FRAC = 0.15;
/** Fraction of the "missing" load (recent demand − today) whose carbs we replace
 *  on a recovery day — reusing the athlete's carb-per-UTSS slope so it stays
 *  calibrated to their baseline. */
const RECOVERY_CARB_FACTOR = 0.5;
/** Negative TSB at which fatigue's contribution to the recovery signal saturates. */
const TSB_FATIGUE_SCALE = 25;
/** Race-week carb-load added on top, as a fraction of baseline carbs. */
const RACE_WEEK_CARB_LOAD_FRAC = 0.25;
/** During taper, positive training-load carb deltas are damped by this factor. */
const TAPER_LOAD_DAMP = 0.85;

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((acc, v) => acc + v, 0) / values.length;
}

function signed(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}

/** An empty window: only today's load is known (recovery/pre-load/phase off). */
export function singleDayWindow(dayUtss: number): TrainingLoadWindow {
  return {
    dayUtss,
    recentLoads: [],
    acuteEwma: null,
    chronicEwma: null,
    tsb: null,
    upcoming: [],
    phase: null,
    daysUntilRace: null,
  };
}

/**
 * Scale a baseline target's carbs (and therefore calories) by a single day's
 * training load — the original, periodisation behaviour. Thin wrapper over
 * {@link effectiveTargetWindowed} with an empty window, so the two paths share
 * one implementation and the single-day result is unchanged.
 */
export function effectiveTarget(
  base: BaselineTarget,
  dayUtss: number,
  config: PeriodizationConfig,
): EffectiveTargetResult {
  return effectiveTargetWindowed(base, singleDayWindow(dayUtss), config);
}

/** Base load — today's actual demand vs the reference (the original single-day
 *  behaviour), damped during taper. Returns the "taper" reason when damping fires. */
function computeBaseLoad(
  window: TrainingLoadWindow,
  config: PeriodizationConfig,
  slope: number,
  reference: number,
): { raw: number; reason: string | null } {
  let raw = (window.dayUtss - reference) * slope;
  if (config.phaseAware && window.phase === "taper" && raw > 0) {
    raw *= TAPER_LOAD_DAMP;
    return { raw, reason: "taper" };
  }
  return { raw, reason: null };
}

/** Recovery (past) — replace glycogen + repair after hard recent days, plus an
 *  optional protein bump scaled by how depleted/fatigued the day is. */
function computeRecovery(
  window: TrainingLoadWindow,
  config: PeriodizationConfig,
  baseProteinG: number | null,
  slope: number,
  reference: number,
): { raw: number; proteinDeltaG: number; reason: string | null } {
  if (!config.recoveryEnabled) return { raw: 0, proteinDeltaG: 0, reason: null };
  const recentAvg = window.recentLoads.length
    ? mean(window.recentLoads)
    : window.acuteEwma ?? window.dayUtss;
  const recoveryGap = Math.max(0, recentAvg - window.dayUtss);
  const tsbFatigue =
    window.tsb != null && window.tsb < 0 ? clamp01(-window.tsb / TSB_FATIGUE_SCALE) : 0;
  const recoveryIntensity = clamp01(
    recoveryGap / Math.max(reference, recentAvg, 1) + tsbFatigue * 0.5,
  );
  const raw = recoveryGap * slope * RECOVERY_CARB_FACTOR;
  let proteinDeltaG = 0;
  if (baseProteinG != null) {
    const bumpFrac = config.recoveryProteinBumpFrac ?? DEFAULT_RECOVERY_PROTEIN_BUMP_FRAC;
    proteinDeltaG = round1(bumpFrac * baseProteinG * recoveryIntensity);
  }
  const reason = raw > 0 || proteinDeltaG > 0 ? "recovery_topup" : null;
  return { raw, proteinDeltaG, reason };
}

/** Pre-load (future) — fuel ahead of imminent big sessions (proximity-weighted) and
 *  carb-load through race week. Reasons returned in emit order: carb_preload, race_week. */
function computePreload(
  window: TrainingLoadWindow,
  config: PeriodizationConfig,
  baseCarbG: number,
  reference: number,
): { raw: number; reasons: string[] } {
  const reasons: string[] = [];
  let raw = 0;
  const preloadSlope = config.preloadCarbGramsPerUtss ?? 0;
  const horizon = config.preloadDaysAhead ?? 1;
  if (preloadSlope > 0) {
    for (const u of window.upcoming) {
      if (u.daysAhead < 1 || u.daysAhead > horizon) continue;
      const proximity = 1 / u.daysAhead; // the nearer the session, the more we load
      raw += Math.max(0, u.plannedUtss - reference) * preloadSlope * proximity;
    }
    if (raw > 0) reasons.push("carb_preload");
  }
  if (config.phaseAware && window.phase === "race_week") {
    raw += RACE_WEEK_CARB_LOAD_FRAC * baseCarbG;
    reasons.push("race_week");
  }
  return { raw, reasons };
}

/**
 * Training-aware effective target: blend today's load (base), recovery from
 * recent ACTUAL load (past), and pre-loading for upcoming PLANNED load + plan
 * phase (future) into a single carb delta, plus an optional recovery protein
 * bump. Pure and floored/capped; components always sum to the applied carb delta
 * so the UI breakdown is honest. Returns the baseline unchanged when
 * periodisation is off or there is no carb baseline to scale.
 */
export function effectiveTargetWindowed(
  base: BaselineTarget,
  window: TrainingLoadWindow,
  config: PeriodizationConfig,
): EffectiveTargetResult {
  if (!config.enabled || base.carbG == null) {
    return {
      calories: base.calories,
      proteinG: base.proteinG,
      carbG: base.carbG,
      fatG: base.fatG,
      carbDeltaG: 0,
      baseLoadDeltaG: 0,
      recoveryDeltaG: 0,
      preloadDeltaG: 0,
      proteinDeltaG: 0,
      scaled: false,
      reasonCodes: [],
      explanation: "Flat baseline target (no training-load periodisation applied).",
    };
  }

  const { referenceUtss: reference, carbGramsPerUtss: slope } = config;

  // Each window dimension contributes an un-scaled raw carb delta and its own
  // reason code(s); recovery also yields the protein bump.
  const baseLoad = computeBaseLoad(window, config, slope, reference);
  const recovery = computeRecovery(window, config, base.proteinG, slope, reference);
  const preload = computePreload(window, config, base.carbG, reference);
  const proteinDeltaG = recovery.proteinDeltaG;

  // Order matters: taper, recovery_topup, carb_preload, race_week, then the
  // post-combine capped/floored codes pushed below.
  const reasonCodes = [baseLoad.reason, recovery.reason, ...preload.reasons].filter(
    (r): r is string => r != null,
  );

  // Combine, floor carbs at 0, cap the positive addition, and keep the component
  // deltas summing to the applied total so the UI breakdown stays honest.
  const rawSum = baseLoad.raw + recovery.raw + preload.raw;
  const cap = config.maxCarbDeltaG ?? Number.POSITIVE_INFINITY;
  if (cap !== Number.POSITIVE_INFINITY && rawSum > cap) reasonCodes.push("carb_delta_capped");
  const appliedDelta = Math.max(-base.carbG, Math.min(cap, rawSum));
  if (appliedDelta < rawSum && rawSum < 0) reasonCodes.push("carbs_floored");
  const scale = rawSum !== 0 ? appliedDelta / rawSum : 0;

  const baseLoadDeltaG = round1(baseLoad.raw * scale);
  const recoveryDeltaG = round1(recovery.raw * scale);
  const preloadDeltaG = round1(preload.raw * scale);
  const carbDeltaG = round1(baseLoadDeltaG + recoveryDeltaG + preloadDeltaG);
  const newCarbG = Math.max(0, round1(base.carbG + carbDeltaG));

  const carbCalDelta = carbDeltaG * KCAL_PER_G_CARB;
  const proteinCalDelta = proteinDeltaG * KCAL_PER_G_PROTEIN;

  return {
    calories:
      base.calories == null ? null : roundKcal(base.calories + carbCalDelta + proteinCalDelta),
    proteinG: base.proteinG == null ? null : round1(base.proteinG + proteinDeltaG),
    carbG: newCarbG,
    fatG: base.fatG,
    carbDeltaG,
    baseLoadDeltaG,
    recoveryDeltaG,
    preloadDeltaG,
    proteinDeltaG,
    scaled: true,
    reasonCodes,
    explanation: buildEffectiveTargetExplanation({
      carbDeltaG,
      baseLoadDeltaG,
      recoveryDeltaG,
      preloadDeltaG,
      proteinDeltaG,
      phase: window.phase,
      dayUtss: window.dayUtss,
    }),
  };
}

function buildEffectiveTargetExplanation(d: {
  carbDeltaG: number;
  baseLoadDeltaG: number;
  recoveryDeltaG: number;
  preloadDeltaG: number;
  proteinDeltaG: number;
  phase: TrainingPhase | null;
  dayUtss: number;
}): string {
  const parts: string[] = [`today's load (UTSS ${round1(d.dayUtss)}) ${signed(d.baseLoadDeltaG)}g`];
  if (d.recoveryDeltaG !== 0) parts.push(`recovery ${signed(d.recoveryDeltaG)}g`);
  if (d.preloadDeltaG !== 0) parts.push(`fuel-ahead ${signed(d.preloadDeltaG)}g`);
  if (d.proteinDeltaG !== 0) parts.push(`recovery protein ${signed(d.proteinDeltaG)}g`);
  const phaseNote = d.phase ? ` (${d.phase.replace("_", " ")})` : "";
  return `Carbs ${signed(d.carbDeltaG)}g vs baseline${phaseNote}: ${parts.join(", ")}.`;
}

/**
 * Lower bound on the periodisation reference load. Without it, a very small but
 * positive recent average (e.g. a deload week at 2-5 UTSS/day) yields an enormous
 * carb-per-UTSS slope, so a single normal training day would add hundreds of
 * grams of carbs. 25 ≈ a light-but-real daily training load.
 */
const MIN_REFERENCE_UTSS = 25;

/** The persisted shape of a recommended periodisation config (see DB columns on
 *  nutrition_targets). The adaptive knobs default ON so enabling periodisation
 *  gives the full past+future-aware behaviour; the UI can still toggle each off. */
export interface DefaultPeriodizationConfig {
  referenceUtss: number;
  carbGramsPerUtss: number;
  recoveryEnabled: boolean;
  recoveryProteinBumpFrac: number;
  preloadCarbGramsPerUtss: number;
  preloadDaysAhead: number;
  phaseAware: boolean;
  maxCarbDeltaG: number;
}

/**
 * Sensible periodisation defaults derived from a baseline target + the athlete's
 * typical daily load, computed where the target is created (the pure functions
 * above stay config-driven for testability). The slope is half-proportional so a
 * rest day (UTSS 0) keeps roughly half the baseline carbs rather than zero. The
 * reference is floored at MIN_REFERENCE_UTSS so a near-zero recent average can't
 * blow up the slope. The adaptive knobs (recovery / pre-load / phase) come on by
 * default with conservative magnitudes derived from the same baseline.
 */
export function defaultPeriodizationConfig(
  baselineCarbG: number,
  recentAvgDailyUtss: number,
): DefaultPeriodizationConfig {
  const rawReference = recentAvgDailyUtss > 0 ? recentAvgDailyUtss : 50;
  const referenceUtss = round1(Math.max(MIN_REFERENCE_UTSS, rawReference));
  const carbGramsPerUtss = round1((baselineCarbG / referenceUtss) * 0.5);
  return {
    referenceUtss,
    carbGramsPerUtss,
    recoveryEnabled: true,
    recoveryProteinBumpFrac: DEFAULT_RECOVERY_PROTEIN_BUMP_FRAC,
    // Pre-load a touch more gently than same-day load reacts.
    preloadCarbGramsPerUtss: round1(carbGramsPerUtss * 0.5),
    preloadDaysAhead: 1,
    phaseAware: true,
    // Cap the combined positive delta so carbs can't exceed ~1.75× baseline.
    maxCarbDeltaG: round1(baselineCarbG * 0.75),
  };
}
