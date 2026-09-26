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
 * the way its training load already does. The computation itself is pure and
 * lives in trainingLoad/heartRateRpe.ts, which the body-system load model also
 * reads; this module adds the profile lookup.
 */
import type { User } from "@shared/schema";

import { storage } from "../storage";
import {
  hasUsableHeartRate,
  type HeartRateRpeLog,
  suggestRpeFromHeartRate,
} from "./trainingLoad/heartRateRpe";
import type { AthleteLoadContext } from "./trainingLoad/types";

export { suggestRpeFromHeartRate } from "./trainingLoad/heartRateRpe";

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
export async function loadSuggestedRpe(log: HeartRateRpeLog, userId: string): Promise<number | null> {
  if (!hasUsableHeartRate(log)) return null;
  const user = await storage.users.getUser(userId);
  return suggestRpeFromHeartRate(log, athleteHeartRateContext(user));
}
