import { api, QUERY_KEYS } from "@/lib/api";
import {
  EXERCISE_HISTORY_QUERY_PREFIX,
  WORKOUT_DERIVED_NUTRITION_QUERY_KEYS,
} from "@/lib/workoutInvalidation";

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
    // The string form describes the error with humanizeApiError, which shows
    // the server's own copy (translated by translateGarminError: rate-limit,
    // 2-step verification, bad password). Printing error.message showed the
    // raw `401: {"error":...,"code":"GARMIN_AUTH_FAILED"}`.
    // U28 (CODEBASE_ANALYSIS_2026-10-03)
    errorToast: "Garmin Connection Failed",
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
      // The imported workouts add to their days' training load, calories and
      // meal targets. CL19 (CODEBASE_ANALYSIS_2026-10-03)
      ...WORKOUT_DERIVED_NUTRITION_QUERY_KEYS,
      // Each imported recording is a session in its exercise's "Last time"
      // history. CL43 (CODEBASE_ANALYSIS_2026-10-03)
      EXERCISE_HISTORY_QUERY_PREFIX,
    ],
    successToast: (data) => ({
      title: "Sync Complete",
      description: `Imported ${data.imported} new activities. ${data.skipped} already existed.`,
    }),
    errorToast: "Garmin Sync Failed",
  });

  return {
    connectGarminMutation,
    disconnectGarminMutation,
    syncGarminMutation,
  };
}
