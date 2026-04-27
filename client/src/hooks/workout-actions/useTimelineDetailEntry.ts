import type { TimelineEntry } from "@shared/schema";
import { useCallback, useMemo, useState } from "react";

import { useOpenWorkoutId } from "../useOpenWorkoutId";
import { entryId } from "./timelineEntry";

export function useTimelineDetailEntry(timelineData: TimelineEntry[]) {
  const { openWorkoutId, setOpenWorkoutId } = useOpenWorkoutId();
  // Locally cache the entry passed into openDetailDialog so the dialog can
  // render immediately from the click handler's data.
  const [cachedEntry, setCachedEntry] = useState<TimelineEntry | null>(null);

  // ⚡ Bolt Performance Optimization:
  // Pre-index timeline data by entryId into a Map for O(1) lookups.
  // This avoids O(N) Array.prototype.find() on potentially large timelines.
  const timelineMap = useMemo(() => {
    const map = new Map<string, TimelineEntry>();
    for (const entry of timelineData) {
      const key = entryId(entry);
      if (key && !map.has(key)) map.set(key, entry);
    }
    return map;
  }, [timelineData]);

  const detailEntry = useMemo<TimelineEntry | null>(() => {
    if (!openWorkoutId) return null;
    if (cachedEntry && entryId(cachedEntry) === openWorkoutId) {
      return cachedEntry;
    }
    return timelineMap.get(openWorkoutId) ?? null;
  }, [openWorkoutId, cachedEntry, timelineMap]);

  const setDetailEntry = useCallback(
    (entry: TimelineEntry | null) => {
      setCachedEntry(entry);
      setOpenWorkoutId(entry ? entryId(entry) : null);
    },
    [setOpenWorkoutId],
  );

  return {
    detailEntry,
    setDetailEntry,
  };
}
