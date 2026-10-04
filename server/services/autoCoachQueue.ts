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
 * The 60s debounce window is what makes it safe to call this from a
 * per-keystroke write path: a burst of set edits, a drag of three workouts, or
 * a bulk CSV import all collapse into one coach pass per athlete.
 *
 * It has to be pg-boss's DEBOUNCE (sendDebounced, i.e. singletonNextSlot), not
 * a bare singletonKey + singletonSeconds, which pg-boss treats as a THROTTLE: a
 * window's job holds its slot while queued, running AND completed, so a trigger
 * landing after that job had started — a typo'd set corrected 30 s after the
 * first save — was dropped, and no pass ever saw the correction. The debounce
 * queues exactly one more pass in the next window instead, like the Strava
 * sync queue. AI12 (CODEBASE_ANALYSIS_2026-10-03)
 *
 * Jobs from two windows can still run at once on two instances; the coach's
 * write serializes them per athlete (autoCoachWriteGuard).
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

/**
 * Enqueue an auto-coach pass, returning the send promise so callers that hold
 * companion state (createWorkoutAndScheduleCoaching pre-sets isAutoCoaching)
 * can roll it back when the enqueue fails. Resolves to the job id, or null
 * when this window and the next already hold a pass for the athlete. Async so
 * even a synchronous throw reaches the callers' .catch as a rejection.
 */
export async function enqueueAutoCoach(
  userId: string,
  trigger: AutoCoachTrigger,
): Promise<string | null> {
  return await queue.sendDebounced(
    AUTO_COACH_QUEUE,
    { userId, trigger },
    DEFAULT_JOB_OPTIONS,
    AUTO_COACH_DEBOUNCE_SECONDS,
    `${AUTO_COACH_QUEUE}:${userId}`,
  );
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
