import { useRef, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import type { TrainingPlan, TimelineEntry, PersonalRecord } from "@shared/schema";

export function useTimelineData(selectedPlanId: string | null) {
  const todayRef = useRef<HTMLDivElement>(null);

  const scrollToToday = useCallback(() => {
    todayRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const { data: plans = [], isLoading: plansLoading } = useQuery<TrainingPlan[]>({
    queryKey: ["/api/plans"],
  });

  const { data: personalRecords } = useQuery<Record<string, PersonalRecord>>({
    queryKey: ["/api/personal-records"],
  });

  const { data: timelineData = [], isLoading: timelineLoading } = useQuery<TimelineEntry[]>({
    queryKey: ["/api/timeline", selectedPlanId],
    queryFn: async () => {
      const url = selectedPlanId
        ? `/api/timeline?planId=${selectedPlanId}`
        : `/api/timeline`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch timeline");
      return res.json();
    },
  });

  useEffect(() => {
    if (!timelineLoading && todayRef.current) {
      setTimeout(() => {
        todayRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 100);
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
