import type { User } from "@shared/schema";
import { computeSessionFuellingTarget } from "@shared/sessionFuellingTargets";

import { logger } from "../../logger";
import { isPushEnabled, type PushPayload, sendPushToUser } from "../../pushNotifications";
import type { IStorage } from "../../storage";
import { getLocalDateStr, getLocalHour } from "../../timezone";
import type { LogEntryWithFood } from "./rollup";
import { computeSessionFuelling, POST_WINDOW_MS, PRE_WINDOW_MS } from "./sessionFuelling";

// ---------------------------------------------------------------------------
// Nutrition push reminders (opt-in, push-only). Two nudges, both riding the
// existing claim-before-send ledger pattern from emailScheduler:
//
//  - Refuel: after a session with a device start instant, while a meaningful
//    post-session carb/protein gap remains, inside the effective glycogen
//    window. Deep-links to /nutrition with post_workout pre-selected.
//  - Evening log: at 20:00 local, for athletes who use nutrition logging but
//    have logged nothing today.
// ---------------------------------------------------------------------------

// Not the moment the session ends — give the athlete time to eat and log
// first; and not hours later when the window has effectively closed.
const REFUEL_MIN_AFTER_END_MS = 45 * 60 * 1000;
const REFUEL_MAX_AFTER_END_MS = 3 * 60 * 60 * 1000;
/** Sessions without a logged duration are assumed an hour long. */
const DEFAULT_SESSION_DURATION_MIN = 60;
/** How far back the workout scan looks; generously covers the refuel window. */
const REFUEL_WORKOUT_LOOKBACK_MS = 12 * 60 * 60 * 1000;
// Nudge only while a meaningful amount is still owed.
const REFUEL_MIN_CARB_GAP_G = 20;
const REFUEL_MIN_PROTEIN_GAP_G = 15;
// One nudge per session: long enough to stop the hourly cron repeating itself,
// short enough that a genuine second session later the same day gets its own.
const REFUEL_CLAIM_WINDOW_MS = 6 * 60 * 60 * 1000;

const LOGGING_REMINDER_LOCAL_HOUR = 20;
// Shorter than the daily cadence so tomorrow's 20:00 slot is always claimable
// (same reasoning as the email scheduler's claim windows).
const LOGGING_CLAIM_WINDOW_MS = 20 * 60 * 60 * 1000;
/** Only remind athletes with a log inside this window — never nag lapsed or
 *  never-started users into a feature they don't use. */
const LOGGING_ACTIVE_WINDOW_DAYS = 14;

export function buildRefuelPush(
  gap: { postCarbG: number; postProteinG: number },
  date: string,
): PushPayload {
  const parts: string[] = [];
  if (gap.postCarbG > 0) parts.push(`${Math.round(gap.postCarbG)}g carbs`);
  if (gap.postProteinG > 0) parts.push(`${Math.round(gap.postProteinG)}g protein`);
  return {
    title: "Refuel window open",
    body: `About ${parts.join(" + ")} to go for today's recovery — log it in one tap.`,
    url: `/nutrition?date=${date}&meal=post_workout`,
  };
}

/**
 * Post-workout refuel nudge. Fires at most once per claim window, only when:
 * the user opted in, their latest device-timed session ended between 45min and
 * 3h ago, and the session's post-recovery target still has ≥20g carbs or ≥15g
 * protein outstanding. Claims before sending — a failed push forgoes the nudge
 * rather than risking a duplicate (same trade as the email reminders).
 */
export async function processRefuelReminder(
  storage: IStorage,
  user: User,
  now: Date,
): Promise<boolean> {
  if (user.pushRefuelReminder !== true) return false;

  const workout = await storage.workouts.getLatestStartedWorkout(
    user.id,
    new Date(now.getTime() - REFUEL_WORKOUT_LOOKBACK_MS),
  );
  if (!workout?.startedAt) return false;

  const startMs = new Date(workout.startedAt).getTime();
  const durationMin = workout.duration ?? DEFAULT_SESSION_DURATION_MIN;
  const endMs = startMs + durationMin * 60 * 1000;
  const sinceEnd = now.getTime() - endMs;
  if (sinceEnd < REFUEL_MIN_AFTER_END_MS || sinceEnd > REFUEL_MAX_AFTER_END_MS) return false;

  // Same window + day fetch as the session-fuelling route, so tagged
  // back-logged entries count toward the gap (no false nags).
  const [windowEntries, dayEntries] = await Promise.all([
    storage.nutrition.listEntriesWithFoodInWindow(
      user.id,
      new Date(startMs - PRE_WINDOW_MS),
      new Date(startMs + POST_WINDOW_MS),
    ),
    storage.nutrition.listEntriesWithFoodForDate(user.id, workout.date),
  ]);
  const byId = new Map<string, LogEntryWithFood>(windowEntries.map((e) => [e.id, e]));
  for (const e of dayEntries) if (!byId.has(e.id)) byId.set(e.id, e);

  const fuelling = computeSessionFuelling(workout, [...byId.values()]);
  const target = computeSessionFuellingTarget({
    durationMin: workout.duration ?? null,
    rpe: workout.rpe ?? null,
    bodyweightKg: user.bodyweightKg ?? null,
  });
  const postCarbGap = target.postCarbG - fuelling.postTotals.carb;
  const postProteinGap = target.postProteinG - fuelling.postTotals.protein;
  if (postCarbGap < REFUEL_MIN_CARB_GAP_G && postProteinGap < REFUEL_MIN_PROTEIN_GAP_G) {
    return false;
  }

  const claimed = await storage.users.claimRefuelReminder(
    user.id,
    new Date(now.getTime() - REFUEL_CLAIM_WINDOW_MS),
    now,
  );
  if (!claimed) return false;

  const delivered = await sendPushToUser(
    user.id,
    buildRefuelPush({ postCarbG: postCarbGap, postProteinG: postProteinGap }, workout.date),
  );
  return delivered > 0;
}

/**
 * Evening "nothing logged today" nudge at 20:00 in the athlete's timezone.
 * Only for users with a log in the last 14 days (they demonstrably use the
 * feature) and nothing on today's date. Claim-before-send, one per local day.
 */
export async function processLoggingReminder(
  storage: IStorage,
  user: User,
  now: Date,
): Promise<boolean> {
  if (user.pushLoggingReminder !== true) return false;

  const tz = user.userTimezone;
  if (getLocalHour(now, tz) !== LOGGING_REMINDER_LOCAL_HOUR) return false;

  const todayStr = getLocalDateStr(now, tz);
  if (await storage.nutrition.hasEntriesOnDate(user.id, todayStr)) return false;

  const activeSince = new Date(now.getTime() - LOGGING_ACTIVE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  if (!(await storage.nutrition.hasEntriesSince(user.id, activeSince))) return false;

  const claimed = await storage.users.claimLoggingReminder(
    user.id,
    new Date(now.getTime() - LOGGING_CLAIM_WINDOW_MS),
    now,
  );
  if (!claimed) return false;

  const delivered = await sendPushToUser(user.id, {
    title: "Log today's fuelling",
    body: "Nothing logged yet today — describing a meal takes about 20 seconds.",
    url: "/nutrition",
  });
  return delivered > 0;
}

/**
 * Hourly cron entry point. Scans only users who opted into at least one
 * nutrition reminder; each user is processed independently so one failure
 * never starves the rest. Push-disabled deployments no-op outright.
 */
export async function runNutritionReminderCron(
  storage: IStorage,
): Promise<{ usersChecked: number; remindersSent: number }> {
  if (!isPushEnabled()) return { usersChecked: 0, remindersSent: 0 };

  const usersToCheck = await storage.users.getUsersWithNutritionPushReminders();
  let remindersSent = 0;
  const now = new Date();

  for (const stale of usersToCheck) {
    try {
      // Re-fetch so an opt-out between scan and processing is respected (the
      // same W4 race the email scheduler guards against).
      const user = await storage.users.getUser(stale.id);
      if (!user) continue;
      if (await processRefuelReminder(storage, user, now)) remindersSent++;
      if (await processLoggingReminder(storage, user, now)) remindersSent++;
    } catch (err) {
      // bearer:disable javascript_lang_logger_leak — logs an internal user id
      // and a push/DB error for operability; no message content or PII.
      logger.error(
        { context: "cron", err, userId: stale.id },
        "Nutrition reminder processing failed for user",
      );
    }
  }

  return { usersChecked: usersToCheck.length, remindersSent };
}
