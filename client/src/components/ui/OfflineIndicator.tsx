import { CheckCircle2, CloudUpload, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";

import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { getPendingCount } from "@/lib/offlineQueue";

const OFFLINE_POLL_INTERVAL_MS = 2000;
const SYNC_SUCCESS_DISMISS_MS = 3500;

/**
 * Persistent status pill that surfaces offline / pending-sync state so the
 * user always knows where their in-flight data is. Three display states:
 *
 * - Offline + no queue: "You're offline"
 * - Offline + queued writes: "You're offline — N change(s) will sync"
 * - Online right after auto-sync: "Back online — N change(s) synced"
 *   (auto-dismisses after ~3.5s)
 */
export function OfflineIndicator() {
  const isOnline = useOnlineStatus();
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
    const handleSyncComplete = (event: Event) => {
      const detail = (event as CustomEvent<{ synced: number }>).detail;
      if (detail && detail.synced > 0) {
        setRecentlySynced(detail.synced);
        setPendingCount(0);
        const timeoutId = setTimeout(() => {
          setRecentlySynced(null);
        }, SYNC_SUCCESS_DISMISS_MS);
        return () => clearTimeout(timeoutId);
      }
      return undefined;
    };
    globalThis.addEventListener("offline-sync-complete", handleSyncComplete);
    return () => globalThis.removeEventListener("offline-sync-complete", handleSyncComplete);
  }, []);

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

  if (isOnline) return null;

  return (
    <div
      className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-lg bg-destructive px-4 py-2 text-destructive-foreground shadow-lg"
      role="alert"
      aria-live="assertive"
      data-testid="indicator-offline"
    >
      <WifiOff className="h-4 w-4" />
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
