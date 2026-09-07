import { api, QUERY_KEYS } from "@/lib/api";
import type { StravaSyncResponse } from "@/lib/api/user";
import { humanizeApiError, queryClient } from "@/lib/queryClient";

import { useApiMutation } from "./useApiMutation";

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

/**
 * Where the synced activities landed, for the toast. A sync now enriches the
 * workout the athlete already logged, or completes the open plan day, before
 * it falls back to a standalone import — so "imported" alone would hide the
 * part that matters. When the server sends no breakdown (nothing new, or a
 * server that predates enrichment) the text reads exactly as it used to.
 */
export function describeStravaSync(data: StravaSyncResponse): string {
  const enriched = data.enriched ?? 0;
  const completed = data.completedPlanDays ?? 0;
  const asNew = (data.suggested ?? 0) + (data.standalone ?? 0);
  const landed: string[] = [];
  if (enriched > 0)
    landed.push(`${enriched} added to ${plural(enriched, "a workout", "workouts")} you logged`);
  if (completed > 0)
    landed.push(
      `${completed} completed ${plural(completed, "a planned session", "planned sessions")}`,
    );
  if (asNew > 0) landed.push(`${asNew} added as new`);
  const breakdown = landed.length > 0 ? ` (${landed.join(", ")})` : "";
  return (
    `Imported ${data.imported} new activities${breakdown}. ${data.skipped} already existed.` +
    (data.hasMore ? " More activities are available — run Sync again." : "")
  );
}

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
      description: describeStravaSync(data),
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
