import type { PersonalRecord,TimelineAnnotation, TimelineEntry, TrainingPlan } from "@shared/schema";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useRef } from "react";

import { api, QUERY_KEYS } from "@/lib/api";

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

  const { data: timelineData = [], isLoading } = useQuery<TimelineEntry[]>({
    queryKey: [...QUERY_KEYS.timeline, selectedPlanId],
    queryFn: () => api.timeline.get(selectedPlanId),
    enabled: isAuthUserLoaded,
  });

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
  };
}
