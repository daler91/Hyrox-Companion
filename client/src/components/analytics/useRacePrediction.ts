import type { RacePredictionResponse } from "@shared/schema";
import { useQuery } from "@tanstack/react-query";

import { useAuth } from "@/hooks/useAuth";
import { api, QUERY_KEYS } from "@/lib/api";

/**
 * Fetches the athlete's predicted HYROX finish time. Cached aggressively
 * because the server may invoke a reasoning AI model (and spend AI budget) to
 * build it — switching analytics tabs unmounts/remounts the consumer, and we
 * don't want that to re-trigger a fresh prediction within the cache window.
 * Scoped by userId so a different signed-in account never reads a stale slot.
 */
export function useRacePrediction() {
  const { user } = useAuth();
  const userId = user?.id ?? "anon";
  return useQuery<RacePredictionResponse>({
    queryKey: [...QUERY_KEYS.racePrediction, userId],
    queryFn: () => api.analytics.getRacePrediction(),
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
  });
}
