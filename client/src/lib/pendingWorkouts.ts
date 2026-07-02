import type { TimelineEntry } from "@shared/schema";

import type { PendingMutation } from "./offlineQueue";

export const WORKOUT_CREATE_URL = "/api/v1/workouts";

const PENDING_ENTRY_ID_PREFIX = "pending-";

/**
 * A synthetic timeline entry derived from a queued-but-unsynced workout
 * create. Client-only: it never exists in server responses, and disappears
 * once the queue drains and the post-sync invalidation refetches the real
 * row.
 */
export type PendingTimelineEntry = TimelineEntry & { readonly pending: true };

export function isPendingTimelineEntry(entry: TimelineEntry): entry is PendingTimelineEntry {
  return (entry as Partial<PendingTimelineEntry>).pending === true;
}

export function isPendingWorkoutCreate(mutation: PendingMutation): boolean {
  return mutation.method === "POST" && mutation.url === WORKOUT_CREATE_URL;
}

// The subset of the queued SaveWorkoutInput body the overlay renders.
// Queue bodies are zod-validated only as `unknown`, so read defensively.
interface QueuedWorkoutBody {
  date?: string;
  title?: string;
  focus?: string;
  mainWorkout?: string;
  accessory?: string | null;
  notes?: string | null;
  duration?: number | null;
  rpe?: number | null;
}

export function buildPendingTimelineEntry(mutation: PendingMutation): PendingTimelineEntry {
  const body: QueuedWorkoutBody =
    typeof mutation.body === "object" && mutation.body !== null ? mutation.body : {};
  return {
    id: `${PENDING_ENTRY_ID_PREFIX}${mutation.id}`,
    date: body.date ?? new Date(mutation.timestamp).toISOString().slice(0, 10),
    type: "logged",
    status: "completed",
    focus: body.focus || body.title || "Workout",
    mainWorkout: body.mainWorkout ?? "",
    accessory: body.accessory ?? null,
    notes: body.notes ?? null,
    duration: body.duration ?? null,
    rpe: body.rpe ?? null,
    // Deliberately unlinked: leaving plan ids off keeps plan-scoped flows
    // (move / bulk delete / status change) from targeting a row that does
    // not exist server-side yet.
    planDayId: null,
    planId: null,
    workoutLogId: null,
    source: "manual",
    exerciseSets: [],
    pending: true,
  };
}
