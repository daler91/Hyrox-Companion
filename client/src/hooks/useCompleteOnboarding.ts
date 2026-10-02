import { useCallback } from "react";

import { markLocalOnboardingComplete } from "@/hooks/onboardingStorage";
import { api, QUERY_KEYS } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";

export function useCompleteOnboarding(): () => void {
  return useCallback(() => {
    markLocalOnboardingComplete();
    const syncServerFlag = async () => {
      await api.preferences.update({ onboardingCompleted: true });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.authUser }),
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.preferences }),
      ]);
    };
    syncServerFlag().catch(() => {
      // Local fallback preserves same-device UX; the server flag can sync later.
    });
  }, []);
}
