import type { WorkoutLog } from "@shared/schema";

import { api, QUERY_KEYS } from "@/lib/api";
import { humanizeApiError } from "@/lib/queryClient";

import { useApiMutation } from "./useApiMutation";

export type DeviceLinkTarget = { planDayId: string } | { workoutLogId: string };

// A link or unlink moves a recording between rows: the timeline and workout
// lists change shape, a plan day flips status, and the metrics that feed PRs
// and analytics move with the recording.
const DEVICE_LINK_QUERY_KEYS = [
  QUERY_KEYS.timeline,
  QUERY_KEYS.workouts,
  QUERY_KEYS.plans,
  QUERY_KEYS.personalRecords,
  QUERY_KEYS.exerciseAnalytics,
  QUERY_KEYS.trainingOverview,
] as const;

/**
 * The athlete's override of the sync's matcher, from the timeline card:
 * merge a standalone Strava import into the planned session or logged
 * workout it belongs to, split a linked recording back out, or wave off a
 * suggestion. Errors surface as toasts; success refetches what moved.
 */
export function useDeviceLinkMutations() {
  const linkMutation = useApiMutation<
    WorkoutLog,
    Error,
    { workoutLogId: string; target: DeviceLinkTarget; targetLabel: string }
  >({
    mutationFn: ({ workoutLogId, target }) => api.workouts.linkDeviceActivity(workoutLogId, target),
    invalidateQueries: DEVICE_LINK_QUERY_KEYS,
    successToast: (_data, { targetLabel }) => ({
      title: `Linked to ${targetLabel}`,
      description: "The Strava recording now sits on that workout.",
    }),
    errorToast: (error) => ({
      title: "Couldn't link the Strava activity",
      description: humanizeApiError(error),
    }),
  });

  const unlinkMutation = useApiMutation<
    { log: WorkoutLog | null; standalone: WorkoutLog },
    Error,
    { workoutLogId: string }
  >({
    mutationFn: ({ workoutLogId }) => api.workouts.unlinkDeviceActivity(workoutLogId),
    invalidateQueries: DEVICE_LINK_QUERY_KEYS,
    successToast: () => ({
      title: "Strava activity unlinked",
      description: "It's back on the timeline as its own workout.",
    }),
    errorToast: (error) => ({
      title: "Couldn't unlink the Strava activity",
      description: humanizeApiError(error),
    }),
  });

  // Silent on success: the prompt simply disappears with the refetch.
  const dismissMutation = useApiMutation<WorkoutLog, Error, { workoutLogId: string }>({
    mutationFn: ({ workoutLogId }) => api.workouts.dismissDeviceLinkSuggestion(workoutLogId),
    invalidateQueries: [QUERY_KEYS.timeline],
    errorToast: (error) => ({
      title: "Couldn't dismiss the suggestion",
      description: humanizeApiError(error),
    }),
  });

  return { linkMutation, unlinkMutation, dismissMutation };
}
