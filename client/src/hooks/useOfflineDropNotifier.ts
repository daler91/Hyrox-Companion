import { useEffect } from "react";

import { toast } from "@/hooks/use-toast";
import { type DroppedMutationInfo,onMutationDropped } from "@/lib/offlineQueue";

function reasonLabel(reason: DroppedMutationInfo["reason"]): string {
  switch (reason) {
    case "max_retries":
      return "too many failed attempts";
    case "max_age":
      return "it expired after 7 days";
    case "queue_overflow":
      return "the offline queue was full";
  }
}

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
        description: `A ${info.method} request to ${info.url} was dropped because ${reasonLabel(info.reason)} (${info.retryCount} retries).`,
      });
    });
    return unsubscribe;
  }, []);
}
