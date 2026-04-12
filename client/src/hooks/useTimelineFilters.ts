import type { TimelineAnnotation,TimelineEntry } from "@shared/schema";
import { format } from "date-fns";
import { useMemo,useState } from "react";

import type { FilterStatus } from "@/components/timeline";
import { useUrlQueryState } from "@/hooks/useUrlQueryState";

const FILTER_STATUSES: readonly FilterStatus[] = [
  "all",
  "completed",
  "planned",
  "missed",
  "skipped",
];

export function useTimelineFilters(
  timelineData: TimelineEntry[],
  annotations: TimelineAnnotation[] = [],
) {
  const [filterStatus, setFilterStatus] = useUrlQueryState<FilterStatus>(
    "status",
    "all",
    FILTER_STATUSES,
  );
  const [showAllPast, setShowAllPast] = useState(false);
  const [showAllFuture, setShowAllFuture] = useState(false);

  // Note: the status filter only applies to TimelineEntry.status. Annotations
  // have no status, so they render regardless of the current filter — an
  // injury that explains a "missed" workout should still be visible when the
  // user narrows to Missed. Do not "fix" this by filtering annotations too.
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

    // Ensure annotation-only start dates still get a row, so the virtualizer
    // has something to render. Without this, an annotation whose startDate
    // has no matching workout would be silently dropped from the timeline.
    annotations.forEach((annotation) => {
      if (!groups[annotation.startDate]) {
        groups[annotation.startDate] = [];
      }
    });

    // Fast string comparison for YYYY-MM-DD dates instead of localeCompare
    const allGroups = Object.entries(groups).sort(([a], [b]) => {
      if (b < a) return -1;
      if (b > a) return 1;
      return 0;
    });

    const today = format(new Date(), "yyyy-MM-dd");

    // ⚡ Bolt Performance Optimization:
    // Instead of using `.filter()` twice on the entire `allGroups` array (O(N) * 2),
    // we take advantage of the fact that the array is already sorted by date descending.
    // We can just find the split point and slice the array directly.
    // This halves the number of iterations and reduces array allocations.
    let splitIndex = allGroups.findIndex(([date]) => date < today);
    if (splitIndex === -1) {
      splitIndex = allGroups.length;
    }

    const future = allGroups.slice(0, splitIndex).reverse();
    const past = allGroups.slice(splitIndex);

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
  }, [filteredTimeline, annotations, showAllPast, showAllFuture]);

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
