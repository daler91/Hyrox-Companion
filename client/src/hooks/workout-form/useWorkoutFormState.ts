import { useState } from "react";

import { getTodayString } from "@/lib/dateUtils";

import type { WorkoutFormInitialValues } from "./types";

export function useWorkoutFormState(initialValues?: WorkoutFormInitialValues) {
  const [title, setTitle] = useState(initialValues?.title ?? "");
  // Default to the user's local-TZ today so an evening user outside UTC
  // doesn't get tomorrow's date stamped on a workout they're logging now.
  const [date, setDate] = useState(initialValues?.date ?? getTodayString());
  const [freeText, setFreeText] = useState(initialValues?.freeText ?? "");
  const [notes, setNotes] = useState(initialValues?.notes ?? "");
  const [rpe, setRpe] = useState<number | null>(initialValues?.rpe ?? null);
  const [durationMinutes, setDurationMinutes] = useState(initialValues?.durationMinutes ?? "");
  // Optional post-workout metrics entered by hand (manual loggers without a
  // synced wearable). Stored as strings so "" cleanly means "not entered" and
  // number/null coercion happens once at payload-build time. Distance is held
  // in the user's display unit and converted to meters on save.
  const [distance, setDistance] = useState(initialValues?.distance ?? "");
  const [avgHeartrate, setAvgHeartrate] = useState(initialValues?.avgHeartrate ?? "");
  const [maxHeartrate, setMaxHeartrate] = useState(initialValues?.maxHeartrate ?? "");
  const [planId, setPlanId] = useState<string | null>(initialValues?.planId ?? null);
  const [planDayId, setPlanDayId] = useState<string | null>(initialValues?.planDayId ?? null);
  // Manual session start time (minutes-from-midnight, 0–1439) for loggers
  // without a synced wearable. Selects the day's morning/midday/evening meal
  // timing in the nutrition fuel targets.
  const [timeOfDayMin, setTimeOfDayMin] = useState<number | null>(initialValues?.timeOfDayMin ?? null);

  return {
    title,
    setTitle,
    date,
    setDate,
    freeText,
    setFreeText,
    notes,
    setNotes,
    rpe,
    setRpe,
    durationMinutes,
    setDurationMinutes,
    distance,
    setDistance,
    avgHeartrate,
    setAvgHeartrate,
    maxHeartrate,
    setMaxHeartrate,
    planId,
    setPlanId,
    planDayId,
    setPlanDayId,
    timeOfDayMin,
    setTimeOfDayMin,
  };
}
