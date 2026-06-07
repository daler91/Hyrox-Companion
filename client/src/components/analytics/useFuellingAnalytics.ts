import { format, subDays } from "date-fns";
import { useMemo } from "react";

import { useBlockView } from "@/hooks/useNutrition";

// "All time" would zero-fill years of days into the chart; cap the block window
// so the intake-vs-load series stays legible (and matches the longest preset).
const MAX_BLOCK_DAYS = 365;

/**
 * Derives the block range from the shared Analytics `dateParams` (e.g.
 * "?from=2026-03-09", or "" for all-time) and loads the intake-vs-training
 * series for it (FR-3.3).
 */
export function useFuellingAnalytics(dateParams: string) {
  const { from, to } = useMemo(() => {
    const search = dateParams.startsWith("?") ? dateParams.slice(1) : dateParams;
    const fromParam = new URLSearchParams(search).get("from");
    return {
      from: fromParam ?? format(subDays(new Date(), MAX_BLOCK_DAYS), "yyyy-MM-dd"),
      to: format(new Date(), "yyyy-MM-dd"),
    };
  }, [dateParams]);

  const query = useBlockView(from, to);
  return { from, to, query };
}
