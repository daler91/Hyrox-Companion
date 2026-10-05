import { ignoreResult } from "@/hooks/chat/chatSessionModel";
import { QUERY_KEYS } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";

/**
 * The nutrition reads built from a workout and from the athlete's profile:
 * a session's fuelling (the workout's date, start time, duration and RPE set
 * its window and targets, the bodyweight sizes them), each day summary (its
 * meal targets follow the day's primary session and the bodyweight, its
 * energy balance the day's workouts and profile), the Timeline chips (a
 * periodised target follows the day's training load) and the Analytics ->
 * Fuelling block (each day's load and RPE). A workout write or a profile save
 * left them on their old figures for their staleTime.
 * CL19 (CODEBASE_ANALYSIS_2026-10-03)
 */
export const WORKOUT_DERIVED_NUTRITION_QUERY_KEYS = [
  QUERY_KEYS.nutritionSessionFuellingPrefix,
  QUERY_KEYS.nutritionDayPrefix,
  QUERY_KEYS.nutritionRangePrefix,
  QUERY_KEYS.nutritionBlockPrefix,
] as const;

export function invalidateWorkoutWriteQueries(): void {
  queryClient.invalidateQueries({ queryKey: QUERY_KEYS.workouts }).catch(ignoreResult);
  for (const queryKey of WORKOUT_DERIVED_NUTRITION_QUERY_KEYS) {
    queryClient.invalidateQueries({ queryKey }).catch(ignoreResult);
  }
  queryClient.invalidateQueries({ queryKey: QUERY_KEYS.timeline }).catch(ignoreResult);
  queryClient.invalidateQueries({ queryKey: QUERY_KEYS.authUser }).catch(ignoreResult);
  queryClient.invalidateQueries({ queryKey: QUERY_KEYS.personalRecords }).catch(ignoreResult);
  queryClient.invalidateQueries({ queryKey: QUERY_KEYS.exerciseAnalytics }).catch(ignoreResult);
  queryClient.invalidateQueries({ queryKey: QUERY_KEYS.trainingOverview }).catch(ignoreResult);
  queryClient.invalidateQueries({ queryKey: QUERY_KEYS.sessionGradesPrefix }).catch(ignoreResult);
}

/**
 * How long a burst of set edits may go quiet before the derived views refetch.
 * Long enough to swallow the cell-by-cell rhythm of logging a session (each
 * debounced cell save is ~350ms apart), short enough that an athlete who
 * pauses to rest sees fresh numbers without closing the sheet.
 */
export const WORKOUT_WRITE_INVALIDATION_DELAY_MS = 4000;

let pendingInvalidation: ReturnType<typeof setTimeout> | null = null;

/**
 * Coalesced variant for the exercise-set editor. Every successful cell PATCH
 * used to call invalidateWorkoutWriteQueries directly — and because the
 * timeline (500 hydrated entries), the all-time training overview and the PR
 * list are all ACTIVE queries under the open detail sheet, each keystroke's
 * save refetched all of them while the server had just dropped its analytics
 * cache for the same write: logging a 20-set session cost ~20x the work of one
 * save. This schedules ONE trailing invalidation per burst; the sheet flushes
 * it on close (flushWorkoutWriteInvalidation) so the timeline behind it is
 * fresh the moment the athlete returns to it.
 */
export function scheduleWorkoutWriteInvalidation(): void {
  if (pendingInvalidation) clearTimeout(pendingInvalidation);
  pendingInvalidation = setTimeout(() => {
    pendingInvalidation = null;
    invalidateWorkoutWriteQueries();
  }, WORKOUT_WRITE_INVALIDATION_DELAY_MS);
}

/** Run a scheduled invalidation now (no-op when nothing is pending). */
export function flushWorkoutWriteInvalidation(): void {
  if (!pendingInvalidation) return;
  clearTimeout(pendingInvalidation);
  pendingInvalidation = null;
  invalidateWorkoutWriteQueries();
}
