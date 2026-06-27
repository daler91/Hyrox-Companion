import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";

import { useAuth } from "@/hooks/useAuth";
import { readAnalyticsSnapshot, useWriteAnalyticsSnapshot } from "@/lib/analyticsSnapshot";
import { api, type OverviewAnalysisResponse, QUERY_KEYS } from "@/lib/api";

// Per-user localStorage snapshot key so a fresh page load paints the previous
// per-chart explanations instantly instead of an empty state, and so a different
// signed-in account never sees the prior user's cached analysis.
const SNAPSHOT_PREFIX = "fitai-overview-analysis-cache";

/**
 * Loads the stored Overview chart analysis (instant paint, no AI spend) and
 * exposes an explicit regenerate action. Mirrors the query + mutation + snapshot
 * wiring used by CoachInsightsTab so the two AI analytics surfaces behave the
 * same. The stored result is authoritative — refreshed by the midnight cron or
 * an explicit regenerate — so it's treated as fresh (staleTime: Infinity).
 */
export function useOverviewAnalysis() {
  const { user } = useAuth();
  const userId = user?.id;
  const queryClient = useQueryClient();

  // Scoped by userId so signing into a different account in the same tab doesn't
  // render the previous user's analysis from cache.
  const queryKey = [...QUERY_KEYS.overviewAnalysis, userId ?? "anon"];
  const snapshotKey = userId ? `${SNAPSHOT_PREFIX}:${userId}` : null;
  const placeholder = useMemo(
    () => (snapshotKey ? readAnalyticsSnapshot<OverviewAnalysisResponse>(snapshotKey) : undefined),
    [snapshotKey],
  );

  const query = useQuery<OverviewAnalysisResponse>({
    queryKey,
    queryFn: () => api.analytics.getOverviewAnalysis(),
    enabled: !!userId,
    staleTime: Infinity,
    gcTime: Infinity,
    placeholderData: placeholder,
    retry: false,
  });
  useWriteAnalyticsSnapshot(snapshotKey, query.data, query.isPlaceholderData);

  // Explicit (re)generation — spends AI, persists server-side, and updates the
  // cache (which in turn refreshes the snapshot via the effect above).
  const regenerate = useMutation({
    mutationFn: () => api.analytics.regenerateOverviewAnalysis(),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKey, data);
    },
  });

  const data = query.data;
  const sections = data?.sections ?? null;
  const hasAnalysis = sections != null && Object.keys(sections).length > 0;

  return {
    sections,
    generatedAt: data?.generatedAt,
    stale: data?.stale ?? false,
    hasAnalysis,
    regenerate: () => regenerate.mutate(),
    isGenerating: regenerate.isPending,
    isLoading: query.isLoading,
    error: regenerate.error ?? query.error,
    canGenerate: !!userId,
  };
}
