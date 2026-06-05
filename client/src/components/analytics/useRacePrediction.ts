import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";

import { useAuth } from "@/hooks/useAuth";
import { readAnalyticsSnapshot, useWriteAnalyticsSnapshot } from "@/lib/analyticsSnapshot";
import { api, QUERY_KEYS, type RacePredictionView } from "@/lib/api";

// Per-user localStorage snapshot key so a fresh page load paints the previous
// prediction instantly (no spinner) and a different account never sees it.
const SNAPSHOT_PREFIX = "fitai-race-prediction-cache";

/**
 * Fetches the athlete's predicted HYROX finish time. The GET now returns the
 * stored prediction instantly (no AI spend); a manual refresh forces a fresh
 * regeneration via `?refresh=1`. Scoped by userId so a different signed-in
 * account never reads a stale slot.
 */
export function useRacePrediction() {
  const { user } = useAuth();
  const userId = user?.id ?? "anon";
  const queryClient = useQueryClient();
  const queryKey = [...QUERY_KEYS.racePrediction, userId];
  const snapshotKey = user?.id ? `${SNAPSHOT_PREFIX}:${user.id}` : null;
  const placeholder = useMemo(
    () => (snapshotKey ? readAnalyticsSnapshot<RacePredictionView>(snapshotKey) : undefined),
    [snapshotKey],
  );

  const query = useQuery<RacePredictionView>({
    queryKey,
    queryFn: () => api.analytics.getRacePrediction(),
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    placeholderData: placeholder,
    retry: false,
  });
  useWriteAnalyticsSnapshot(snapshotKey, query.data, query.isPlaceholderData);

  // Manual "Refresh prediction" — forces server-side regeneration (may spend AI
  // budget) and writes the fresh result back into the query cache.
  const refresh = useMutation({
    mutationFn: () => api.analytics.getRacePrediction({ refresh: true }),
    onSuccess: (data) => queryClient.setQueryData(queryKey, data),
  });

  return {
    query,
    refresh: () => refresh.mutate(),
    isRefreshing: refresh.isPending,
  };
}
