import type { PersonalRecord,TimelineAnnotation, TimelineEntry, TrainingPlan } from "@shared/schema";
import { useQuery } from "@tanstack/react-query";
import { useCallback,useEffect, useRef } from "react";

import { api, QUERY_KEYS } from "@/lib/api";

import { SCROLL_TO_TODAY_DELAY_MS } from "./constants";

export function useTimelineData(selectedPlanId: string | null) {
  const todayRef = useRef<HTMLDivElement>(null);

  const scrollToToday = useCallback(() => {
    todayRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const { data: plans = [], isLoading: plansLoading } = useQuery<TrainingPlan[]>({
    queryKey: QUERY_KEYS.plans,
  });

  const { data: personalRecords } = useQuery<Record<string, PersonalRecord>>({
    queryKey: QUERY_KEYS.personalRecords,
  });

  const { data: timelineData = [], isLoading: timelineLoading } = useQuery<TimelineEntry[]>({
    queryKey: [...QUERY_KEYS.timeline, selectedPlanId],
    queryFn: () => api.timeline.get(selectedPlanId),
  });

  // Annotations are user-scoped (not plan-scoped), so this query has no
  // selectedPlanId in its key. Mutations in `AnnotationsDialog` and the
  // page-level delete mutation invalidate `QUERY_KEYS.timelineAnnotations`,
  // keeping this list fresh on create/delete.
  const { data: annotations = [] } = useQuery<TimelineAnnotation[]>({
    queryKey: QUERY_KEYS.timelineAnnotations,
    queryFn: () => api.timelineAnnotations.list(),
  });

  useEffect(() => {
    if (!timelineLoading && todayRef.current) {
      const timerId = setTimeout(() => {
        todayRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, SCROLL_TO_TODAY_DELAY_MS);
      return () => clearTimeout(timerId);
    }
  }, [timelineLoading]);

  const isNewUser = !plansLoading && !timelineLoading && plans.length === 0 && timelineData.length === 0;

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
