import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";

import { useAuth } from "@/hooks/useAuth";
import { readAnalyticsSnapshot, useWriteAnalyticsSnapshot } from "@/lib/analyticsSnapshot";
import { api, type OverviewAnalysisResponse, QUERY_KEYS } from "@/lib/api";

// Per-user localStorage snapshot key so a fresh page load paints the previous
// per-chart explanations instantly instead of an empty state, and so a different
// signed-in account never sees the prior user's cached analysis.
const SNAPSHOT_PREFIX = "fitai-overview-analysis-cache";

/** The range the Analytics page opens on ("Last 90 days"). */
const DEFAULT_RANGE = "90";

/**
 * Loads the stored Overview chart analysis (instant paint, no AI spend) and
 * exposes an explicit regenerate action. Mirrors the query + mutation + snapshot
 * wiring used by CoachInsightsTab so the two AI analytics surfaces behave the
 * same. The stored result is authoritative — refreshed by the midnight cron or
 * an explicit regenerate — so it's treated as fresh (staleTime: Infinity).
 *
 * `range` is the Analytics page's selected range ("30", "90", ... or "all"):
 * the analysis reads the same numbers as the charts it sits beside.
 * AI31 (CODEBASE_ANALYSIS_2026-10-03)
 */
export function useOverviewAnalysis(range: string = DEFAULT_RANGE) {
  const { user } = useAuth();
  const userId = user?.id;
  const queryClient = useQueryClient();

  // Scoped by userId so signing into a different account in the same tab doesn't
  // render the previous user's analysis from cache, and by range so one range's
  // readings never paint beside another range's charts.
  const keyFor = (forRange: string) => [...QUERY_KEYS.overviewAnalysis, userId ?? "anon", forRange];
  const queryKey = keyFor(range);
  const snapshotKey = userId ? `${SNAPSHOT_PREFIX}:${userId}:${range}` : null;
  const placeholder = useMemo(
    () => (snapshotKey ? readAnalyticsSnapshot<OverviewAnalysisResponse>(snapshotKey) : undefined),
    [snapshotKey],
  );

  const query = useQuery<OverviewAnalysisResponse>({
    queryKey,
    queryFn: () => api.analytics.getOverviewAnalysis(range),
    enabled: !!userId,
    staleTime: Infinity,
    gcTime: Infinity,
    placeholderData: placeholder,
    retry: false,
  });
  useWriteAnalyticsSnapshot(snapshotKey, query.data, query.isPlaceholderData);

  // Explicit (re)generation — spends AI, persists server-side, and updates the
  // cache (which in turn refreshes the snapshot via the effect above). The
  // range rides as the mutation's variable, so a result lands under the range
  // it was generated for even if the athlete switched ranges meanwhile.
  const regenerate = useMutation({
    mutationFn: (forRange: string) => api.analytics.regenerateOverviewAnalysis(forRange),
    onSuccess: (data, forRange) => {
      queryClient.setQueryData(keyFor(forRange), data);
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
    regenerate: () => regenerate.mutate(range),
    isGenerating: regenerate.isPending,
    isLoading: query.isLoading,
    error: regenerate.error ?? query.error,
    canGenerate: !!userId,
  };
}
