import {
  addDaysToISODate,
  computePlanWeeks,
  dayDiff,
  MAX_PLAN_WEEKS,
  MIN_PLAN_WEEKS,
} from "@shared/dateUtils";
import type { GeneratePlanInput } from "@shared/schema";
import { useState } from "react";

import { getTodayString } from "@/lib/dateUtils";

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
}

export interface GeneratePlanFormOptions {
  readonly initialGoal?: string;
  readonly initialStartDate?: string;
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
    ...(values.injuries ? { injuries: values.injuries } : {}),
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
  const [injuries, setInjuries] = useState("");

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
    setInjuries("");
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
    resetForm,
    toggleFocus,
    toggleRestDay,
    handleDaysPerWeekChange,
    values,
    ...validation,
  };
}
