import { useRef, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import type { TrainingPlan, TimelineEntry, PersonalRecord } from "@shared/schema";
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
    isNewUser,
    todayRef,
    scrollToToday,
  };
}
