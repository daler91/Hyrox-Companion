import type { User } from "@shared/schema";
import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";

import { markLocalOnboardingComplete } from "@/hooks/onboardingStorage";
import { api, QUERY_KEYS } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";

/**
 * The signed-in athlete's id, read from the cached auth user (useAuth fetches
 * it; this never does), or undefined until it has loaded. The local onboarding
 * flag is kept per athlete with it. CL45 (CODEBASE_ANALYSIS_2026-10-03)
 */
export function useOnboardingUserId(): string | undefined {
  const { data } = useQuery<User, Error, string | undefined>({
    queryKey: QUERY_KEYS.authUser,
    enabled: false,
    select: (user) => user?.id,
  });
  return data;
}

export function useCompleteOnboarding(): () => void {
  const userId = useOnboardingUserId();
  return useCallback(() => {
    markLocalOnboardingComplete(userId);
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
  }, [userId]);
}
