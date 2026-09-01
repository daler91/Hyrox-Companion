import { addDaysToISODate, computePlanWeeks } from "@shared/dateUtils";
import {
  exerciseSets,
  exerciseSetSchema,
  type GeneratePlanInput,
  type InsertExerciseSet,
  type ParsedExercise,
  type TrainingLoadOverview,
  type TrainingPlanWithDays,
} from "@shared/schema";
import { getStoredDistanceUnit, normalizeParsedDistance, normalizeParsedWeight, normalizeWorkoutTextUnits, standardizeDistanceUnit, standardizeWeightUnit, type UnitPreferences } from "@shared/unitConversion";
import { z } from "zod";

import { generateJsonText } from "../ai/providers";
import { PLAN_GENERATION_AI_TIMEOUT_MS } from "../constants";
import { db } from "../db";
import { AppError, ErrorCode } from "../errors";
import { logger } from "../logger";
import { PLAN_GENERATION_PROMPT, VALID_CATEGORIES, VALID_EXERCISE_NAMES } from "../prompts";
import { storage } from "../storage";
import { getLocalDateStrSafe } from "../timezone";
import { sanitizeUserInput } from "../utils/sanitize";
import { buildLoadAnchors, describeLoadAnchorLines, type LoadAnchor } from "./loadAnchors";
import { calculateTrainingLoad } from "./trainingLoadService";
import { expandExercisesToPlanDaySetRows } from "./workoutService";

const PLAN_GENERATION_CHUNK_WEEKS = 2;
// Look-back window for the athlete's current training-load posture, matching the
// coach/analytics load context.
const LOAD_WINDOW_DAYS = 70;
const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

// Structured exercises the model must include for non-rest generated days.
const generatedExerciseSetSchema = exerciseSetSchema.and(z.object({
  weightUnit: z.string().max(32).optional().nullable(),
  distanceUnit: z.string().max(32).optional().nullable(),
}));

const generatedExerciseSchema = z.object({
  exerciseName: z.string().min(1),
  category: z.string(),
  customLabel: z.string().optional().nullable(),
  confidence: z.number().min(0).max(100).optional().nullable(),
  sets: z.array(generatedExerciseSetSchema).min(1).max(50),
});

// Exercises are validated separately (below) rather than inside this schema
// so a malformed exercise entry does NOT cause us to drop the whole day's
// free-text fallback — the day still renders with focus/mainWorkout/etc.
const generatedDaySchema = z.object({
  weekNumber: z.number().min(1),
  dayName: z.enum(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]),
  focus: z.string().max(255),
  mainWorkout: z.string().max(5000),
  accessory: z.string().max(5000).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

type GeneratedDay = z.infer<typeof generatedDaySchema> & {
  exercises: GeneratedExercise[] | null;
};
type GeneratedExercise = z.infer<typeof generatedExerciseSchema>;

interface WeekRange {
  readonly startWeek: number;
  readonly endWeek: number;
}

function buildWeekRanges(totalWeeks: number): WeekRange[] {
  const ranges: WeekRange[] = [];
  for (let startWeek = 1; startWeek <= totalWeeks; startWeek += PLAN_GENERATION_CHUNK_WEEKS) {
    ranges.push({
      startWeek,
      endWeek: Math.min(totalWeeks, startWeek + PLAN_GENERATION_CHUNK_WEEKS - 1),
    });
  }
  return ranges;
}

function formatWeekRange(range: WeekRange): string {
  return range.startWeek === range.endWeek
    ? `week ${range.startWeek}`
    : `weeks ${range.startWeek}-${range.endWeek}`;
}

function buildGenerationUnitLines(unitPreferences: Required<UnitPreferences>): string[] {
  const weightUnit = standardizeWeightUnit(unitPreferences.weightUnit);
  const distanceUnit = standardizeDistanceUnit(unitPreferences.distanceUnit);
  const storedDistanceUnit = getStoredDistanceUnit(distanceUnit);
  const distanceTextInstruction = distanceUnit === "miles"
    ? "Use miles/mi in mainWorkout/accessory for running distances and feet/ft for short station distances."
    : "Use kilometers/km for longer running distances and meters/m for station distances.";
  const structuredDistanceInstruction = storedDistanceUnit === "ft"
    ? "Structured exercise distance values should use feet (ft) unless mirroring an explicit text unit; if a row uses km/mi/m/ft, label the numeric value with its actual distanceUnit so the server can normalize it."
    : "Structured exercise distance values should use meters (m) unless mirroring an explicit text unit; if a row uses km/mi/m/ft, label the numeric value with its actual distanceUnit so the server can normalize it.";
  return [
    ``,
    `ATHLETE UNIT PREFERENCES:`,
    `- Weight: ${weightUnit}. Use ${weightUnit} in mainWorkout/accessory. Include weightUnit on every structured weight, matching the numeric value's actual unit.`,
    `- Distance preference: ${distanceUnit}. ${distanceTextInstruction}`,
    `- ${structuredDistanceInstruction}`,
  ];
}

/** A declared absence mapped onto the plan's own week/day coordinates. */
export interface GenerationAbsence {
  /** Fully rendered prompt line, athlete note already sanitised. */
  line: string;
  /** First and last PLAN WEEK the absence touches, for chunk filtering. */
  startWeek: number;
  endWeek: number;
}

const ABSENCE_TYPE_LABELS: Record<string, string> = {
  injury: "Injury",
  illness: "Illness",
  travel: "Travel",
  rest: "Planned rest",
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Map the athlete's declared absences onto the plan being generated.
 *
 * The model thinks in "Week N, Tuesday", not in dates — its output has no date
 * field at all — so date ranges are translated server-side using the same
 * anchoring `schedulePlan` will apply afterwards: week 1 is the Monday-anchored
 * week containing the start date, Monday first. Doing the arithmetic here keeps
 * it deterministic and testable instead of asking the model to convert dates.
 *
 * Absences that miss the plan window entirely (including anything wholly in
 * the past) drop out via the overlap test.
 */
export function buildGenerationAbsences(
  annotations: readonly { startDate: string; endDate: string; type: string; note: string | null }[],
  planStartDate: string,
  totalWeeks: number,
): GenerationAbsence[] {
  const startDayOfWeek = new Date(`${planStartDate}T00:00:00Z`).getUTCDay();
  const mondayOffset = startDayOfWeek === 0 ? -6 : 1 - startDayOfWeek;
  const weekOneMonday = addDaysToISODate(planStartDate, mondayOffset);
  const windowEnd = addDaysToISODate(weekOneMonday, totalWeeks * 7 - 1);

  const weekOneMondayMs = Date.parse(`${weekOneMonday}T00:00:00Z`);
  const planCoordinate = (date: string) => {
    const offset = Math.round((Date.parse(`${date}T00:00:00Z`) - weekOneMondayMs) / MS_PER_DAY);
    return { week: Math.floor(offset / 7) + 1, dayName: DAY_NAMES[offset % 7] };
  };

  return annotations
    .filter((a) => a.startDate <= windowEnd && a.endDate >= weekOneMonday)
    .map((a) => {
      // Coordinates come from the clamped overlap so a range that started
      // before the plan reads as "from week 1 Monday", not week -3.
      const from = planCoordinate(a.startDate < weekOneMonday ? weekOneMonday : a.startDate);
      const to = planCoordinate(a.endDate > windowEnd ? windowEnd : a.endDate);
      const label = ABSENCE_TYPE_LABELS[a.type] ?? a.type;
      const span =
        from.week === to.week && from.dayName === to.dayName
          ? `week ${from.week} ${from.dayName}`
          : `week ${from.week} ${from.dayName} through week ${to.week} ${to.dayName}`;
      const note = a.note?.trim();
      const noteSuffix = note ? ` — "${sanitizeUserInput(note)}"` : "";
      return {
        line: `- ${label}, ${a.startDate} to ${a.endDate} (plan ${span})${noteSuffix}`,
        startWeek: from.week,
        endWeek: to.week,
      };
    });
}

/** What generation knows about the athlete's current loads. `startLoadPosture`
 *  calibrates only the opening week; `loadAnchors` go to EVERY chunk — they are
 *  the shared state that makes parallel chunks agree (audit H17/M7). */
export interface GenerationCalibration {
  readonly startLoadPosture: string | null;
  readonly loadAnchors: readonly LoadAnchor[];
}

export function buildGenerationPrompt(input: NormalizedGeneratePlanInput, range: WeekRange, unitPreferences: Required<UnitPreferences>, calibration?: GenerationCalibration | null, absences?: readonly GenerationAbsence[]): string {
  const weeksInChunk = range.endWeek - range.startWeek + 1;
  const lines: string[] = [
    `Generate ${formatWeekRange(range)} of a ${input.totalWeeks}-week training plan with ${input.daysPerWeek} training days per week.`,
    `This is one chunk of a larger plan. Return ONLY ${formatWeekRange(range)} and use weekNumber values ${range.startWeek} through ${range.endWeek}.`,
    ``,
    `ATHLETE PROFILE:`,
    `- Goal: ${input.goal}`,
    `- Experience Level: ${input.experienceLevel}`,
    `- Training Days Per Week: ${input.daysPerWeek}`,
    `- Total Weeks: ${input.totalWeeks}`,
  ];

  lines.push(...buildGenerationUnitLines(unitPreferences));

  if (input.raceDate) {
    lines.push(
      `- Race Date: ${input.raceDate} (structure phases to peak for this date; taper the final 1-2 days into a light shakeout/rest, and treat race day itself as the event — not a training session)`,
    );
  }

  if (input.focusAreas && input.focusAreas.length > 0) {
    lines.push(`- Focus Areas: ${input.focusAreas.join(", ")} (prioritize these in programming)`);
  }

  if (input.injuries) {
    // Sanitised like every other free-text interpolation in the prompt builders
    // (see server/prompts/coachingContext.ts) — this one was the exception.
    lines.push(`- Injuries/Limitations: ${sanitizeUserInput(input.injuries)} (avoid exercises that aggravate these)`);
  }

  if (input.restDays && input.restDays.length > 0) {
    lines.push(`- Rest Days: ${input.restDays.join(", ")} (these MUST be rest days every week, schedule all training on the remaining days)`);
  }

  // Current load posture only calibrates the opening week, so attach it to the
  // chunk that contains week 1; later chunks follow the normal phase structure.
  // Only the absences touching THIS chunk's weeks: each chunk is its own model
  // call, and telling it about a week it isn't generating is prompt noise.
  const chunkAbsences = (absences ?? []).filter(
    (a) => a.startWeek <= range.endWeek && a.endWeek >= range.startWeek,
  );
  if (chunkAbsences.length > 0) {
    lines.push(
      ``,
      `DECLARED ABSENCES (athlete-logged dates they will not train normally):`,
      ...chunkAbsences.map((a) => a.line),
      `Schedule rest days or easy/portable sessions across those days — never key sessions. After an injury or illness range, keep the first sessions back conservative.`,
    );
  }

  if (range.startWeek === 1 && calibration?.startLoadPosture) {
    lines.push(``, `CURRENT LOAD POSTURE:`, `- ${calibration.startLoadPosture}`);
  }

  // Unlike the posture line, the anchors go to EVERY chunk: they are the one
  // piece of shared state that lets parallel calls produce continuous loads
  // (audit H17/M7). A chunk generating weeks 5-6 has no other way to know what
  // weeks 1-4 prescribe.
  if (calibration && calibration.loadAnchors.length > 0) {
    lines.push(
      ...describeLoadAnchorLines(calibration.loadAnchors, standardizeWeightUnit(unitPreferences.weightUnit)),
    );
  }

  // Include rest days in the total
  const restDaysPerWeek = 7 - input.daysPerWeek;
  lines.push(
    ``,
    `Generate ${weeksInChunk * 7} day entries for ${formatWeekRange(range)} (${input.daysPerWeek} training + ${restDaysPerWeek} rest per week).`,
    `Each week in this chunk MUST include all seven dayName values exactly once.`,
    `Return the complete JSON array for ONLY ${formatWeekRange(range)}.`,
  );

  return lines.join("\n");
}

// Normalize a single AI-returned exercise into the ParsedExercise shape the
// rest of the backend already consumes. Mirrors the hardening in
// `exerciseParser.ts`: unknown exerciseName collapses to "custom" + a
// customLabel, an empty label triggers low-confidence so the UI can prompt
// for review.
// Plain text rendered via React — no HTML encoding needed. See
// exerciseParser.ts sanitizeLabel for the rationale.
function sanitizeLabel(v: string): string {
  return v.replaceAll("&", "and");
}

function defaultConfidence(isKnown: boolean): number {
  return isKnown ? 95 : 50;
}

function resolveGeneratedConfidence(raw: GeneratedExercise, isKnown: boolean): number {
  if (typeof raw.confidence === "number") {
    return Math.min(100, Math.max(0, Math.round(raw.confidence)));
  }
  return defaultConfidence(isKnown);
}

function normalizeGeneratedExercise(raw: GeneratedExercise, unitPreferences: UnitPreferences): ParsedExercise {
  const isKnown = VALID_EXERCISE_NAMES.has(raw.exerciseName) && raw.exerciseName !== "custom";
  const validCategory = VALID_CATEGORIES.has(raw.category);
  let confidence = resolveGeneratedConfidence(raw, isKnown);

  let customLabel: string | undefined;
  if (isKnown) {
    customLabel = raw.customLabel ? sanitizeLabel(raw.customLabel) : undefined;
  } else {
    const label =
      (raw.customLabel && raw.customLabel.trim().length > 0 && raw.customLabel) ||
      (raw.exerciseName !== "custom" && raw.exerciseName.trim().length > 0 && raw.exerciseName) ||
      "Unknown exercise";
    customLabel = sanitizeLabel(label);
    if (!raw.customLabel || raw.customLabel.trim().length === 0) {
      confidence = Math.min(confidence, 40);
    }
  }

  return {
    exerciseName: isKnown ? sanitizeLabel(raw.exerciseName) : "custom",
    category: validCategory ? sanitizeLabel(raw.category) : "conditioning",
    customLabel,
    confidence,
    sets: raw.sets.map((s, i) => ({
      setNumber: s.setNumber ?? i + 1,
      ...(s.reps != null && { reps: s.reps }),
      ...(s.weight != null && { weight: normalizeParsedWeight(s.weight, s.weightUnit, unitPreferences) }),
      ...(s.distance != null && { distance: normalizeParsedDistance(s.distance, s.distanceUnit, unitPreferences) }),
      ...(s.time != null && { time: s.time }),
      ...(s.notes != null && { notes: sanitizeLabel(s.notes) }),
    })),
  };
}

// Validate the exercises array on a raw day. Individual malformed exercises
// are dropped with a warning; the caller decides whether an empty result is
// valid for this day.
function validateDayExercises(rawDay: Record<string, unknown> | null | undefined): GeneratedExercise[] | null {
  const raw = rawDay?.exercises;
  if (!Array.isArray(raw)) return null;
  const validated: GeneratedExercise[] = [];
  for (let i = 0; i < raw.length; i++) {
    const result = generatedExerciseSchema.safeParse(raw[i]);
    if (result.success) {
      validated.push(result.data);
    } else {
      logger.warn(
        { issues: result.error.issues, index: i },
        "[planGen] Dropping invalid exercise entry",
      );
    }
  }
  return validated;
}

function parseAndValidateDays(text: string): GeneratedDay[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    logger.error({ responseLength: text.length }, "[planGen] JSON parse failed");
    throw new AppError(ErrorCode.AI_ERROR, "Failed to parse AI response as JSON", 502);
  }

  if (!Array.isArray(raw)) {
    throw new TypeError("AI response is not an array");
  }

  const validated: GeneratedDay[] = [];
  for (const item of raw) {
    const result = generatedDaySchema.safeParse(item);
    if (result.success) {
      const exercises = validateDayExercises(item as Record<string, unknown>);
      validated.push({
        ...result.data,
        focus: result.data.focus.replaceAll("&", "and"),
        mainWorkout: result.data.mainWorkout.replaceAll("&", "and"),
        accessory: result.data.accessory ? result.data.accessory.replaceAll("&", "and") : null,
        notes: result.data.notes ? result.data.notes.replaceAll("&", "and") : null,
        exercises,
      });
    } else {
      logger.warn(
        { issues: result.error.issues },
        "[planGen] Dropping invalid day",
      );
    }
  }

  return validated;
}

function isGeneratedRestDay(day: Pick<GeneratedDay, "focus" | "mainWorkout">): boolean {
  return day.focus.trim().toLowerCase() === "rest" ||
    day.mainWorkout.trim().toLowerCase() === "complete rest";
}

/**
 * The week-over-week weight ceiling the plan prompt states as prose:
 * "BUILD (25-60%): Progressive overload. Increase weights 2.5-5% per week."
 *
 * Nothing in code enforced it, and for a long time nothing could: chunks are
 * generated by PARALLEL model calls, so no single call can see the previous
 * chunk's loads and a rule stated relative to "last week" is unenforceable
 * across a chunk boundary by construction (audit H17). Compounded, the
 * difference matters — 5%/week is 1.48x over an 8-week build block and 3.56x
 * over 26 weeks, turning a 100 kg squat into 356 kg (audit M7).
 *
 * Since 2026-08-30 the rule is also STATEABLE at generation time: every chunk
 * receives the same per-exercise load anchors (see `loadAnchors.ts`) and a
 * ramp expressed relative to them, which a parallel call CAN evaluate alone.
 * The anchors make chunks agree in expectation; the clamp below remains the
 * guarantee, and also covers athletes with no history to anchor on.
 *
 * A little headroom over 5% absorbs rounding to real plate increments (a 2.5 kg
 * jump on a 40 kg lift is 6.25%).
 */
const MAX_WEEKLY_WEIGHT_INCREASE_PCT = 8;
/** Below this, plate rounding dominates and the percentage is meaningless. */
const MIN_TRACKED_WEIGHT = 10;

/** Slack for comparing a computed percentage against a ceiling. See its use below. */
const PCT_COMPARISON_EPSILON = 1e-9;

export interface ProgressiveOverloadViolation {
  exerciseName: string;
  fromWeek: number;
  toWeek: number;
  fromWeight: number;
  toWeight: number;
  increasePct: number;
}

/**
 * Week-over-week weight jumps that exceed the ceiling, per exercise.
 *
 * Compares each exercise's heaviest prescribed set in consecutive weeks that
 * BOTH prescribe it. A week that drops weight is never a violation — that is a
 * deload, which the same prompt asks for.
 */
/** exerciseName -> weekNumber -> heaviest prescribed weight that week. */
function collectHeaviestWeightsByWeek(days: readonly GeneratedDay[]): Map<string, Map<number, number>> {
  const byExercise = new Map<string, Map<number, number>>();
  for (const day of days) {
    for (const exercise of day.exercises ?? []) {
      for (const set of exercise.sets ?? []) {
        const weight = typeof set.weight === "number" ? set.weight : null;
        if (weight == null || weight < MIN_TRACKED_WEIGHT) continue;
        const weeks = byExercise.get(exercise.exerciseName) ?? new Map<number, number>();
        weeks.set(day.weekNumber, Math.max(weeks.get(day.weekNumber) ?? 0, weight));
        byExercise.set(exercise.exerciseName, weeks);
      }
    }
  }
  return byExercise;
}

export function findProgressiveOverloadViolations(
  days: readonly GeneratedDay[],
  maxIncreasePct: number = MAX_WEEKLY_WEIGHT_INCREASE_PCT,
): ProgressiveOverloadViolation[] {
  const byExercise = collectHeaviestWeightsByWeek(days);
  const violations: ProgressiveOverloadViolation[] = [];
  for (const [exerciseName, weeks] of byExercise) {
    const ordered = [...weeks.keys()].sort((a, b) => a - b);
    for (let i = 1; i < ordered.length; i++) {
      const fromWeek = ordered[i - 1];
      const toWeek = ordered[i];
      // Only adjacent weeks: a gap means the exercise was not prescribed in
      // between, and a jump across a rest period is not a weekly increase.
      if (toWeek !== fromWeek + 1) continue;
      const fromWeight = weeks.get(fromWeek)!;
      const toWeight = weeks.get(toWeek)!;
      if (toWeight <= fromWeight) continue;
      const increasePct = ((toWeight - fromWeight) / fromWeight) * 100;
      // Epsilon because increasePct is a ratio of differences and carries float
      // noise: a weight sitting EXACTLY on the ceiling measures 8.000000000000002
      // against a ceiling of 8 and was flagged as a violation of itself. The
      // ceiling is inclusive — "increase weights up to 8%" permits 8% — so the
      // boundary must not be decided by representation (same class as audit L2).
      if (increasePct > maxIncreasePct + PCT_COMPARISON_EPSILON) {
        violations.push({
          exerciseName,
          fromWeek,
          toWeek,
          fromWeight,
          toWeight,
          increasePct: Math.round(increasePct * 10) / 10,
        });
      }
    }
  }
  return violations.sort((a, b) => b.increasePct - a.increasePct);
}

/** One exercise-week whose prescribed weight was reduced to the ceiling. */
export interface ProgressiveOverloadClamp {
  exerciseName: string;
  weekNumber: number;
  fromWeight: number;
  toWeight: number;
  ceiling: number;
}

/**
 * Reduce week-over-week weight jumps that break the ceiling the generation
 * prompt asks for, in place, and report what moved.
 *
 * Walks each exercise's weeks in order and carries the CLAMPED weight forward as
 * the next week's basis. Clamping against the model's original number instead
 * would let a run of violations compound: clamp week 2 from 130 to 108, and a
 * week 3 of 150 is still measured against 130 and still ships over the ceiling.
 *
 * Only sets ABOVE the ceiling move. Scaling the whole week proportionally would
 * preserve its internal shape but drag warmup sets down too, turning a clamp
 * into an unasked-for deload. The ceiling is floored to one decimal so the
 * result can never round back above it.
 */
export function clampProgressiveOverload(
  days: readonly GeneratedDay[],
  maxIncreasePct: number = MAX_WEEKLY_WEIGHT_INCREASE_PCT,
): ProgressiveOverloadClamp[] {
  const clamps: ProgressiveOverloadClamp[] = [];
  const weeksByExercise = collectHeaviestWeightsByWeek(days);

  for (const [exerciseName, weeks] of weeksByExercise) {
    let previousWeek: number | null = null;
    let previousMax: number | null = null;

    for (const weekNumber of [...weeks.keys()].sort((a, b) => a - b)) {
      let heaviest = weeks.get(weekNumber)!;

      if (previousMax != null && previousWeek != null && weekNumber === previousWeek + 1) {
        const ceiling = Math.floor(previousMax * (1 + maxIncreasePct / 100) * 10) / 10;
        if (heaviest > ceiling) {
          clamps.push({ exerciseName, weekNumber, fromWeight: heaviest, toWeight: ceiling, ceiling });
          applyWeightCeiling(days, exerciseName, weekNumber, ceiling);
          heaviest = ceiling;
        }
      }

      previousWeek = weekNumber;
      previousMax = heaviest;
    }
  }

  return clamps;
}

type GeneratedExerciseSet = NonNullable<NonNullable<GeneratedDay["exercises"]>[number]["sets"]>[number];

/** Lower every set of `exerciseName` in `weekNumber` that sits above `ceiling`. */
function applyWeightCeiling(
  days: readonly GeneratedDay[],
  exerciseName: string,
  weekNumber: number,
  ceiling: number,
): void {
  for (const day of days) {
    if (day.weekNumber !== weekNumber) continue;
    for (const exercise of day.exercises ?? []) {
      if (exercise.exerciseName === exerciseName) capSetWeights(exercise.sets ?? [], ceiling);
    }
  }
}

/** Split out to keep `applyWeightCeiling` under the cognitive-complexity ceiling. */
function capSetWeights(sets: GeneratedExerciseSet[], ceiling: number): void {
  for (const set of sets) {
    if (typeof set.weight === "number" && set.weight > ceiling) set.weight = ceiling;
  }
}

function assertTableFirstGeneratedDays(days: GeneratedDay[]): void {
  const missingExerciseDays = days
    .filter((day) => !isGeneratedRestDay(day) && (!day.exercises || day.exercises.length === 0))
    .map((day) => `${day.weekNumber} ${day.dayName}`);

  if (missingExerciseDays.length > 0) {
    throw new AppError(
      ErrorCode.AI_ERROR,
      "AI generated one or more training days without exercise-table rows. Please try again.",
      502,
      { missingExerciseDays },
    );
  }
}

function validateAndOrderGeneratedDays(days: GeneratedDay[], totalWeeks: number): GeneratedDay[] {
  const daysByWeek = new Map<number, Map<(typeof DAY_NAMES)[number], GeneratedDay>>();
  const invalidWeeks: number[] = [];
  const duplicates: string[] = [];

  for (const day of days) {
    if (day.weekNumber < 1 || day.weekNumber > totalWeeks) {
      invalidWeeks.push(day.weekNumber);
      continue;
    }
    const weekDays = daysByWeek.get(day.weekNumber) ?? new Map<(typeof DAY_NAMES)[number], GeneratedDay>();
    if (weekDays.has(day.dayName)) {
      duplicates.push(`${day.weekNumber} ${day.dayName}`);
    }
    weekDays.set(day.dayName, day);
    daysByWeek.set(day.weekNumber, weekDays);
  }

  const missingDays: string[] = [];
  for (let weekNumber = 1; weekNumber <= totalWeeks; weekNumber++) {
    const weekDays = daysByWeek.get(weekNumber);
    for (const dayName of DAY_NAMES) {
      if (!weekDays?.has(dayName)) {
        missingDays.push(`${weekNumber} ${dayName}`);
      }
    }
  }

  if (invalidWeeks.length > 0 || duplicates.length > 0 || missingDays.length > 0) {
    throw new AppError(
      ErrorCode.AI_ERROR,
      "AI generated incomplete plan coverage. Please try again.",
      502,
      { invalidWeeks, duplicates, missingDays },
    );
  }

  return Array.from({ length: totalWeeks }, (_, index) => index + 1)
    .flatMap((weekNumber) => {
      const weekDays = daysByWeek.get(weekNumber);
      return DAY_NAMES.map((dayName) => weekDays!.get(dayName)!);
    });
}

async function generatePlanChunk(
  input: NormalizedGeneratePlanInput,
  userId: string,
  range: WeekRange,
  unitPreferences: Required<UnitPreferences>,
  calibration: GenerationCalibration | null,
  absences: readonly GenerationAbsence[],
  signal?: AbortSignal,
): Promise<GeneratedDay[]> {
  const prompt = buildGenerationPrompt(input, range, unitPreferences, calibration, absences);
  const label = `planGeneration:w${range.startWeek}-${range.endWeek}`;

  const response = await generateJsonText({
    systemInstruction: PLAN_GENERATION_PROMPT,
    messages: [{ role: "user", content: prompt }],
    modelRole: "reasoning",
    label,
    feature: "plan_generation",
    userId,
    signal,
    timeoutMs: PLAN_GENERATION_AI_TIMEOUT_MS,
  });

  const text = response.text || "[]";
  return parseAndValidateDays(text);
}

async function generatePlanDays(
  input: NormalizedGeneratePlanInput,
  userId: string,
  unitPreferences: Required<UnitPreferences>,
  calibration: GenerationCalibration | null,
  absences: readonly GenerationAbsence[],
  signal?: AbortSignal,
): Promise<GeneratedDay[]> {
  const ranges = buildWeekRanges(input.totalWeeks);
  const dayChunks = await Promise.all(
    ranges.map((range) => generatePlanChunk(input, userId, range, unitPreferences, calibration, absences, signal)),
  );
  const days = validateAndOrderGeneratedDays(dayChunks.flat(), input.totalWeeks);
  if (days.length === 0) {
    throw new AppError(ErrorCode.AI_ERROR, "AI generated no valid plan days", 502);
  }
  assertTableFirstGeneratedDays(days);

  // The progressive-overload ceiling is ENFORCED BY CLAMPING (audit H17, M7).
  // Rejecting would make the athlete wait out another model round-trip for a
  // fault that is not theirs, and a persistent violation could loop; logging
  // alone still shipped the unsafe jump. Clamping hands them a usable plan that
  // never prescribes a jump past the ceiling its own prompt asked for.
  //
  // The trade-off, recorded because it is real: the numbers no longer match what
  // the model wrote, so a coaching rationale referring to a specific load can
  // disagree with the set it describes. Everything clamped is logged.
  const overloadViolations = findProgressiveOverloadViolations(days);
  const overloadClamps = clampProgressiveOverload(days);
  if (overloadViolations.length > 0) {
    // Carries neither the athlete's id nor their prescribed loads. The logger
    // mixin omits userId on purpose (see the S2 note in server/logger.ts) and
    // injects a requestId instead, which is what correlates this line back to a
    // generation. The absolute kg say nothing about whether the PROMPT is asking
    // for jumps that are too big — the percentage is the whole signal. Bounded
    // to five so a long plan cannot emit a very large log line.
    //
    // What is left is two static strings, a plan length, a count, and up to five
    // EXERCISE names with week numbers and a percentage. Bearer raises this rule
    // on the shape rather than the content — it fires on a fixed enum in
    // recomputeAnalyticsDispatch and on pure row counts in keyRotation — so it is
    // suppressed here, the same way structuredExerciseHealth suppresses it on an
    // identically shaped counter warning. Nothing may follow the rule id on the
    // directive line: Bearer splits the rest of the line into the rule-id list,
    // so a trailing justification silently no-ops the suppression.
    // bearer:disable javascript_lang_logger_leak
    logger.warn(
      {
        context: "plan-generation",
        event: "progressive_overload_ceiling_exceeded",
        totalWeeks: input.totalWeeks,
        violationCount: overloadViolations.length,
        clampedCount: overloadClamps.length,
        worst: overloadViolations
          .slice(0, 5)
          .map(({ exerciseName, fromWeek, toWeek, increasePct }) => ({
            exerciseName,
            fromWeek,
            toWeek,
            increasePct,
          })),
      },
      "Generated plan exceeded the week-over-week weight ceiling; clamped to it.",
    );
  }

  return days;
}

// Fallback only for a legacy queued job that predates the start/end-date rename
// and therefore lacks a date span (matches the old schema default of 8 weeks).
const LEGACY_DEFAULT_WEEKS = 8;

// During generation we work with the input enriched with two DERIVED values:
//   - totalWeeks: computed from the start → end span (no longer user-entered)
//   - raceDate:   the end date, but only when flagged as the athlete's race day
// Carrying them on one object keeps the prompt/chunking code below unchanged.
type NormalizedGeneratePlanInput = GeneratePlanInput & {
  totalWeeks: number;
  raceDate?: string;
};

// Shape of a plan-generation job enqueued by a PREVIOUS server version. Such a
// job can sit in the durable queue across a deploy and reach executePlanGeneration
// with the old field names. Reading through this view lets those in-flight jobs
// still complete. Remove once the queue has fully drained post-deploy.
interface LegacyGeneratePlanInput {
  totalWeeks?: number;
  raceDate?: string;
  startDate?: string;
  endDate?: string;
  endDateIsRaceDate?: boolean;
}

function normalizeGeneratePlanInput(input: GeneratePlanInput): NormalizedGeneratePlanInput {
  const raw = input as LegacyGeneratePlanInput;
  const totalWeeks =
    raw.startDate && raw.endDate
      ? computePlanWeeks(raw.startDate, raw.endDate)
      : (raw.totalWeeks ?? LEGACY_DEFAULT_WEEKS);
  // raceDate drives the "peak for this date" prompt line and is persisted on the
  // plan. New inputs set it only when the athlete flags the end date as their race
  // day; legacy inputs carried it as its own field.
  let raceDate: string | undefined;
  if (raw.endDate) {
    raceDate = raw.endDateIsRaceDate ? raw.endDate : undefined;
  } else {
    raceDate = raw.raceDate;
  }
  return { ...input, totalWeeks, raceDate };
}

export async function createPendingPlan(
  input: GeneratePlanInput,
  userId: string,
): Promise<TrainingPlanWithDays> {
  const { totalWeeks, raceDate } = normalizeGeneratePlanInput(input);
  const planName = `AI Plan: ${input.goal.slice(0, 80)}`;
  const plan = await storage.plans.createTrainingPlan({
    userId,
    name: planName,
    sourceFileName: null,
    totalWeeks,
    goal: input.goal,
    // Captured at creation so it survives schedulePlan overwriting start/end dates.
    raceDate: raceDate ?? null,
    generationStatus: "pending",
  });
  return { ...plan, days: [] };
}

/**
 * Turn the athlete's current training-load posture into one line of opening-week
 * calibration guidance for the generator, or null when no special handling is
 * warranted (sweet spot / not enough history). Exported for testing.
 */
export function describeStartLoadPosture(overview: TrainingLoadOverview): string | null {
  const acwr = overview.acwr != null ? ` (ACWR ${overview.acwr.toFixed(2)})` : "";
  switch (overview.zone) {
    case "danger":
      return `The athlete is carrying high recent load${acwr} and is currently fatigued. Start week 1 conservatively — moderate volume and intensity, no peak or simulation sessions in the first few days — and let them absorb load before ramping.`;
    case "yellow":
      return `The athlete's recent load is elevated${acwr}. Ease into week 1 (trim volume on the hardest sessions) before progressing normally.`;
    case "undertraining":
      return `The athlete is currently detrained / below their 28-day baseline${acwr}. Ramp volume gently across the first 1-2 weeks instead of starting at full prescription.`;
    default:
      return null; // sweet_spot / insufficient_data ⇒ no special calibration
  }
}

// Compute the athlete's generation calibration from recent history: the
// qualitative posture line for week 1, and the per-exercise load anchors every
// chunk receives (audit H17/M7 — the sets were already being fetched here and
// used only for the posture sentence). Degrades to null (plan generated
// without calibration) on any failure — never blocks plan generation.
async function computeGenerationCalibration(
  userId: string,
  user: Awaited<ReturnType<typeof storage.users.getUser>>,
): Promise<GenerationCalibration | null> {
  try {
    // The athlete's calendar date, not the server's: a UTC "today" put the
    // load window a day off for everyone west of Greenwich, so the posture and
    // anchors the plan was calibrated from lagged the schedule it was written
    // against (resolveUserTodayForPlan makes the same call for the schedule).
    const today = getLocalDateStrSafe(new Date(), user?.userTimezone);
    const from = addDaysToISODate(today, -LOAD_WINDOW_DAYS);
    const [workoutLogs, loadExerciseSets, loadTags] = await Promise.all([
      storage.analytics.getWorkoutLogsByDateRange(userId, from, today),
      storage.analytics.getAllExerciseSetsWithDates(userId, from, today),
      storage.analytics.getExerciseLoadTags(),
    ]);
    const { overview } = calculateTrainingLoad(workoutLogs, loadExerciseSets, loadTags, {
      currentDate: today,
      weightUnit: user?.weightUnit || "kg",
      athlete: {
        age: user?.age ?? null,
        gender: user?.gender ?? null,
        restingHr: user?.restingHr ?? null,
        // Scales unweighted-rep tonnage with the body being moved (audit M2).
        bodyweightKg: user?.bodyweightKg ?? null,
        maxHr: user?.maxHr ?? null,
        ftp: user?.ftp ?? null,
      },
    });
    return {
      startLoadPosture: describeStartLoadPosture(overview),
      loadAnchors: buildLoadAnchors(loadExerciseSets, standardizeWeightUnit(user?.weightUnit)),
    };
  } catch {
    logger.warn("[planGen] load calibration unavailable; generating without it.");
    return null;
  }
}

/**
 * The athlete's own calendar date. A UTC "today" would retire a plan a day early
 * for anyone west of Greenwich — the same reasoning as PlanStorage.resolveUserToday.
 */
async function resolveUserTodayForPlan(userId: string): Promise<string> {
  const user = await storage.users.getUser(userId);
  return getLocalDateStrSafe(new Date(), user?.userTimezone);
}

export async function executePlanGeneration(
  planId: string,
  input: GeneratePlanInput,
  userId: string,
  signal?: AbortSignal,
): Promise<void> {
  const normalized = normalizeGeneratePlanInput(input);
  logger.info(
    { userId, planId, totalWeeks: normalized.totalWeeks, daysPerWeek: input.daysPerWeek, experienceLevel: input.experienceLevel },
    "[planGen] Generating AI training plan",
  );

  await storage.plans.updateGenerationStatus(planId, "generating");

  try {
    const user = await storage.users.getUser(userId);
    const unitPreferences = {
      weightUnit: standardizeWeightUnit(user?.weightUnit),
      distanceUnit: standardizeDistanceUnit(user?.distanceUnit),
    };
    const calibration = await computeGenerationCalibration(userId, user);
    // Declared absences inside the plan window, so the generator schedules
    // around a booked travel week instead of programming straight over it.
    // startDate is absent only for a legacy queued job (same guard as
    // scheduling below) — with no calendar anchor there is nothing to map.
    const absences = normalized.startDate
      ? buildGenerationAbsences(
          await storage.timelineAnnotations.list(userId),
          normalized.startDate,
          normalized.totalWeeks,
        )
      : [];
    const days = await generatePlanDays(normalized, userId, unitPreferences, calibration, absences, signal);

    // Plan days and their structured exercise sets are written inside a single
    // transaction so a failure in any step rolls the whole insertion back.
    const { daysWithExercises, totalSetRows } = await db.transaction(async (tx) => {
      const planDaysPayload = days.map((day) => ({
        planId,
        weekNumber: day.weekNumber,
        dayName: day.dayName,
        focus: day.focus,
        mainWorkout: normalizeWorkoutTextUnits(day.mainWorkout, unitPreferences) ?? day.mainWorkout,
        accessory: normalizeWorkoutTextUnits(day.accessory || null, unitPreferences) || null,
        notes: day.notes || null,
        status: "planned" as const,
        aiSource: "generated" as const,
      }));

      const createdPlanDays = await storage.plans.createPlanDays(planDaysPayload, tx);

      if (createdPlanDays.length !== planDaysPayload.length) {
        throw new AppError(
          ErrorCode.INTERNAL_ERROR,
          "createPlanDays returned unexpected row count",
          500,
        );
      }

      const allSetRows: InsertExerciseSet[] = [];
      let dwe = 0;
      for (let i = 0; i < days.length; i++) {
        const day = days[i];
        if (!day.exercises || day.exercises.length === 0) continue;
        const pd = createdPlanDays[i];
        const normalised = day.exercises.map((exercise) => normalizeGeneratedExercise(exercise, unitPreferences));
        allSetRows.push(...expandExercisesToPlanDaySetRows(normalised, pd.id, unitPreferences));
        dwe++;
      }

      if (allSetRows.length > 0) {
        await tx.insert(exerciseSets).values(allSetRows);
      }

      return { daysWithExercises: dwe, totalSetRows: allSetRows.length };
    });

    logger.info(
      { userId, planId, daysWithExercises, totalSetRows, totalDays: days.length },
      "[planGen] Persisted structured plan-day exercises",
    );

    // Every plan now carries a start date (the form requires one), so the plan is
    // always scheduled onto the calendar. startDate is absent only for a legacy
    // in-flight queued job, hence the guard.
    const scheduleStartDate: string | undefined = normalized.startDate;
    if (scheduleStartDate) {
      await storage.plans.schedulePlan(planId, scheduleStartDate, userId);
    }

    // Retire the plans the athlete is switching away from, and publish this one,
    // in ONE transaction — and only HERE, at the very end of a successful
    // generation.
    //
    // The ordering is load-bearing. A new plan has no start or end date until
    // schedulePlan runs just above, and getPlanForDate ignores plans without
    // both. Retiring the old plan any earlier — in the route, before the job is
    // even enqueued — means a generation that fails or times out leaves the
    // athlete with the old plan retired and the new one unusable: no active plan
    // at all. Doing it from the client after polling for `ready` is no better; a
    // closed tab silently skips it. Here, any throw lands in the catch below,
    // which marks this plan `failed`, and the transaction never commits, so the
    // old plan is untouched and remains exactly what the athlete is training.
    //
    // Effective from the later of the new plan's start and today: a start date
    // in the past must not retroactively unattribute workouts already logged
    // against the old plan. A start date in the FUTURE is the nice case — the
    // old plan legitimately stays active until the new one begins, with no
    // cutover job to run.
    const supersedeIds = (normalized.supersedePlanIds ?? []).filter((id) => id !== planId);
    await db.transaction(async (tx) => {
      if (scheduleStartDate && supersedeIds.length > 0) {
        const today = await resolveUserTodayForPlan(userId);
        const effectiveFrom = scheduleStartDate > today ? scheduleStartDate : today;
        const retired = await storage.plans.retirePlans(supersedeIds, userId, effectiveFrom, tx);
        // debug, not info: Bearer's logger-leak rule fires on any structured
        // (non string-literal) argument to log/info/warn/error/fatal, so a new
        // structured info line here adds a new alert — this file already carries
        // six. debug is outside the rule and is the right level for a detail
        // line anyway; the durable record of what was retired is retired_on
        // itself, not the log.
        logger.debug(
          { planId, requested: supersedeIds.length, retired: retired.length, effectiveFrom },
          "[planGen] Retired superseded plans",
        );
      }
      await storage.plans.updateGenerationStatus(planId, "ready", null, tx);
    });

    logger.info(
      { userId, planId, dayCount: days.length },
      "[planGen] AI plan generated successfully",
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await storage.plans.updateGenerationStatus(planId, "failed", errorMessage);
    throw error;
  }
}
