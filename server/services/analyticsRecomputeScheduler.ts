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
import { inChunks, inSequence } from "@shared/inSequence";
import { ANALYTICS_FEATURES, type AnalyticsFeature, type AnalyticsResult } from "@shared/schema";

import {
  DEFAULT_JOB_OPTIONS,
  queue,
  RECOMPUTE_ANALYTICS_QUEUE,
  type RecomputeAnalyticsJobData,
} from "../queue";
import type { IStorage } from "../storage";
import { getLocalDateStr, isLocalHourDue } from "../timezone";
import { computeStale, type HistoryAnchor } from "./analyticsStaleness";

/**
 * For one user at their local midnight, enqueue a recompute job for each feature
 * with a stored result that is stale relative to that feature's anchor (latest
 * workout for training surfaces, latest food-log date for nutrition_insights).
 * `resultsByFeature` is this user's stored rows, preloaded in a single batched
 * query by the caller (see runAnalyticsRecomputeScan) instead of being fetched
 * one-by-one here. Returns the number of jobs enqueued.
 */
async function enqueueStaleRecomputes(
  storage: IStorage,
  userId: string,
  localDate: string,
  resultsByFeature: ReadonlyMap<AnalyticsFeature, AnalyticsResult>,
): Promise<number> {
  // Anchors are fetched lazily and memoized: the workout anchor is shared by
  // three features, and the nutrition queries are skipped entirely for users
  // without a stored nutrition row. `undefined` = not yet fetched. An athlete
  // with no activity of that kind anchors at { latestDate: null, entryCount: 0 },
  // which matches what was stored for them, so such features are never stale.
  //
  // Each anchor is a date AND a row count (audit L16): the date alone cannot
  // see a second session logged on a day that already had one, which is an
  // ordinary week rather than an edge case.
  let workoutAnchor: HistoryAnchor | undefined;
  let nutritionAnchor: HistoryAnchor | undefined;
  const anchorFor = async (feature: AnalyticsFeature): Promise<HistoryAnchor> => {
    if (feature === "nutrition_insights") {
      if (nutritionAnchor === undefined) {
        const [latestDate, entryCount] = await Promise.all([
          storage.nutrition.getLatestLogDate(userId),
          storage.nutrition.countLogEntries(userId),
        ]);
        nutritionAnchor = { latestDate, entryCount };
      }
      return nutritionAnchor;
    }
    if (workoutAnchor === undefined) {
      const [[latestWorkout], entryCount] = await Promise.all([
        storage.workouts.listWorkoutLogs(userId, 1),
        storage.workouts.countWorkoutLogs(userId),
      ]);
      workoutAnchor = { latestDate: latestWorkout?.date ?? null, entryCount };
    }
    return workoutAnchor;
  };

  // One feature at a time, so the features sharing an anchor wait for the
  // first fetch of it instead of each racing to fetch it again.
  const sent = await inSequence(ANALYTICS_FEATURES, async (feature) => {
    const row = resultsByFeature.get(feature);
    if (!row) return false; // only refresh features the user has actually used
    if (row.recomputedOn === localDate) return false; // already recomputed today (pre-check)
    if (!computeStale(row, await anchorFor(feature))) return false; // up to date → skip

    const data: RecomputeAnalyticsJobData = { userId, feature, localDate };
    await queue.send(RECOMPUTE_ANALYTICS_QUEUE, data, {
      ...DEFAULT_JOB_OPTIONS,
      // Coalesce duplicate enqueues for the same (feature, user) across the
      // adjacent hourly tick or a multi-instance scan; the worker's atomic
      // recomputedOn claim remains the authoritative once-per-day guard.
      singletonKey: `recompute:${feature}:${userId}`,
      singletonSeconds: 3600,
    });
    return true;
  });
  return sent.filter(Boolean).length;
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
  const usersMap = new Map<
    string,
    NonNullable<Awaited<ReturnType<typeof storage.users.getUser>>>
  >();
  const batchSize = 100;
  const userBatches = await inSequence(inChunks(userIds, batchSize), (batch) => storage.users.getUsers(batch));
  for (const u of userBatches.flat()) {
    usersMap.set(u.id, u);
  }

  // Narrow to users actually at local midnight before touching
  // analytics_results at all — most engaged users land in a different hourly
  // tick, so there's no reason to fetch their rows on this pass. Where the
  // clocks spring forward AT midnight (Santiago, Beirut, Havana) hour 0 does
  // not exist that day, so it falls due at 01:00 instead of being skipped
  // (C24, CODEBASE_ANALYSIS_2026-10-03).
  const eligibleUserIds = userIds.filter((userId) => {
    const user = usersMap.get(userId);
    return user != null && isLocalHourDue(now, user.userTimezone, 0);
  });
  usersChecked = eligibleUserIds.length;

  // ⚡ Perf: batch-fetch every eligible user's stored analytics_results rows
  // (all features) in `IN (...)` queries instead of the previous 4 sequential
  // per-feature `get()` calls per user. Hundreds of users can share the same
  // local-midnight hour, so this collapses up to ~4x that many round trips
  // into ceil(eligibleUserIds.length / 100) batched queries.
  const resultsByUser = new Map<string, Map<AnalyticsFeature, AnalyticsResult>>();
  const resultBatches = await inSequence(inChunks(eligibleUserIds, batchSize), (batch) =>
    storage.analyticsResults.getMany(batch),
  );
  for (const row of resultBatches.flat()) {
    let byFeature = resultsByUser.get(row.userId);
    if (!byFeature) {
      byFeature = new Map();
      resultsByUser.set(row.userId, byFeature);
    }
    byFeature.set(row.feature as AnalyticsFeature, row);
  }

  const emptyResults: ReadonlyMap<AnalyticsFeature, AnalyticsResult> = new Map();
  // One user at a time: the users sharing this midnight can number in the
  // hundreds, and each one costs anchor reads plus a queue write per feature.
  const enqueuedPerUser = await inSequence(eligibleUserIds, async (userId) => {
    const user = usersMap.get(userId);
    if (!user) return 0;

    // No early return for workout-less users: nutrition_insights anchors on
    // food-log dates, so a user who only logs meals must still recompute.
    // Workout-anchored features naturally skip via computeStale(row, null).
    const localDate = getLocalDateStr(now, user.userTimezone);
    return await enqueueStaleRecomputes(
      storage,
      userId,
      localDate,
      resultsByUser.get(userId) ?? emptyResults,
    );
  });
  enqueued = enqueuedPerUser.reduce((sum, count) => sum + count, 0);

  return { usersChecked, enqueued };
}
