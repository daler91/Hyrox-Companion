import { logger } from "../logger";
import { DEFAULT_JOB_OPTIONS, queue } from "../queue";

/**
 * Single producer-side entry point for the auto-coach job.
 *
 * Four call sites used to inline the same `queue.send("auto-coach", …)` block
 * with their own copy of the singleton key and window. Keeping one definition
 * matters more than the duplication saved: the coalescing guarantee is only
 * real while EVERY producer agrees on the key, so a fifth trigger that typo'd
 * the key would quietly give one athlete two concurrent coach runs (and two
 * AI bills) for the same edit.
 *
 * The 60s singleton window is what makes it safe to call this from a
 * per-keystroke write path: a burst of set edits, a drag of three workouts, or
 * a bulk CSV import all collapse into one coach pass per athlete.
 */
export const AUTO_COACH_QUEUE = "auto-coach";

/** Window over which repeat triggers for one athlete collapse into a single job. */
export const AUTO_COACH_DEBOUNCE_SECONDS = 60;

/** Why the coach is being re-run. Log-only; the worker reads just `userId`. */
export type AutoCoachTrigger =
  | "workout-created"
  | "workout-date-changed"
  | "logged-sets-edited"
  | "plan-day-completed"
  | "plan-day-rescheduled";

function autoCoachJobOptions(userId: string) {
  return {
    ...DEFAULT_JOB_OPTIONS,
    singletonKey: `${AUTO_COACH_QUEUE}:${userId}`,
    singletonSeconds: AUTO_COACH_DEBOUNCE_SECONDS,
  };
}

/**
 * Enqueue an auto-coach pass, returning the send promise so callers that hold
 * companion state (createWorkoutAndScheduleCoaching pre-sets isAutoCoaching)
 * can roll it back when the enqueue fails.
 */
export function enqueueAutoCoach(userId: string, trigger: AutoCoachTrigger): Promise<unknown> {
  return queue.send(AUTO_COACH_QUEUE, { userId, trigger }, autoCoachJobOptions(userId));
}

/**
 * Fire-and-forget variant for callers with nothing to undo. A failed enqueue
 * costs the athlete a stale coach note, not a failed request, so it is logged
 * rather than surfaced — the caller's write has already committed.
 */
export function enqueueAutoCoachInBackground(userId: string, trigger: AutoCoachTrigger): void {
  enqueueAutoCoach(userId, trigger).catch((err) => {
    // bearer:disable javascript_lang_logger_leak
    logger.error({ err, trigger }, "Failed to queue auto-coach job");
  });
}
