/**
 * A heart-rate SUGGESTION for a logged workout's RPE, never the rating itself.
 *
 * RPE is the one subjective signal the app has. The coach's fatigue and
 * undertraining flags are built on it (`computeRpeTrend`), and those flags
 * decide what the coach may change in a plan. A heart-rate reading written
 * into `rpe` would feed them a number the athlete never gave, and it would
 * under-read lifting badly (see `heartRateReflectsEffort`). So a recording's
 * heart rate is only ever OFFERED: the review sheet marks this value in the
 * RPE picker, and nothing is saved until the athlete taps a value. A rating
 * the athlete gave on Strava is imported as it is instead
 * (`perceivedExertionToRpe`).
 *
 * The value is the RPE the load model already scores the same as this heart
 * rate (`rpeEquivalentOfHrReserve`), so accepting it describes the session
 * the way its training load already does.
 */
import { heartRateReflectsEffort } from "@shared/deviceSportTypes";
import type { User, WorkoutLog } from "@shared/schema";

import { storage } from "../storage";
import { hrReserveRatio, rpeEquivalentOfHrReserve } from "./trainingLoad/hrModel";
import type { AthleteLoadContext } from "./trainingLoad/types";

type SuggestionLog = Pick<WorkoutLog, "avgHeartrate" | "focus" | "source" | "deviceActivity">;

/**
 * The sport the recording says this was. A linked log's own focus is the
 * plan's or the athlete's title ("Lower body strength"), so the recording's
 * snapshot is read first. A standalone import's focus IS the sport type,
 * because both mappers write it there.
 */
function recordedSportType(log: SuggestionLog): string | null {
  const raw = log.deviceActivity?.raw;
  if (raw) return raw.sport_type || raw.type || null;
  return log.source === "strava" || log.source === "garmin" ? log.focus : null;
}

/** Whether this log could get a suggestion from anyone's heart-rate profile. */
function hasUsableHeartRate(log: SuggestionLog): boolean {
  return (log.avgHeartrate ?? 0) > 0 && heartRateReflectsEffort(recordedSportType(log));
}

/**
 * The suggested RPE, or null when there is nothing honest to suggest: no
 * average heart rate, a sport whose heart rate does not reflect effort, or no
 * measured max HR or age to read it against (`hrReserveRatio` withholds then).
 * Computed whether or not the athlete has rated the session; the client shows
 * it only while `rpe` is empty, so clearing a rating brings it back.
 */
export function suggestRpeFromHeartRate(
  log: SuggestionLog,
  athlete: AthleteLoadContext | undefined,
): number | null {
  if (!hasUsableHeartRate(log)) return null;
  const hrr = hrReserveRatio(log.avgHeartrate, athlete);
  return hrr == null ? null : rpeEquivalentOfHrReserve(hrr);
}

/** The heart-rate fields of the athlete's profile, as the HR model reads them. */
function athleteHeartRateContext(user: User | undefined): AthleteLoadContext {
  return {
    age: user?.age ?? null,
    restingHr: user?.restingHr ?? null,
    maxHr: user?.maxHr ?? null,
  };
}

/**
 * `suggestRpeFromHeartRate` for a stored log. The athlete's profile is read
 * only when the log could get a suggestion at all: most manual logs carry no
 * heart rate, and opening one should not cost a profile lookup.
 */
export async function loadSuggestedRpe(log: SuggestionLog, userId: string): Promise<number | null> {
  if (!hasUsableHeartRate(log)) return null;
  const user = await storage.users.getUser(userId);
  return suggestRpeFromHeartRate(log, athleteHeartRateContext(user));
}
