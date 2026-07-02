import { useEffect } from "react";

import { flushQueue, getPendingCount } from "@/lib/offlineQueue";

/**
 * Drain the offline queue once on mount when the app boots already-online
 * with pending writes. The queue module also auto-flushes on the `online`
 * event, but that never fires for a tab that was closed while offline and
 * reopened online — this closes that gap. Mount once near the app root.
 */
export function useOfflineQueueFlush() {
  useEffect(() => {
    if (globalThis.navigator?.onLine === false) return;
    if (getPendingCount() === 0) return;
    void flushQueue().catch(() => {
      // Per-mutation failures are handled inside flushQueue; this only
      // guards unexpected errors (e.g. localStorage unavailable).
    });
  }, []);
}
