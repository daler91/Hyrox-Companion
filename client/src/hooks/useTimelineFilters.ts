import { useState, useMemo } from "react";
import { format } from "date-fns";
import type { TimelineEntry } from "@shared/schema";
import type { FilterStatus } from "@/components/timeline";

export function useTimelineFilters(timelineData: TimelineEntry[]) {
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");
  const [showAllPast, setShowAllPast] = useState(false);
  const [showAllFuture, setShowAllFuture] = useState(false);

  const filteredTimeline = useMemo(() =>
    timelineData.filter((entry) => {
      if (filterStatus === "all") return true;
      return entry.status === filterStatus;
    }),
    [timelineData, filterStatus]
  );

  const { pastGroups, futureGroups, visiblePastGroups, visibleFutureGroups, hiddenPastCount, hiddenFutureCount } = useMemo(() => {
    const groups: Record<string, TimelineEntry[]> = {};
    filteredTimeline.forEach((entry) => {
      if (!groups[entry.date]) {
        groups[entry.date] = [];
      }
      groups[entry.date].push(entry);
    });
    const allGroups = Object.entries(groups).sort(([a], [b]) => {
      // ⚡ Bolt Performance Optimization:
      // Compare ISO date strings ("yyyy-MM-dd") directly via simple comparison
      // rather than using localeCompare or allocating new Date() objects.
      // This is significantly faster and reduces overhead in a heavy useMemo recalculation.
      if (b < a) {
        return -1;
      }
      if (b > a) {
        return 1;
      }
      return 0;
    });

    const today = format(new Date(), "yyyy-MM-dd");
    const past = allGroups.filter(([date]) => date < today);
    const future = allGroups.filter(([date]) => date >= today).reverse();

    const visPast = showAllPast ? past : past.slice(0, 7);
    const visFuture = showAllFuture ? future : future.slice(0, 7);

    return {
      pastGroups: past,
      futureGroups: future,
      visiblePastGroups: visPast,
      visibleFutureGroups: visFuture,
      hiddenPastCount: past.length - visPast.length,
      hiddenFutureCount: future.length - visFuture.length,
    };
  }, [filteredTimeline, showAllPast, showAllFuture]);

  return {
    filterStatus,
    setFilterStatus,
    showAllPast,
    setShowAllPast,
    showAllFuture,
    setShowAllFuture,
    filteredTimeline,
    pastGroups,
    futureGroups,
    visiblePastGroups,
    visibleFutureGroups,
    hiddenPastCount,
    hiddenFutureCount,
  };
}
