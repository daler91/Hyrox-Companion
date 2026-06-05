/**
 * Midnight analytics recompute scheduler.
 *
 * Fires once per day at each engaged user's LOCAL midnight: the cron ticks
 * hourly in UTC and this gates per-user on local hour 0, the same "fixed UTC
 * tick, gate per local time" approach the email scheduler uses for weekly
 * summaries (server/emailScheduler.ts). For every feature the user has a stored
 * result for, it enqueues a recompute job ONLY when a workout has been logged
 * after that result was generated — so we never spend AI refreshing a result
 * that already reflects the latest training. Scope is limited to users who have
 * a stored result (i.e. who have actually used the feature).
 */
import { ANALYTICS_FEATURES } from "@shared/schema";

import { DEFAULT_JOB_OPTIONS, queue, RECOMPUTE_ANALYTICS_QUEUE, type RecomputeAnalyticsJobData } from "../queue";
import type { IStorage } from "../storage";
import { getLocalDateStr, getLocalHour } from "../timezone";
import { computeStale } from "./analyticsStaleness";

export async function runAnalyticsRecomputeScan(
  storage: IStorage,
  now: Date,
): Promise<{ usersChecked: number; enqueued: number }> {
  const userIds = await storage.analyticsResults.listEngagedUserIds([...ANALYTICS_FEATURES]);
  let usersChecked = 0;
  let enqueued = 0;

  for (const userId of userIds) {
    const user = await storage.users.getUser(userId);
    if (!user) continue;
    // Only act in the user's local midnight hour (00:00–00:59 local). The
    // hourly UTC cron lands exactly one tick in this window per day per tz.
    if (getLocalHour(now, user.userTimezone) !== 0) continue;
    usersChecked += 1;

    const [latestWorkout] = await storage.workouts.listWorkoutLogs(userId, 1);
    const latestWorkoutDate = latestWorkout?.date ?? null;
    // No workouts logged → nothing newer to refresh against.
    if (latestWorkoutDate == null) continue;

    const localDate = getLocalDateStr(now, user.userTimezone);

    for (const feature of ANALYTICS_FEATURES) {
      const row = await storage.analyticsResults.get(userId, feature);
      if (!row) continue; // only refresh features the user has actually used
      if (row.recomputedOn === localDate) continue; // already recomputed today (pre-check)
      if (!computeStale(row, latestWorkoutDate)) continue; // up to date → skip

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
  }

  return { usersChecked, enqueued };
}
