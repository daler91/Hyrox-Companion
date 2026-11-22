import { api, QUERY_KEYS } from "@/lib/api";
import { parseApiError } from "@/lib/apiError";
import { humanizeApiError, queryClient } from "@/lib/queryClient";
import {
  EXERCISE_HISTORY_QUERY_PREFIX,
  WORKOUT_ANALYTICS_QUERY_KEYS,
  WORKOUT_DERIVED_NUTRITION_QUERY_KEYS,
} from "@/lib/workoutInvalidation";

import { useApiMutation } from "./useApiMutation";

/**
 * Garmin 5xx codes whose body the server writes for the athlete. A 503
 * GARMIN_CIRCUIT_OPEN means Garmin rate-limited the server, and its body says
 * roughly how long to wait (tech debt #55). A 502 GARMIN_API_ERROR carries the
 * same cooldown message after a rate-limited login, or "try again in a few
 * minutes" after a Garmin hiccup (D11, REFACTORING_REVIEW 2026-09-23).
 */
const ATHLETE_FACING_5XX_CODES = new Set(["GARMIN_CIRCUIT_OPEN", "GARMIN_API_ERROR"]);

/**
 * The toast text for a failed Garmin call. humanizeApiError hides every 5xx
 * body behind "Something went wrong on our end", so the bodies of the codes
 * above are read directly. Anything else is described as usual.
 */
export function describeGarminError(error: unknown): string {
  const code = error instanceof Error ? parseApiError(error)?.code : undefined;
  if (error instanceof Error && code && ATHLETE_FACING_5XX_CODES.has(code)) {
    try {
      const body = JSON.parse(error.message.slice(error.message.indexOf(":") + 1)) as { error?: unknown };
      if (typeof body.error === "string" && body.error.trim()) return body.error;
    } catch {
      // Not JSON: fall through to the usual description.
    }
  }
  return humanizeApiError(error);
}

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
    errorToast: (error) => ({ title: "Garmin Connection Failed", description: describeGarminError(error) }),
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
      // New Garmin activities can set PRs, shift the training overview and
      // grade a linked plan day. D3 (REFACTORING_REVIEW 2026-09-23)
      ...WORKOUT_ANALYTICS_QUERY_KEYS,
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
    errorToast: (error) => ({ title: "Garmin Sync Failed", description: describeGarminError(error) }),
    onError: () => {
      // A refused sync can mean the pause began mid-request (another instance
      // saw Garmin's 429); refetch so the status's syncPausedUntil disables Sync.
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.garminStatus });
    },
  });

  return {
    connectGarminMutation,
    disconnectGarminMutation,
    syncGarminMutation,
  };
}
