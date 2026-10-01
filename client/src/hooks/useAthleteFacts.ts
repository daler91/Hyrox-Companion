import type { AthleteFact } from "@shared/schema";
import { useQuery } from "@tanstack/react-query";

import { api, QUERY_KEYS } from "@/lib/api";

/** Every fact on the athlete card, retired ones included, oldest first. */
export function useAthleteFacts({ enabled = true }: { readonly enabled?: boolean } = {}) {
  return useQuery<AthleteFact[]>({
    queryKey: QUERY_KEYS.athleteFacts,
    queryFn: () => api.athleteFacts.list(),
    enabled,
  });
}
