import { useApiMutation } from "./useApiMutation";
import { api, QUERY_KEYS } from "@/lib/api";

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
    invalidateQueries: [QUERY_KEYS.stravaStatus, QUERY_KEYS.timeline, QUERY_KEYS.workouts],
    successToast: (data) => ({
      title: "Sync Complete",
      description: `Imported ${data.imported} new activities. ${data.skipped} already existed.`,
    }),
    errorToast: "Failed to sync activities from Strava.",
  });

  return {
    connectStravaMutation,
    disconnectStravaMutation,
    syncStravaMutation,
  };
}
