import type { TimelineEntry } from "@shared/schema";
import { useCallback, useMemo, useState } from "react";

import { useOpenWorkoutId } from "../useOpenWorkoutId";
import { entryId } from "./timelineEntry";

export function useTimelineDetailEntry(timelineData: TimelineEntry[]) {
  const { openWorkoutId, setOpenWorkoutId } = useOpenWorkoutId();
  // Locally cache the entry passed into openDetailDialog so the dialog can
  // render immediately from the click handler's data.
  const [cachedEntry, setCachedEntry] = useState<TimelineEntry | null>(null);

  const detailEntry = useMemo<TimelineEntry | null>(() => {
    if (!openWorkoutId) return null;
    if (cachedEntry && entryId(cachedEntry) === openWorkoutId) {
      return cachedEntry;
    }
    return timelineData.find((entry) => entryId(entry) === openWorkoutId) ?? null;
  }, [openWorkoutId, cachedEntry, timelineData]);

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
