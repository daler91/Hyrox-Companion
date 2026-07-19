/**
 * Midnight analytics recompute scheduler.
 *
 * Fires once per day at each engaged user's LOCAL midnight: the cron ticks
 * hourly in UTC and this gates per-user on local hour 0, the same "fixed UTC
 * tick, gate per local time" approach the email scheduler uses for weekly
 * summaries (server/emailScheduler.ts). For every feature the user has a stored
 * result for, it enqueues a recompute job ONLY when new activity was logged
 * after that result was generated — so we never spend AI refreshing a result
 * that already reflects the latest data. Staleness is compared against that
 * feature's own anchor: the latest workout date for the training surfaces,
 * the latest FOOD-LOG date for nutrition_insights (matching what
 * persistNutritionInsights stamps into lastWorkoutDateAtGeneration and what
 * GET /api/v1/nutrition/insights uses for its own stale flag). Scope is
 * limited to users who have a stored result (i.e. who actually use the
 * feature).
 */
import { ANALYTICS_FEATURES, type AnalyticsFeature } from "@shared/schema";

import { DEFAULT_JOB_OPTIONS, queue, RECOMPUTE_ANALYTICS_QUEUE, type RecomputeAnalyticsJobData } from "../queue";
import type { IStorage } from "../storage";
import { getLocalDateStr, getLocalHour } from "../timezone";
import { computeStale } from "./analyticsStaleness";

/**
 * For one user at their local midnight, enqueue a recompute job for each feature
 * with a stored result that is stale relative to that feature's anchor (latest
 * workout for training surfaces, latest food-log date for nutrition_insights).
 * Returns the number of jobs enqueued.
 */
async function enqueueStaleRecomputes(
  storage: IStorage,
  userId: string,
  localDate: string,
): Promise<number> {
  // Anchors are fetched lazily and memoized: the workout anchor is shared by
  // three features, and the nutrition query is skipped entirely for users
  // without a stored nutrition row. `undefined` = not yet fetched; `null` =
  // fetched, user has no activity of that kind (computeStale(row, null) is
  // false, so such features are simply never stale).
  let workoutAnchor: string | null | undefined;
  let nutritionAnchor: string | null | undefined;
  const anchorFor = async (feature: AnalyticsFeature): Promise<string | null> => {
    if (feature === "nutrition_insights") {
      if (nutritionAnchor === undefined) {
        nutritionAnchor = await storage.nutrition.getLatestLogDate(userId);
      }
      return nutritionAnchor;
    }
    if (workoutAnchor === undefined) {
      const [latestWorkout] = await storage.workouts.listWorkoutLogs(userId, 1);
      workoutAnchor = latestWorkout?.date ?? null;
    }
    return workoutAnchor;
  };

  let enqueued = 0;
  for (const feature of ANALYTICS_FEATURES) {
    const row = await storage.analyticsResults.get(userId, feature);
    if (!row) continue; // only refresh features the user has actually used
    if (row.recomputedOn === localDate) continue; // already recomputed today (pre-check)
    if (!computeStale(row, await anchorFor(feature))) continue; // up to date → skip

    const data: RecomputeAnalyticsJobData = { userId, feature, localDate };
    await queue.send(RECOMPUTE_ANALYTICS_QUEUE, data, {
      ...DEFAULT_JOB_OPTIONS,
      // Coalesce duplicate enqueues for the same (feature, user) across the
      // adjacent hourly tick or a multi-instance scan; the worker's atomic
      // recomputedOn claim remains the authoritative once-per-day guard.
      singletonKey: `recompute:${feature}:${userId}`,
      singletonSeconds: 3600,
    });
    enqueued += 1;
  }
  return enqueued;
}

export async function runAnalyticsRecomputeScan(
  storage: IStorage,
  now: Date,
): Promise<{ usersChecked: number; enqueued: number }> {
  const userIds = await storage.analyticsResults.listEngagedUserIds([...ANALYTICS_FEATURES]);
  let usersChecked = 0;
  let enqueued = 0;

  if (userIds.length === 0) return { usersChecked, enqueued };

  // Fetch all users in batches to avoid N+1 query issue
  const usersMap = new Map<string, NonNullable<Awaited<ReturnType<typeof storage.users.getUser>>>>();
  const batchSize = 100;
  for (let i = 0; i < userIds.length; i += batchSize) {
    const batch = userIds.slice(i, i + batchSize);
    const usersBatch = await storage.users.getUsers(batch);
    for (const u of usersBatch) {
      usersMap.set(u.id, u);
    }
  }

  for (const userId of userIds) {
    const user = usersMap.get(userId);
    if (!user) continue;
    // Only act in the user's local midnight hour (00:00–00:59 local). The
    // hourly UTC cron lands exactly one tick in this window per day per tz.
    if (getLocalHour(now, user.userTimezone) !== 0) continue;
    usersChecked += 1;

    // No early return for workout-less users: nutrition_insights anchors on
    // food-log dates, so a user who only logs meals must still recompute.
    // Workout-anchored features naturally skip via computeStale(row, null).
    const localDate = getLocalDateStr(now, user.userTimezone);
    enqueued += await enqueueStaleRecomputes(storage, userId, localDate);
  }

  return { usersChecked, enqueued };
}
