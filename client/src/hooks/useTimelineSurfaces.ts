import type { TimelineEntry } from "@shared/schema";
import { format } from "date-fns";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useOpenWorkoutId } from "@/hooks/useOpenWorkoutId";
import { entryId, surfaceId } from "@/hooks/workout-actions/timelineEntry";

function isFuturePlanned(entry: TimelineEntry): boolean {
  if (entry.status !== "planned") return false;
  const todayStr = format(new Date(), "yyyy-MM-dd");
  return entry.date > todayStr;
}

function isLoggablePlanned(entry: TimelineEntry): boolean {
  if (entry.status !== "planned") return false;
  if (!entry.planDayId) return false;
  const todayStr = format(new Date(), "yyyy-MM-dd");
  return entry.date <= todayStr;
}

function isReviewable(entry: TimelineEntry): boolean {
  return Boolean(entry.workoutLogId) && entry.status !== "skipped";
}

function isSkipped(entry: TimelineEntry): boolean {
  return entry.status === "skipped";
}

function isMissed(entry: TimelineEntry): boolean {
  return entry.status === "missed" && Boolean(entry.planDayId);
}

export function useTimelineSurfaces(timelineData: TimelineEntry[]) {
  const [previewEntry, setPreviewEntry] = useState<TimelineEntry | null>(null);
  const [logEntry, setLogEntry] = useState<TimelineEntry | null>(null);
  const [reviewEntry, setReviewEntry] = useState<TimelineEntry | null>(null);
  const [skippedEntry, setSkippedEntry] = useState<TimelineEntry | null>(null);
  const { openWorkoutId, setOpenWorkoutId } = useOpenWorkoutId();
  const sheetEverOpenedRef = useRef(false);

  const closeAllSurfaces = useCallback(() => {
    setPreviewEntry(null);
    setLogEntry(null);
    setReviewEntry(null);
    setSkippedEntry(null);
  }, []);

  const closeAllSurfacesAndClearUrl = useCallback(() => {
    closeAllSurfaces();
    if (openWorkoutId !== null) setOpenWorkoutId(null);
  }, [closeAllSurfaces, openWorkoutId, setOpenWorkoutId]);

  const openSurface = useCallback((entry: TimelineEntry) => {
    const id = surfaceId(entry);
    if (
      (isFuturePlanned(entry) && previewEntry && surfaceId(previewEntry) === id) ||
      (isLoggablePlanned(entry) && logEntry && surfaceId(logEntry) === id) ||
      (isMissed(entry) && logEntry && surfaceId(logEntry) === id) ||
      (isReviewable(entry) && reviewEntry && surfaceId(reviewEntry) === id) ||
      (isSkipped(entry) && skippedEntry && surfaceId(skippedEntry) === id)
    ) return;

    sheetEverOpenedRef.current = true;
    closeAllSurfaces();

    if (isFuturePlanned(entry)) return setPreviewEntry(entry);
    if (isLoggablePlanned(entry) || isMissed(entry)) return setLogEntry(entry);
    if (isReviewable(entry)) return setReviewEntry(entry);
    if (isSkipped(entry)) setSkippedEntry(entry);
  }, [closeAllSurfaces, logEntry, previewEntry, reviewEntry, skippedEntry]);

  const openSheetEntry = previewEntry ?? logEntry ?? reviewEntry ?? skippedEntry ?? null;
  const openSheetEntryId = openSheetEntry ? surfaceId(openSheetEntry) : null;

  useEffect(() => {
    if (openSheetEntryId !== null) {
      sheetEverOpenedRef.current = true;
      if (openWorkoutId !== openSheetEntryId) setOpenWorkoutId(openSheetEntryId);
      return;
    }
    if (sheetEverOpenedRef.current && openWorkoutId !== null) setOpenWorkoutId(null);
  }, [openSheetEntryId, openWorkoutId, setOpenWorkoutId]);

  useEffect(() => {
    if (!openWorkoutId) {
      if (globalThis.window !== undefined) {
        const liveWorkoutId = new URLSearchParams(globalThis.window.location.search).get("workout");
        if (liveWorkoutId !== null) return;
      }
      if (openSheetEntryId !== null) queueMicrotask(closeAllSurfaces);
      return;
    }
    if (openSheetEntryId === openWorkoutId) return;
    const target = timelineData.find((e) => surfaceId(e) === openWorkoutId || entryId(e) === openWorkoutId);
    if (!target) return;
    if (openSheetEntry && surfaceId(openSheetEntry) === surfaceId(target)) return;
    queueMicrotask(() => openSurface(target));
  }, [openWorkoutId, openSheetEntry, openSheetEntryId, timelineData, openSurface, closeAllSurfaces]);

  const anySurfaceOpen = useMemo(() => Boolean(previewEntry || logEntry || reviewEntry || skippedEntry), [previewEntry, logEntry, reviewEntry, skippedEntry]);

  return {
    previewEntry, setPreviewEntry,
    logEntry, setLogEntry,
    reviewEntry, setReviewEntry,
    skippedEntry, setSkippedEntry,
    openSurface,
    closeAllSurfacesAndClearUrl,
    anySurfaceOpen,
  };
}
