import { CheckCircle2, CloudUpload, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";

import { useToast } from "@/hooks/use-toast";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { invalidateForSyncedRequests } from "@/lib/offlineInvalidation";
import {
  getPendingCount,
  OFFLINE_QUEUE_CHANGE_EVENT,
  OFFLINE_SYNC_COMPLETE_EVENT,
  type OfflineQueueChangeDetail,
  type OfflineSyncCompleteDetail,
} from "@/lib/offlineQueue";

const OFFLINE_POLL_INTERVAL_MS = 2000;
const SYNC_SUCCESS_DISMISS_MS = 3500;

/**
 * Persistent status pill that surfaces offline / pending-sync state so the
 * user always knows where their in-flight data is. Three display states:
 *
 * - Offline + no queue: "You're offline"
 * - Offline + queued writes: "You're offline - N change(s) will sync"
 * - Online + queued writes: "Sync pending"
 * - Online right after auto-sync: "Back online - N change(s) synced"
 *   (auto-dismisses after ~3.5s)
 */
export function OfflineIndicator() {
  const isOnline = useOnlineStatus();
  const { toast } = useToast();
  // Lazy initializer reads the queue length once on mount so the first
  // render already reflects reality without setState-in-effect patterns.
  const [pendingCount, setPendingCount] = useState<number>(() => getPendingCount());
  const [recentlySynced, setRecentlySynced] = useState<number | null>(null);

  // Poll queue length while offline so the pill stays accurate as the user
  // logs more workouts. When online we just listen for the sync-complete
  // event dispatched from offlineQueue.flushQueue.
  useEffect(() => {
    if (isOnline) return;
    const intervalId = setInterval(() => {
      setPendingCount(getPendingCount());
    }, OFFLINE_POLL_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [isOnline]);

  useEffect(() => {
    const handleQueueChange = (event: Event) => {
      const detail = (event as CustomEvent<OfflineQueueChangeDetail>).detail;
      setPendingCount(detail?.pendingCount ?? getPendingCount());
    };

    globalThis.addEventListener(OFFLINE_QUEUE_CHANGE_EVENT, handleQueueChange);
    return () => {
      globalThis.removeEventListener(OFFLINE_QUEUE_CHANGE_EVENT, handleQueueChange);
    };
  }, []);

  useEffect(() => {
    // Track the pending dismiss timer in effect scope so back-to-back
    // sync events don't leave stale timers that clear recentlySynced
    // before the latest success badge has been shown for its full duration.
    let dismissTimerId: ReturnType<typeof setTimeout> | null = null;

    const handleSyncComplete = (event: Event) => {
      const detail = (event as CustomEvent<OfflineSyncCompleteDetail>).detail;
      if (!detail) return;
      if (detail.dropped > 0) {
        // Surface the drop explicitly so users aren't silently losing logged
        // workouts after prolonged offline periods (7d / 5 retry limit).
        toast({
          title: "Some offline changes couldn't be synced",
          description: `${detail.dropped} change${detail.dropped === 1 ? " was" : "s were"} discarded after too many failed attempts. Please re-enter recent edits.`,
          variant: "destructive",
          duration: 10_000,
        });
      }
      if (detail.synced <= 0) return;
      // Route invalidation by which endpoints actually replayed, so a synced
      // nutrition log refreshes nutrition summaries and not just workouts.
      invalidateForSyncedRequests(detail.syncedRequests);
      setRecentlySynced(detail.synced);
      setPendingCount(getPendingCount());
      if (dismissTimerId !== null) {
        clearTimeout(dismissTimerId);
      }
      dismissTimerId = setTimeout(() => {
        setRecentlySynced(null);
        dismissTimerId = null;
      }, SYNC_SUCCESS_DISMISS_MS);
    };

    globalThis.addEventListener(OFFLINE_SYNC_COMPLETE_EVENT, handleSyncComplete);
    return () => {
      if (dismissTimerId !== null) {
        clearTimeout(dismissTimerId);
      }
      globalThis.removeEventListener(OFFLINE_SYNC_COMPLETE_EVENT, handleSyncComplete);
    };
  }, [toast]);

  if (isOnline && recentlySynced !== null) {
    return (
      <div
        className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-white shadow-lg"
        role="status"
        aria-live="polite"
        data-testid="indicator-sync-complete"
      >
        <CheckCircle2 className="h-4 w-4" />
        <span className="text-sm font-medium">
          Back online — {recentlySynced} change{recentlySynced === 1 ? "" : "s"} synced
        </span>
      </div>
    );
  }

  if (isOnline && pendingCount > 0) {
    return (
      <div
        className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-white shadow-lg"
        role="status"
        aria-live="polite"
        data-testid="indicator-sync-pending"
      >
        <CloudUpload className="h-4 w-4" aria-hidden="true" />
        <span className="text-sm font-medium">
          Sync pending - {pendingCount} change{pendingCount === 1 ? "" : "s"} waiting
        </span>
      </div>
    );
  }

  if (isOnline) return null;

  return (
    <div
      className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-lg bg-destructive px-4 py-2 text-destructive-foreground shadow-lg"
      // WCAG 4.1.3: status, not alert. Offline is informational — work
      // continues to be queued — so it shouldn't interrupt AT users mid-task.
      role="status"
      aria-live="polite"
      data-testid="indicator-offline"
    >
      <WifiOff className="h-4 w-4" aria-hidden="true" />
      <div className="flex flex-col leading-tight">
        <span className="text-sm font-medium">You&apos;re offline</span>
        {pendingCount > 0 ? (
          <span className="text-xs font-normal opacity-90 flex items-center gap-1">
            <CloudUpload className="h-3 w-3" aria-hidden="true" />
            {pendingCount} change{pendingCount === 1 ? "" : "s"} will sync when you reconnect
          </span>
        ) : null}
      </div>
    </div>
  );
}
