import type { GeneratePlanInput } from "@shared/schema";
import { useState } from "react";

import { toISODateString } from "@/lib/dateUtils";

export const MAX_WEEKS = 24;
export const MIN_WEEKS = 1;
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
type ExperienceLevel = "beginner" | "intermediate" | "advanced";

export interface GeneratePlanFormValues {
  readonly goal: string;
  readonly totalWeeks: number;
  readonly daysPerWeek: number;
  readonly experienceLevel: ExperienceLevel;
  readonly raceDate: string;
  readonly startDate: string;
  readonly restDays: string[];
  readonly focusAreas: string[];
  readonly injuries: string;
}

export function calculateSuggestedStartDate(race: string, weeks: number): string {
  const raceD = new Date(race);
  const start = new Date(raceD);
  start.setDate(start.getDate() - weeks * 7);
  const dayOfWeek = start.getDay();
  let mondayOffset: number;
  if (dayOfWeek === 0) mondayOffset = 1;
  else if (dayOfWeek === 1) mondayOffset = 0;
  else mondayOffset = 8 - dayOfWeek;
  start.setDate(start.getDate() + mondayOffset);
  // Local-TZ string: matches plan-day scheduledDate semantics on the server.
  return toISODateString(start);
}

export function getGeneratePlanFormValidation(
  values: Pick<GeneratePlanFormValues, "goal" | "daysPerWeek" | "restDays">,
) {
  const requiredRestDays = 7 - values.daysPerWeek;
  const canProceedStep0 = values.goal.trim().length > 0;
  const canProceedStep1 = values.daysPerWeek === 7 || values.restDays.length === requiredRestDays;
  return {
    requiredRestDays,
    canProceedStep0,
    canProceedStep1,
    canGenerate: canProceedStep0 && canProceedStep1,
  };
}

export function buildGeneratePlanInput(values: GeneratePlanFormValues): GeneratePlanInput {
  return {
    goal: values.goal,
    totalWeeks: values.totalWeeks,
    daysPerWeek: values.daysPerWeek,
    experienceLevel: values.experienceLevel,
    ...(values.raceDate ? { raceDate: values.raceDate } : {}),
    ...(values.startDate ? { startDate: values.startDate } : {}),
    ...(values.daysPerWeek < 7 && values.restDays.length > 0
      ? { restDays: values.restDays as GeneratePlanInput["restDays"] }
      : {}),
    ...(values.focusAreas.length > 0 ? { focusAreas: values.focusAreas } : {}),
    ...(values.injuries ? { injuries: values.injuries } : {}),
  };
}

export function useGeneratePlanForm() {
  const [step, setStep] = useState<GeneratePlanStep>(0);
  const [goal, setGoal] = useState("");
  const [totalWeeks, setTotalWeeks] = useState(DEFAULT_WEEKS);
  const [daysPerWeek, setDaysPerWeek] = useState(DEFAULT_DAYS_PER_WEEK);
  const [experienceLevel, setExperienceLevel] = useState<ExperienceLevel>("intermediate");
  const [raceDate, setRaceDate] = useState("");
  const [startDate, setStartDate] = useState("");
  const [restDays, setRestDays] = useState<string[]>(DEFAULT_REST_DAYS[DEFAULT_DAYS_PER_WEEK]);
  const [focusAreas, setFocusAreas] = useState<string[]>([]);
  const [injuries, setInjuries] = useState("");

  const resetForm = () => {
    setStep(0);
    setGoal("");
    setTotalWeeks(DEFAULT_WEEKS);
    setDaysPerWeek(DEFAULT_DAYS_PER_WEEK);
    setExperienceLevel("intermediate");
    setRaceDate("");
    setStartDate("");
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

  const handleRaceDateChange = (value: string) => {
    setRaceDate(value);
    if (value && !startDate) {
      setStartDate(calculateSuggestedStartDate(value, totalWeeks));
    }
  };

  const values: GeneratePlanFormValues = {
    goal,
    totalWeeks,
    daysPerWeek,
    experienceLevel,
    raceDate,
    startDate,
    restDays,
    focusAreas,
    injuries,
  };
  const validation = getGeneratePlanFormValidation(values);

  return {
    step,
    setStep,
    goal,
    setGoal,
    totalWeeks,
    setTotalWeeks,
    daysPerWeek,
    experienceLevel,
    setExperienceLevel,
    raceDate,
    startDate,
    setStartDate,
    restDays,
    focusAreas,
    injuries,
    setInjuries,
    resetForm,
    toggleFocus,
    toggleRestDay,
    handleDaysPerWeekChange,
    handleRaceDateChange,
    values,
    ...validation,
  };
}
