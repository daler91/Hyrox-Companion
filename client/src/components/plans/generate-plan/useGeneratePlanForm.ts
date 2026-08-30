import {
  addDaysToISODate,
  computePlanWeeks,
  dayDiff,
  MAX_PLAN_WEEKS,
  MIN_PLAN_WEEKS,
} from "@shared/dateUtils";
import type { GeneratePlanInput, TrainingPlan } from "@shared/schema";
import { useMemo, useState } from "react";

import { getTodayString } from "@/lib/dateUtils";

// Stable identity, so the overlap memo isn't invalidated on every render when
// the caller passes no plans.
const EMPTY_PLANS: readonly TrainingPlan[] = [];

export const DEFAULT_WEEKS = 8;
export const MAX_DAYS_PER_WEEK = 7;
export const MIN_DAYS_PER_WEEK = 2;
export const DEFAULT_DAYS_PER_WEEK = 5;

export const DAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

export const DEFAULT_REST_DAYS: Record<number, string[]> = {
  7: [],
  6: ["Sunday"],
  5: ["Saturday", "Sunday"],
  4: ["Wednesday", "Saturday", "Sunday"],
  3: ["Tuesday", "Thursday", "Saturday", "Sunday"],
  2: ["Monday", "Wednesday", "Friday", "Saturday", "Sunday"],
};

export const FOCUS_OPTIONS = [
  { value: "running", label: "Running" },
  { value: "sled_push", label: "Sled Push" },
  { value: "sled_pull", label: "Sled Pull" },
  { value: "skierg", label: "SkiErg" },
  { value: "rowing", label: "Rowing" },
  { value: "wall_balls", label: "Wall Balls" },
  { value: "farmers_carry", label: "Farmers Carry" },
  { value: "burpee_broad_jump", label: "Burpee Broad Jumps" },
  { value: "strength", label: "Strength" },
  { value: "conditioning", label: "Conditioning" },
];

export type GeneratePlanStep = 0 | 1 | 2;
export type ExperienceLevel = "beginner" | "intermediate" | "advanced";

export interface GeneratePlanFormValues {
  readonly goal: string;
  readonly daysPerWeek: number;
  readonly experienceLevel: ExperienceLevel;
  readonly startDate: string;
  readonly endDate: string;
  readonly endDateIsRaceDate: boolean;
  readonly restDays: string[];
  readonly focusAreas: string[];
  readonly injuries: string;
  readonly supersedePlanIds: string[];
}

export interface GeneratePlanFormOptions {
  readonly initialGoal?: string;
  readonly initialStartDate?: string;
  /**
   * The athlete's remembered injuries/limitations, prefilled into the box so
   * they are not retyped on every regeneration. Passed in rather than read from
   * `useAuth` here, so this hook stays free of query context — same reason
   * `initialGoal` is a parameter.
   */
  readonly initialConstraints?: string;
  /**
   * The athlete's existing plans, used to spot one this new plan would overlap.
   * Passed in for the same reason as `initialGoal` — it keeps the hook free of
   * query context. Defaults to none, which is the onboarding case.
   */
  readonly existingPlans?: readonly TrainingPlan[];
}

/**
 * Live plans whose scheduled window intersects [startDate, endDate] and which
 * still have training left to do.
 *
 * These are the plans the athlete is really switching away from. Offering to
 * retire them at this exact moment is the whole point: it is when they are
 * deciding, and leaving both live is what makes the abandoned block go on
 * marking sessions missed and dragging their adherence down.
 *
 * Plans that already ended are left alone — there is nothing left to abandon —
 * as are already-archived ones and any not yet scheduled onto the calendar. ISO
 * dates compare lexicographically, same as isDateWithinPlanWindow server-side.
 */
export function findOverlappingPlans(
  plans: readonly TrainingPlan[],
  startDate: string,
  endDate: string,
  today: string,
): TrainingPlan[] {
  if (!startDate || !endDate) return [];
  return plans.filter(
    (plan) =>
      plan.retiredOn == null &&
      plan.startDate != null &&
      plan.endDate != null &&
      plan.endDate >= today &&
      plan.startDate <= endDate &&
      plan.endDate >= startDate,
  );
}

/**
 * Validate the start → end date range that now drives a plan's length. Returns a
 * human-readable error, or null when the span is a valid 1–24 week plan. The
 * week count is checked on the RAW rounded span (not `computePlanWeeks`, which
 * clamps) so an out-of-range span is rejected rather than silently clamped.
 */
export function getPlanDateError(startDate: string, endDate: string): string | null {
  if (!startDate || !endDate) return "Start and end dates are required.";
  const span = dayDiff(startDate, endDate);
  if (span <= 0) return "End date must be after the start date.";
  const weeks = Math.round(span / 7);
  if (weeks < MIN_PLAN_WEEKS || weeks > MAX_PLAN_WEEKS) {
    return `Plan length must be between ${MIN_PLAN_WEEKS} and ${MAX_PLAN_WEEKS} weeks (your dates span ${weeks} weeks).`;
  }
  return null;
}

export function getGeneratePlanFormValidation(
  values: Pick<
    GeneratePlanFormValues,
    "goal" | "daysPerWeek" | "restDays" | "startDate" | "endDate"
  >,
) {
  const requiredRestDays = 7 - values.daysPerWeek;
  const canProceedStep0 = values.goal.trim().length > 0;
  const hasRequiredRestDays =
    values.daysPerWeek === 7 || values.restDays.length === requiredRestDays;
  const dateError = getPlanDateError(values.startDate, values.endDate);
  const canProceedStep1 = hasRequiredRestDays && dateError === null;
  return {
    requiredRestDays,
    canProceedStep0,
    canProceedStep1,
    dateError,
    canGenerate: canProceedStep0 && canProceedStep1,
  };
}

export function buildGeneratePlanInput(values: GeneratePlanFormValues): GeneratePlanInput {
  return {
    goal: values.goal,
    daysPerWeek: values.daysPerWeek,
    experienceLevel: values.experienceLevel,
    startDate: values.startDate,
    endDate: values.endDate,
    endDateIsRaceDate: values.endDateIsRaceDate,
    ...(values.daysPerWeek < 7 && values.restDays.length > 0
      ? { restDays: values.restDays as GeneratePlanInput["restDays"] }
      : {}),
    ...(values.focusAreas.length > 0 ? { focusAreas: values.focusAreas } : {}),
    // Always sent, even empty: the server treats presence as authoritative and
    // an empty string clears the remembered constraints. Omitting it would make
    // a cleared box indistinguishable from an older client that never sent one.
    injuries: values.injuries,
    // Omitted when empty so the payload stays identical to what an older client
    // sends, rather than carrying an empty array through the job queue.
    ...(values.supersedePlanIds.length > 0
      ? { supersedePlanIds: values.supersedePlanIds }
      : {}),
  };
}

export function useGeneratePlanForm(options: GeneratePlanFormOptions = {}) {
  const initialGoal = options.initialGoal ?? "";
  // Plan length is derived from the dates, so both are always prefilled: start
  // from the caller (onboarding) or today, end at the historical default length.
  const baseStartDate = options.initialStartDate || getTodayString();
  const defaultEndDate = addDaysToISODate(baseStartDate, DEFAULT_WEEKS * 7);

  const [step, setStep] = useState<GeneratePlanStep>(0);
  const [goal, setGoal] = useState(initialGoal);
  const [daysPerWeek, setDaysPerWeek] = useState(DEFAULT_DAYS_PER_WEEK);
  const [experienceLevel, setExperienceLevel] = useState<ExperienceLevel>("intermediate");
  const [startDate, setStartDate] = useState(baseStartDate);
  const [endDate, setEndDate] = useState(defaultEndDate);
  const [endDateIsRaceDate, setEndDateIsRaceDate] = useState(true);
  const [restDays, setRestDays] = useState<string[]>(DEFAULT_REST_DAYS[DEFAULT_DAYS_PER_WEEK]);
  const [focusAreas, setFocusAreas] = useState<string[]>([]);
  // Prefilled from the athlete's remembered constraints so they do not retype
  // them on every regeneration; clearing the box and generating clears the
  // profile, which is how a resolved injury is forgotten.
  const rememberedConstraints = options.initialConstraints ?? "";
  const [injuries, setInjuries] = useState(rememberedConstraints);

  // Plans this one would overlap, recomputed from the current dates. Kept as a
  // derived value plus a set of DESELECTED ids rather than a list of selected
  // ones: the athlete moves the dates around while deciding, and a stored
  // selection would quietly go stale against a plan that no longer overlaps.
  // Default is "retire them all" — switching is the normal reason to be here.
  const existingPlans = options.existingPlans ?? EMPTY_PLANS;
  const [keptPlanIds, setKeptPlanIds] = useState<readonly string[]>([]);
  const overlappingPlans = useMemo(
    () => findOverlappingPlans(existingPlans, startDate, endDate, getTodayString()),
    [existingPlans, startDate, endDate],
  );
  const supersedePlanIds = overlappingPlans
    .map((plan) => plan.id)
    .filter((id) => !keptPlanIds.includes(id));

  const toggleSupersede = (planId: string) => {
    setKeptPlanIds((prev) =>
      prev.includes(planId) ? prev.filter((id) => id !== planId) : [...prev, planId],
    );
  };

  const resetForm = () => {
    setStep(0);
    setGoal(initialGoal);
    setDaysPerWeek(DEFAULT_DAYS_PER_WEEK);
    setExperienceLevel("intermediate");
    setStartDate(baseStartDate);
    setEndDate(defaultEndDate);
    setEndDateIsRaceDate(true);
    setRestDays(DEFAULT_REST_DAYS[DEFAULT_DAYS_PER_WEEK]);
    setFocusAreas([]);
    setInjuries(rememberedConstraints);
    setKeptPlanIds([]);
  };

  const toggleFocus = (value: string) => {
    setFocusAreas((prev) =>
      prev.includes(value) ? prev.filter((focus) => focus !== value) : [...prev, value],
    );
  };

  const toggleRestDay = (day: string) => {
    setRestDays((prev) =>
      prev.includes(day) ? prev.filter((currentDay) => currentDay !== day) : [...prev, day],
    );
  };

  const handleDaysPerWeekChange = (value: number) => {
    const clamped = Math.min(MAX_DAYS_PER_WEEK, Math.max(MIN_DAYS_PER_WEEK, value));
    setDaysPerWeek(clamped);
    setRestDays(DEFAULT_REST_DAYS[clamped] ?? []);
  };

  const values: GeneratePlanFormValues = {
    goal,
    daysPerWeek,
    experienceLevel,
    startDate,
    endDate,
    endDateIsRaceDate,
    restDays,
    focusAreas,
    injuries,
    supersedePlanIds,
  };
  const validation = getGeneratePlanFormValidation(values);
  // Clamped for display; out-of-range spans surface via validation.dateError and
  // block progression, so the readout only ever shows a sensible 1–24.
  const planWeeks = computePlanWeeks(startDate, endDate);

  return {
    step,
    setStep,
    goal,
    setGoal,
    daysPerWeek,
    experienceLevel,
    setExperienceLevel,
    startDate,
    setStartDate,
    endDate,
    setEndDate,
    endDateIsRaceDate,
    setEndDateIsRaceDate,
    planWeeks,
    restDays,
    focusAreas,
    injuries,
    setInjuries,
    overlappingPlans,
    supersedePlanIds,
    toggleSupersede,
    resetForm,
    toggleFocus,
    toggleRestDay,
    handleDaysPerWeekChange,
    values,
    ...validation,
  };
}
