import { useCallback } from "react";

import { markLocalOnboardingComplete } from "@/hooks/onboardingStorage";
import { api, QUERY_KEYS } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";

export function useCompleteOnboarding(): () => void {
  return useCallback(() => {
    markLocalOnboardingComplete();
    api.preferences
      .update({ onboardingCompleted: true })
      .then(() => {
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.authUser }).catch(() => {});
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.preferences }).catch(() => {});
      })
      .catch(() => {
        // Local fallback preserves same-device UX; the server flag can sync later.
      });
  }, []);
}
