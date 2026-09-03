import type { PersonalRecord, TimelineAnnotation, TrainingPlan } from "@shared/schema";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useRef } from "react";

import { api, QUERY_KEYS } from "@/lib/api";
import { flattenTimelineCache, type TimelineCache, type TimelinePage } from "@/lib/timelineCache";

import { usePendingWorkoutEntries } from "./usePendingWorkoutEntries";

export function useTimelineData(selectedPlanId: string | null, isAuthUserLoaded = true) {
  const todayRef = useRef<HTMLDivElement>(null);

  const scrollToToday = useCallback(() => {
    todayRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const { data: plans = [], isLoading: plansLoading } = useQuery<TrainingPlan[]>({
    queryKey: QUERY_KEYS.plans,
    enabled: isAuthUserLoaded,
  });

  const { data: personalRecords } = useQuery<Record<string, PersonalRecord>>({
    queryKey: QUERY_KEYS.personalRecords,
    enabled: isAuthUserLoaded,
  });

  // Cursor-paged (P3): the first page is everything from today forward plus
  // the most recent past entries; older history loads on demand through
  // `loadOlderEntries`. An invalidation refetches the loaded pages in order,
  // so the cost of a write stays proportional to what the athlete has opened
  // rather than to their whole history.
  const {
    data: timelineCache,
    isLoading,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useInfiniteQuery<TimelinePage, Error, TimelineCache, (string | null)[], string | null>({
    queryKey: [...QUERY_KEYS.timeline, selectedPlanId],
    queryFn: ({ pageParam }) => api.timeline.getPage(selectedPlanId, pageParam),
    initialPageParam: null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: isAuthUserLoaded,
  });
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

  const timelineLoading = !isAuthUserLoaded || isLoading;

  const isNewUser = isAuthUserLoaded && !plansLoading && !timelineLoading && plans.length === 0 && timelineData.length === 0;

  return {
    plans,
    plansLoading,
    personalRecords,
    timelineData,
    timelineLoading,
    annotations,
    isNewUser,
    todayRef,
    scrollToToday,
    hasOlderEntries: hasNextPage,
    isLoadingOlder: isFetchingNextPage,
    loadOlderEntries,
  };
}
