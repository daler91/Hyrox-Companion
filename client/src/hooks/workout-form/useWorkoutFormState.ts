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
  const [planDayId] = useState<string | null>(initialValues?.planDayId ?? null);

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
    planDayId,
  };
}
