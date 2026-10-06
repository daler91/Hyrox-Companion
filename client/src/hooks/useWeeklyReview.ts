import type { WeeklyReview } from "@shared/schema";
import { type QueryClient, type QueryState, useQuery, useQueryClient } from "@tanstack/react-query";

import { useApiMutation } from "@/hooks/useApiMutation";
import { api, QUERY_KEYS } from "@/lib/api";
import { addDays, mondayOf, todayLocalDateStr } from "@/lib/weekDates";

/** How long a review that can still change is trusted before a refetch. */
const SHORT_STALE_MS = 60_000;

function hasPendingGrade(review: WeeklyReview | undefined): boolean {
  return review?.sessions.some((session) => session.grade?.streamStatus === "pending") ?? false;
}

/**
 * Whether the timeline has moved on since `reviewUpdatedAt`: a timeline cache
 * was invalidated by a write, or refetched after the review was. Every
 * timeline write (log, complete, skip, move, delete, annotation) invalidates
 * QUERY_KEYS.timeline, and the server builds the review from those same rows,
 * so this is the review's staleness signal without a key of its own on every
 * write path. Undefined when no loaded timeline cache exists to vouch either
 * way (never visited, garbage-collected, or only ever failed).
 */
function timelineChangedSince(queryClient: QueryClient, reviewUpdatedAt: number): boolean | undefined {
  const timelineQueries = queryClient
    .getQueryCache()
    .findAll({ queryKey: QUERY_KEYS.timeline })
    .filter((timeline) => timeline.state.data !== undefined);
  if (timelineQueries.length === 0) return undefined;
  return timelineQueries.some(
    (timeline) => timeline.state.isInvalidated || timeline.state.dataUpdatedAt > reviewUpdatedAt,
  );
}

/**
 * A closed week is served from cache indefinitely only while the timeline
 * cache vouches nothing changed under it. It was `Infinity` outright, so a
 * late log, skip or move left the week's review showing the old verdict and
 * counts for its whole 30-minute gcTime. CL22 (CODEBASE_ANALYSIS_2026-10-03)
 */
function reviewStaleTime(
  queryClient: QueryClient,
  state: QueryState<WeeklyReview>,
  isCurrentWeek: boolean,
): number {
  const timelineChanged = timelineChangedSince(queryClient, state.dataUpdatedAt);
  if (timelineChanged === true) return 0;
  // A closed week can still change in one way: a run's grade sharpens once
  // its Strava stream arrives. Until then it stays short-lived like the
  // current week.
  if (isCurrentWeek || hasPendingGrade(state.data)) return SHORT_STALE_MS;
  return timelineChanged === false ? Infinity : SHORT_STALE_MS;
}

/**
 * The weekly review for `week` (any date inside the wanted week), defaulting to
 * the most recently completed one.
 *
 * A closed week is cached until a timeline write could have changed it, so
 * paging back through the year re-fetches nothing while nothing changed (see
 * reviewStaleTime). The in-progress week keeps normal staleness because
 * sessions are still landing in it.
 *
 * Note the week is resolved client-side for the query key and the "is this week
 * still running" decision, using the browser's local calendar. The server
 * resolves it again in the athlete's stored timezone and its answer wins — the
 * payload reports the week it actually used, so a mismatch (travelling athlete,
 * stale `userTimezone`) shows the server's week rather than a broken page.
 *
 * The key is the week's Monday whatever date inside it was asked for. A
 * mid-week `?week=` link keyed the cache on that raw date, so the intent save,
 * which invalidates the Monday key, never refreshed the open page: the saved
 * line did not come back and Save stayed enabled. The server anchors any date
 * to the same Monday, so asking for the Monday changes nothing it answers.
 * CL51 (CODEBASE_ANALYSIS_2026-10-03)
 */
export function useWeeklyReview(week?: string) {
  const queryClient = useQueryClient();
  const resolvedWeek = mondayOf(week ?? addDays(todayLocalDateStr(), -7));
  const currentWeekStart = mondayOf(todayLocalDateStr());
  const isCurrentWeek = resolvedWeek === currentWeekStart;

  return useQuery({
    queryKey: QUERY_KEYS.weeklyReview(resolvedWeek),
    queryFn: () => api.analytics.getWeeklyReview(resolvedWeek),
    staleTime: (query) => reviewStaleTime(queryClient, query.state, isCurrentWeek),
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: isCurrentWeek,
  });
}

/**
 * Save (or clear) the intent for `weekStart`.
 *
 * Invalidates that week's review so the saved line comes back from the server
 * rather than being assumed locally — and next week's, which reads this same
 * row as `previousIntent`, so it is not left holding a stale copy. Both by
 * their Monday, the key useWeeklyReview uses (CL51).
 */
export function useSetWeeklyReviewIntent(weekStart: string) {
  const monday = mondayOf(weekStart);
  return useApiMutation<{ weekStart: string; intent: string | null }, Error, string | null>({
    mutationFn: (intent) => api.analytics.setWeeklyReviewIntent(weekStart, intent),
    invalidateQueries: [QUERY_KEYS.weeklyReview(monday), QUERY_KEYS.weeklyReview(addDays(monday, 7))],
    errorToast: "Couldn't save your note for next week.",
  });
}
