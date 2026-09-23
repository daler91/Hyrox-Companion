import { useMutation } from "@tanstack/react-query";

import { api, QUERY_KEYS } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";

/**
 * Turns the AI Coach on: the consent every AI route checks before it sends
 * anything to the model (server/middleware/aiConsent.ts). Refreshes the auth
 * user and preferences, so every consent check on the page sees the change.
 */
export function useEnableAiCoach() {
  return useMutation({
    mutationFn: () => api.preferences.update({ aiCoachEnabled: true }),
    onSuccess: () => {
      Promise.all([
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.authUser }),
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.preferences }),
      ]).catch(() => {
        // The consent is saved; a failed refetch only delays showing it.
      });
    },
  });
}
