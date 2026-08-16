import { useQuery } from "@tanstack/react-query";

import { useApiMutation } from "@/hooks/useApiMutation";
import { api, QUERY_KEYS } from "@/lib/api";
import { addDays, mondayOf, todayLocalDateStr } from "@/lib/weekDates";

/**
 * The weekly review for `week` (any date inside the wanted week), defaulting to
 * the most recently completed one.
 *
 * A closed week never changes, so it is cached indefinitely — paging back
 * through the year re-fetches nothing. The in-progress week keeps normal
 * staleness because sessions are still landing in it.
 *
 * Note the week is resolved client-side for the query key and the "is this week
 * still running" decision, using the browser's local calendar. The server
 * resolves it again in the athlete's stored timezone and its answer wins — the
 * payload reports the week it actually used, so a mismatch (travelling athlete,
 * stale `userTimezone`) shows the server's week rather than a broken page.
 */
export function useWeeklyReview(week?: string) {
  const resolvedWeek = week ?? mondayOf(addDays(todayLocalDateStr(), -7));
  const currentWeekStart = mondayOf(todayLocalDateStr());
  const isCurrentWeek = mondayOf(resolvedWeek) === currentWeekStart;

  return useQuery({
    queryKey: QUERY_KEYS.weeklyReview(resolvedWeek),
    queryFn: () => api.analytics.getWeeklyReview(resolvedWeek),
    staleTime: isCurrentWeek ? 60_000 : Infinity,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: isCurrentWeek,
  });
}

/**
 * Save (or clear) the intent for `weekStart`.
 *
 * Invalidates that week's review so the saved line comes back from the server
 * rather than being assumed locally — and so next week's review, which reads
 * this same row as `previousIntent`, is not left holding a stale copy.
 */
export function useSetWeeklyReviewIntent(weekStart: string) {
  return useApiMutation<{ weekStart: string; intent: string | null }, Error, string | null>({
    mutationFn: (intent) => api.analytics.setWeeklyReviewIntent(weekStart, intent),
    invalidateQueries: [QUERY_KEYS.weeklyReview(weekStart)],
    errorToast: "Couldn't save your note for next week.",
  });
}
