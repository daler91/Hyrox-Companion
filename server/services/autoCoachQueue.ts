import { logger } from "../logger";
import { DEFAULT_JOB_OPTIONS, queue } from "../queue";
import type { IStorage } from "../storage";

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
  | "plan-day-rescheduled"
  // A session that is not going to happen: swept to missed overnight, skipped
  // (or un-skipped) by the athlete, or a missed one they let go. The plan
  // adaptation holds the sessions after it at the step that was not done.
  | "plan-day-missed"
  | "plan-day-skipped"
  | "missed-session-let-go";

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

/**
 * The background variant for the passes a session that is not happening asks
 * for from a request: a skip (or one taken back) and a missed session let go.
 * For the other triggers a lost pass only leaves a note stale until the next
 * log. Here no log is on its way: the pass is what moves the sessions after
 * the miss, and nothing else brings the coach back. So a send the queue
 * refuses also puts the plan on the missed-session sweep's waiting list, and
 * the next hourly tick queues the pass (coachAthletesAfterMissedSweep), with
 * that list's checks on the athlete.
 */
export function enqueueMissedSessionCoachInBackground(
  storage: IStorage,
  userId: string,
  planId: string | null | undefined,
  trigger: AutoCoachTrigger,
): void {
  enqueueAutoCoach(userId, trigger).catch((err) => {
    if (planId) storage.plans.keepAwaitingCoachAfterMiss([planId]);
    // bearer:disable javascript_lang_logger_leak
    logger.error({ err, trigger }, "Failed to queue auto-coach job");
  });
}

/**
 * Queue a coach pass for every athlete the missed-session sweep left waiting
 * for one (storage.plans.takeAthletesToCoachAfterMiss), so the sessions after
 * a missed one are looked at overnight rather than whenever the athlete next
 * logs. Returns how many were queued.
 *
 * Each send is awaited: the storage has already taken those athletes off its
 * list, so one the queue refuses is handed back for the next tick to try
 * again. Dropped instead, their plan would carry on as if the missed session
 * had been done until they next logged a workout.
 *
 * Never throws: it rides on the hourly email tick, and that tick's emails do
 * not wait on the coach. A failed read keeps the athletes for the next tick.
 */
export async function coachAthletesAfterMissedSweep(storage: IStorage): Promise<number> {
  try {
    const athletes = await storage.plans.takeAthletesToCoachAfterMiss();
    const queued = await Promise.all(
      athletes.map(async ({ userId, planIds }) => {
        try {
          await enqueueAutoCoach(userId, "plan-day-missed");
          return true;
        } catch (err) {
          storage.plans.keepAwaitingCoachAfterMiss(planIds);
          // bearer:disable javascript_lang_logger_leak
          logger.error({ err, trigger: "plan-day-missed" }, "Failed to queue auto-coach job");
          return false;
        }
      }),
    );
    return queued.filter(Boolean).length;
  } catch (err) {
    // A failed read of plan and user ids; no row content is logged.
    // bearer:disable javascript_lang_logger_leak
    logger.warn({ err }, "Could not queue coach passes after the missed-session sweep");
    return 0;
  }
}
