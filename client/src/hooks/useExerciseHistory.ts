import { normalizeExerciseName } from "@shared/schema/exercises";
import { useQuery } from "@tanstack/react-query";

import { api, QUERY_KEYS } from "@/lib/api";
import type { ExerciseSetWithDate } from "@/lib/api/exercises";

/** Enough sessions to show the last one and to survive a mis-logged entry. */
const SESSION_LIMIT = 3;

// History only changes when a session is saved, so it can sit in cache for a
// long while. Opening a workout fires one query per distinct exercise; a long
// staleTime is what keeps re-opening the same session free.
const STALE_TIME_MS = 10 * 60 * 1000;
const GC_TIME_MS = 30 * 60 * 1000;

/**
 * Past logged sets of one exercise, for the "Last time: 4×8 @ 80 kg" line.
 *
 * The query key uses the *canonical* name, so an "RDL" row and a
 * "romanian_deadlift" row share one cache entry — and so do two groups of the
 * same lift in different structure blocks.
 *
 * Skipped for custom exercises: `normalizeExerciseName("custom")` resolves to
 * `custom`, which on the server would match every custom set the athlete has
 * ever logged regardless of its label. Better no history than someone else's.
 */
export function useExerciseHistory(exerciseName: string, enabled = true) {
  const canonical = normalizeExerciseName(exerciseName);
  const isQueryable = canonical !== null && canonical !== "custom";

  return useQuery<ExerciseSetWithDate[]>({
    queryKey: QUERY_KEYS.exerciseHistory(canonical ?? exerciseName, SESSION_LIMIT),
    queryFn: () => api.exercises.getHistory(canonical as string, { sessions: SESSION_LIMIT }),
    enabled: enabled && isQueryable,
    staleTime: STALE_TIME_MS,
    gcTime: GC_TIME_MS,
  });
}
