import type { SessionGradesResponse, WorkoutSessionGradeResponse } from "@shared/schema";
import { useQuery } from "@tanstack/react-query";

import { api, QUERY_KEYS } from "@/lib/api";

/** How often a grade still waiting on its Strava stream is re-read. */
const PENDING_REFETCH_MS = 30_000;
/** Give up polling after this many reads; the next visit picks it up. */
const MAX_PENDING_REFETCHES = 10;

/**
 * "Did the session do its job?" for one plan — every graded run plus its
 * week and block rollups. `planId` omitted means the active plan.
 */
export function useSessionGrades(planId?: string) {
  return useQuery<SessionGradesResponse>({
    queryKey: QUERY_KEYS.sessionGrades(planId),
    queryFn: () => api.analytics.getSessionGrades(planId),
    staleTime: 60_000,
  });
}

/**
 * One workout's grade. While the run's stream is still being fetched the grade
 * comes from its averages; this re-reads it every 30 s (for a few minutes) so
 * the card sharpens on its own once the stream lands.
 */
export function useWorkoutSessionGrade(workoutId: string | null | undefined, enabled = true) {
  return useQuery<WorkoutSessionGradeResponse>({
    queryKey: QUERY_KEYS.workoutSessionGrade(workoutId ?? ""),
    queryFn: () => api.analytics.getWorkoutSessionGrade(workoutId ?? ""),
    enabled: enabled && Boolean(workoutId),
    staleTime: 60_000,
    refetchInterval: (query) =>
      query.state.data?.grade?.streamStatus === "pending" && query.state.dataUpdateCount < MAX_PENDING_REFETCHES
        ? PENDING_REFETCH_MS
        : false,
  });
}
