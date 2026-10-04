import type { PersonalRecord, TimelineAnnotation, TrainingPlan } from "@shared/schema";
import { type FetchStatus, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useRef } from "react";

import { api, QUERY_KEYS } from "@/lib/api";
import { flattenTimelineCache, type TimelineCache, type TimelinePage } from "@/lib/timelineCache";

import { usePendingWorkoutEntries } from "./usePendingWorkoutEntries";

/** The fields of a query result that say whether it has answered. */
interface QueryLoadSnapshot {
  readonly data: unknown;
  readonly errorUpdateCount: number;
  readonly fetchStatus: FetchStatus;
}

/**
 * Where a query stands, so that having no data is never read as an empty
 * account. A query with data has answered. Without data it is either:
 * - loading: it has not answered yet. This includes a first fetch paused
 *   because the browser is offline, which is pending but not `isLoading`,
 *   and which rendered the first-run welcome.
 * - failed: an attempt failed. A retry of a query with no data resets it to
 *   pending, so neither `isError` nor `isRefetching` sees the retry, but the
 *   failure count does. The error stays up while the retry runs, and
 *   `retrying` says it is in flight or waiting for the network.
 * U5 (CODEBASE_ANALYSIS_2026-10-03)
 */
function loadState({ data, errorUpdateCount, fetchStatus }: QueryLoadSnapshot) {
  const answered = data !== undefined;
  const failed = !answered && errorUpdateCount > 0;
  return { loading: !answered && !failed, failed, retrying: failed && fetchStatus !== "idle" };
}

export function useTimelineData(selectedPlanId: string | null, isAuthUserLoaded = true) {
  const todayRef = useRef<HTMLDivElement>(null);

  const scrollToToday = useCallback(() => {
    todayRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const plansQuery = useQuery<TrainingPlan[]>({
    queryKey: QUERY_KEYS.plans,
    enabled: isAuthUserLoaded,
  });
  const { data: plansData, refetch: refetchPlans } = plansQuery;
  const plans = useMemo(() => plansData ?? [], [plansData]);
  const { loading: plansLoading, failed: plansFailed, retrying: plansRetrying } = loadState(plansQuery);

  const { data: personalRecords } = useQuery<Record<string, PersonalRecord>>({
    queryKey: QUERY_KEYS.personalRecords,
    enabled: isAuthUserLoaded,
  });

  // Cursor-paged (P3): the first page is everything from today forward plus
  // the most recent past entries; older history loads on demand through
  // `loadOlderEntries`. An invalidation refetches the loaded pages in order,
  // so the cost of a write stays proportional to what the athlete has opened
  // rather than to their whole history.
  const timelineQuery = useInfiniteQuery<TimelinePage, Error, TimelineCache, (string | null)[], string | null>({
    queryKey: [...QUERY_KEYS.timeline, selectedPlanId],
    queryFn: ({ pageParam }) => api.timeline.getPage(selectedPlanId, pageParam),
    initialPageParam: null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: isAuthUserLoaded,
  });
  const { data: timelineCache, refetch: refetchTimeline, hasNextPage, isFetchingNextPage, fetchNextPage } =
    timelineQuery;
  const {
    loading: timelinePending,
    failed: timelineFailed,
    retrying: timelineRetrying,
  } = loadState(timelineQuery);
  const serverTimelineData = useMemo(() => flattenTimelineCache(timelineCache), [timelineCache]);
  const loadOlderEntries = useCallback(() => {
    if (!isFetchingNextPage) void fetchNextPage();
  }, [fetchNextPage, isFetchingNextPage]);

  // Overlay queued-but-unsynced workout creates (offline path) so they show
  // on the timeline immediately instead of vanishing until reconnect. They
  // are plan-agnostic, so they appear regardless of the selected plan; the
  // overlay empties itself once the queue drains and the refetch lands.
  const pendingEntries = usePendingWorkoutEntries();
  const timelineData = useMemo(
    () => (pendingEntries.length === 0 ? serverTimelineData : [...serverTimelineData, ...pendingEntries]),
    [serverTimelineData, pendingEntries],
  );

  // Annotations are user-scoped (not plan-scoped), so this query has no
  // selectedPlanId in its key. Mutations in `AnnotationsDialog` and the
  // page-level delete mutation invalidate `QUERY_KEYS.timelineAnnotations`,
  // keeping this list fresh on create/delete.
  const { data: annotations = [] } = useQuery<TimelineAnnotation[]>({
    queryKey: QUERY_KEYS.timelineAnnotations,
    queryFn: () => api.timelineAnnotations.list(),
    enabled: isAuthUserLoaded,
  });

  // A failed fetch is not an empty account. Both queries default to [] when
  // they have no data, so without this a 5xx or an unreachable server read
  // as a brand-new athlete: the welcome card with "Generate AI Plan" and
  // "Use 8-Week Template", and onboarding launched for a returning user. An
  // empty timeline cannot tell a first-run account from a returning one
  // until the plans answer, so the plans count under it; a plans failure
  // under a timeline with entries still shows the entries.
  // U5 (CODEBASE_ANALYSIS_2026-10-03)
  const timelineEmpty = serverTimelineData.length === 0;
  const timelineLoading = !isAuthUserLoaded || timelinePending || (timelineEmpty && plansLoading);
  const isError = timelineFailed || (timelineEmpty && plansFailed);
  const isRetrying = timelineRetrying || (timelineEmpty && plansRetrying);
  const retry = useCallback(() => {
    if (timelineFailed) void refetchTimeline();
    if (plansFailed) void refetchPlans();
  }, [timelineFailed, plansFailed, refetchTimeline, refetchPlans]);

  // New only once both answered, empty: never while either is loading,
  // paused offline or failed. U5 (CODEBASE_ANALYSIS_2026-10-03)
  const isNewUser =
    isAuthUserLoaded && plansData?.length === 0 && timelineCache !== undefined && timelineData.length === 0;

  return {
    plans,
    plansLoading,
    personalRecords,
    timelineData,
    timelineLoading,
    isError,
    isRetrying,
    retry,
    annotations,
    isNewUser,
    todayRef,
    scrollToToday,
    hasOlderEntries: hasNextPage,
    isLoadingOlder: isFetchingNextPage,
    loadOlderEntries,
  };
}
