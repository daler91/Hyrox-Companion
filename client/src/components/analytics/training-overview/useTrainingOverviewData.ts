import type { TimelineAnnotation, TrainingOverview } from "@shared/schema";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { api, QUERY_KEYS } from "@/lib/api";

import { buildAnnotationBands, buildTrendData } from "./utils";

export function useTrainingOverviewData(dateParams: string) {
  const { data: overview, isLoading } = useQuery<TrainingOverview>({
    queryKey: ["/api/v1/training-overview", dateParams],
    queryFn: () => api.analytics.getTrainingOverview(dateParams),
  });

  const { data: annotations } = useQuery<TimelineAnnotation[]>({
    queryKey: QUERY_KEYS.timelineAnnotations,
    queryFn: () => api.timelineAnnotations.list(),
  });

  const { rpeData, durationData } = useMemo(() => buildTrendData(overview), [overview]);

  const annotationBands = useMemo(
    () => buildAnnotationBands(overview, annotations),
    [overview, annotations],
  );

  return {
    overview,
    isLoading,
    stats: overview?.currentStats ?? null,
    previousStats: overview?.previousStats,
    rpeData,
    durationData,
    annotationBands,
  };
}
