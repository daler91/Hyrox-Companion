import { useSyncExternalStore } from "react";

import {
  getPendingMutations,
  OFFLINE_QUEUE_CHANGE_EVENT,
  OFFLINE_SYNC_COMPLETE_EVENT,
} from "@/lib/offlineQueue";
import {
  buildPendingTimelineEntry,
  isPendingWorkoutCreate,
  type PendingTimelineEntry,
} from "@/lib/pendingWorkouts";

const EMPTY: PendingTimelineEntry[] = [];

// Cache the derived array so getSnapshot returns a stable reference between
// queue changes — useSyncExternalStore re-renders if the snapshot identity
// changes, so we only rebuild when the queue actually fires an event.
let cachedEntries: PendingTimelineEntry[] = EMPTY;

function rebuild(): PendingTimelineEntry[] {
  const pending = getPendingMutations().filter(isPendingWorkoutCreate);
  cachedEntries = pending.length === 0 ? EMPTY : pending.map(buildPendingTimelineEntry);
  return cachedEntries;
}

function subscribe(onChange: () => void): () => void {
  const handler = () => {
    rebuild();
    onChange();
  };
  globalThis.addEventListener(OFFLINE_QUEUE_CHANGE_EVENT, handler);
  globalThis.addEventListener(OFFLINE_SYNC_COMPLETE_EVENT, handler);
  return () => {
    globalThis.removeEventListener(OFFLINE_QUEUE_CHANGE_EVENT, handler);
    globalThis.removeEventListener(OFFLINE_SYNC_COMPLETE_EVENT, handler);
  };
}

function getSnapshot(): PendingTimelineEntry[] {
  return cachedEntries;
}

function getServerSnapshot(): PendingTimelineEntry[] {
  return EMPTY;
}

/**
 * Queued-but-unsynced workout creates rendered as synthetic timeline
 * entries. Derived from the offline queue itself (localStorage-backed, so
 * they survive a reload) and refreshed on queue-change / sync-complete.
 */
export function usePendingWorkoutEntries(): PendingTimelineEntry[] {
  // Prime the cache on first read so an already-populated queue shows
  // immediately without waiting for the next event.
  if (cachedEntries === EMPTY) rebuild();
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
