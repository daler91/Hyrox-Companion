import type { TimelineAnnotation, TrainingOverview } from "@shared/schema";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { api, QUERY_KEYS } from "@/lib/api";
import { queryLoadState } from "@/lib/queryLoadState";

import { buildAnnotationBands, buildTrendData } from "./utils";

export function useTrainingOverviewData(dateParams: string) {
  const overviewQuery = useQuery<TrainingOverview>({
    queryKey: ["/api/v1/training-overview", dateParams],
    queryFn: () => api.analytics.getTrainingOverview(dateParams),
  });
  const { data: overview, refetch } = overviewQuery;
  // A first fetch paused offline is still loading, not "No workout data
  // yet"; only a failure with nothing cached is a load error, and a failed
  // refetch keeps showing the overview it already has.
  // U5 (CODEBASE_ANALYSIS_2026-10-03)
  const { loading, failed, retrying } = queryLoadState(overviewQuery);

  const { data: annotations } = useQuery<TimelineAnnotation[]>({
    queryKey: QUERY_KEYS.timelineAnnotations,
    queryFn: () => api.timelineAnnotations.list(),
  });

  const { rpeData, durationData, mileageData } = useMemo(() => buildTrendData(overview), [overview]);

  const annotationBands = useMemo(
    () => buildAnnotationBands(overview, annotations),
    [overview, annotations],
  );

  return {
    overview,
    isLoading: loading,
    loadFailed: failed,
    isRetrying: retrying,
    retry: refetch,
    stats: overview?.currentStats ?? null,
    previousStats: overview?.previousStats,
    rpeData,
    durationData,
    mileageData,
    annotationBands,
  };
}
