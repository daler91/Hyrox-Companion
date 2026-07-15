import { api, QUERY_KEYS } from "@/lib/api";
import { humanizeApiError, queryClient } from "@/lib/queryClient";

import { useApiMutation } from "./useApiMutation";

export function useStravaMutations() {
  const connectStravaMutation = useApiMutation({
    mutationFn: () => api.strava.auth(),
    onSuccess: (data) => {
      globalThis.location.href = data.authUrl;
    },
    errorToast: "Failed to initiate Strava connection.",
  });

  const disconnectStravaMutation = useApiMutation({
    mutationFn: () => api.strava.disconnect(),
    invalidateQueries: [QUERY_KEYS.stravaStatus],
    successToast: () => ({
      title: "Strava Disconnected",
      description: "Your Strava account has been disconnected.",
    }),
    errorToast: "Failed to disconnect Strava.",
  });

  const syncStravaMutation = useApiMutation({
    mutationFn: () => api.strava.sync(),
    invalidateQueries: [
      QUERY_KEYS.stravaStatus,
      QUERY_KEYS.timeline,
      QUERY_KEYS.workouts,
      // New Strava activities can set PRs and shift analytics — invalidate both.
      QUERY_KEYS.personalRecords,
      QUERY_KEYS.exerciseAnalytics,
    ],
    successToast: (data) => ({
      title: "Sync Complete",
      description:
        `Imported ${data.imported} new activities. ${data.skipped} already existed.` +
        (data.hasMore ? " More activities are available — run Sync again." : ""),
    }),
    errorToast: (error) =>
      // The API client throws Error("<status>: <body>"), so the server's
      // error code is present in the message.
      error.message.includes("STRAVA_REAUTH_REQUIRED")
        ? {
            title: "Strava reconnection needed",
            description: "Strava access was revoked. Please reconnect your account.",
          }
        : {
            title: "Failed to sync activities from Strava.",
            description: humanizeApiError(error),
          },
    onError: () => {
      // A revocation discovered mid-sync flips /status to requiresReauth —
      // refetch so the section immediately shows the Reconnect state.
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.stravaStatus });
    },
  });

  return {
    connectStravaMutation,
    disconnectStravaMutation,
    syncStravaMutation,
  };
}
