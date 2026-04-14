import { api, QUERY_KEYS } from "@/lib/api";

import { useApiMutation } from "./useApiMutation";

export function useGarminMutations() {
  const connectGarminMutation = useApiMutation<
    { success: boolean; garminDisplayName?: string | null },
    Error,
    { email: string; password: string }
  >({
    mutationFn: ({ email, password }) => api.garmin.connect(email, password),
    invalidateQueries: [QUERY_KEYS.garminStatus],
    successToast: () => ({
      title: "Garmin Connected",
      description: "Your Garmin account has been successfully connected.",
    }),
    // Use the message from the server response (translated by translateGarminError)
    // rather than a generic toast — Garmin errors are highly varied (rate-limit,
    // 2-step verification, bad password) and the server already produced the
    // user-facing copy.
    errorToast: (error) => ({
      title: "Garmin Connection Failed",
      description: error instanceof Error ? error.message : "An error occurred",
    }),
  });

  const disconnectGarminMutation = useApiMutation({
    mutationFn: () => api.garmin.disconnect(),
    invalidateQueries: [QUERY_KEYS.garminStatus],
    successToast: () => ({
      title: "Garmin Disconnected",
      description: "Your Garmin account has been disconnected.",
    }),
    errorToast: "Failed to disconnect Garmin.",
  });

  const syncGarminMutation = useApiMutation({
    mutationFn: () => api.garmin.sync(),
    invalidateQueries: [
      QUERY_KEYS.garminStatus,
      QUERY_KEYS.timeline,
      QUERY_KEYS.workouts,
      // New Garmin activities can set PRs and shift analytics — invalidate both.
      QUERY_KEYS.personalRecords,
      QUERY_KEYS.exerciseAnalytics,
    ],
    successToast: (data) => ({
      title: "Sync Complete",
      description: `Imported ${data.imported} new activities. ${data.skipped} already existed.`,
    }),
    errorToast: (error) => ({
      title: "Garmin Sync Failed",
      description: error instanceof Error ? error.message : "An error occurred",
    }),
  });

  return {
    connectGarminMutation,
    disconnectGarminMutation,
    syncGarminMutation,
  };
}
