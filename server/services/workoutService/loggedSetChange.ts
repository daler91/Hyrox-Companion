import { exerciseSets, users, workoutLogs } from "@shared/schema";
import { and, asc, eq } from "drizzle-orm";

import { db } from "../../db";
import { logger } from "../../logger";
import { enqueueAutoCoachInBackground } from "../autoCoachQueue";
import { persistAdherenceSnapshot } from "./adherence";

/**
 * Re-derive everything computed FROM a workout's logged sets, after those sets
 * change on a log that already exists.
 *
 * Completing a day ran this derivation once and never again: the adherence
 * snapshot was written by createWorkoutInTx / assignWorkoutPlanDay, and the
 * coach was enqueued by the transition into "completed". Editing the sets
 * afterwards invalidated the analytics caches and stopped there, so an athlete
 * who corrected a session to the exercises they actually did was left with a
 * coach note written against the exercises they didn't and a compliance
 * percentage measured against sets that no longer existed.
 *
 * The only way to re-run either was "Reopen workout" — which, on a day a device
 * recording had completed, splits that recording back out into its own entry
 * (releaseStravaActivityInTx). So the missing derivation here is what pushed
 * athletes into destructively un-completing a Strava-linked day just to correct
 * an exercise name.
 *
 * Never throws. The set write that triggers this has already committed and been
 * reported to the athlete as saved; failing their request afterwards would be a
 * lie about data that is on disk. A failure here costs a stale note, which is
 * exactly the state this function exists to improve on.
 *
 * On AI spend: this runs per set write, which sounds like it would multiply
 * coach runs across a logging session — it does not. Logging a planned day
 * edits PLAN-DAY sets (LogSheet → usePlanDayExercises) and an ad-hoc session is
 * created whole on save, so neither reaches here. The only surface that edits a
 * workout log's sets one cell at a time is ReviewSurface, i.e. correcting an
 * already-completed session, and the auto-coach singleton window caps even a
 * long correction at roughly one pass per minute.
 */
export async function refreshDerivedStateAfterLoggedSetChange(
  workoutLogId: string,
  userId: string,
): Promise<void> {
  try {
    const owned = await recomputeAdherenceIfPlanLinked(workoutLogId, userId);
    if (!owned) return;

    const [user] = await db
      .select({ aiCoachEnabled: users.aiCoachEnabled })
      .from(users)
      .where(eq(users.id, userId));
    if (user?.aiCoachEnabled === true) {
      enqueueAutoCoachInBackground(userId, "logged-sets-edited");
    }
  } catch (err) {
    // bearer:disable javascript_lang_logger_leak
    logger.error(
      { err, context: "workout" },
      "Failed to refresh derived state after logged-set edit",
    );
  }
}

/**
 * Rewrites the log's adherence columns against the plan day's prescription.
 *
 * Returns whether the log is the athlete's — the caller uses that to decide
 * whether to spend an AI call, so a 404 from a wrong-owner request can't queue
 * a coach run for somebody else's edit.
 *
 * Takes SELECT FOR UPDATE on the log row so two edits landing together
 * serialize: without it both could read the same pre-edit set list and the
 * later write could persist the earlier snapshot, leaving a percentage that
 * matches neither edit.
 */
async function recomputeAdherenceIfPlanLinked(
  workoutLogId: string,
  userId: string,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [log] = await tx
      .select({ planDayId: workoutLogs.planDayId })
      .from(workoutLogs)
      .where(and(eq(workoutLogs.id, workoutLogId), eq(workoutLogs.userId, userId)))
      .for("update");
    if (!log) return false;

    // A standalone log (a Strava import nobody linked, an ad-hoc session) has
    // no prescription to diff against, so there is no snapshot to keep true.
    if (!log.planDayId) return true;

    const actualSets = await tx
      .select()
      .from(exerciseSets)
      .where(eq(exerciseSets.workoutLogId, workoutLogId))
      .orderBy(asc(exerciseSets.sortOrder));

    await persistAdherenceSnapshot(tx, workoutLogId, log.planDayId, actualSets);
    return true;
  });
}
