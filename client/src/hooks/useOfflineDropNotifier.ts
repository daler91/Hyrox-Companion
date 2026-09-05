import { useEffect } from "react";

import { toast } from "@/hooks/use-toast";
import { type DroppedMutationInfo,onMutationDropped } from "@/lib/offlineQueue";

// A Record over the union keeps the exhaustiveness the switch gave us — a new
// drop reason fails to compile until it is given a label here.
const REASON_LABELS: Record<DroppedMutationInfo["reason"], string> = {
  max_retries: "too many failed attempts",
  max_age: "it expired after 7 days",
  queue_overflow: "the offline queue was full",
  storage_full: "this device ran out of offline storage",
};

/**
 * Subscribe to the offline mutation queue and show a toast whenever a
 * mutation is permanently dropped (data loss). Mount once near the app root.
 */
export function useOfflineDropNotifier() {
  useEffect(() => {
    const unsubscribe = onMutationDropped((info) => {
      toast({
        variant: "destructive",
        title: "Unsaved change lost",
        description: `A ${info.method} request to ${info.url} was dropped because ${REASON_LABELS[info.reason]} (${info.retryCount} retries).`,
      });
    });
    return unsubscribe;
  }, []);
}
