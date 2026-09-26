// The RPE a logged session's average heart rate corresponds to.
//
// The pure half of services/rpeSuggestion.ts, split out so the load models can
// read it without importing the storage layer (which needs a database to even
// load). Two readers, one answer:
//
//   - rpeSuggestion.ts OFFERS it on the review sheet, and nothing is saved
//     until the athlete taps a value. A heart-rate reading written into `rpe`
//     would feed the coach's fatigue flags a number the athlete never gave.
//   - bodySystemLoad.ts uses it as the effort for an UNRATED session's load
//     estimate, and counts that session as estimated. It is never stored.
//
// The value is the RPE the load model already scores the same as this heart
// rate (`rpeEquivalentOfHrReserve`), so it describes the session the way its
// training load already does.

import { heartRateReflectsEffort } from "@shared/deviceSportTypes";
import type { WorkoutLog } from "@shared/schema";

import { hrReserveRatio, rpeEquivalentOfHrReserve } from "./hrModel";
import type { AthleteLoadContext } from "./types";

export type HeartRateRpeLog = Pick<
  WorkoutLog,
  "avgHeartrate" | "focus" | "source" | "deviceActivity"
>;

/**
 * The sport the recording says this was. A linked log's own focus is the
 * plan's or the athlete's title ("Lower body strength"), so the recording's
 * snapshot is read first. A standalone import's focus IS the sport type,
 * because both mappers write it there.
 */
function recordedSportType(log: HeartRateRpeLog): string | null {
  const raw = log.deviceActivity?.raw;
  if (raw) return raw.sport_type || raw.type || null;
  return log.source === "strava" || log.source === "garmin" ? log.focus : null;
}

/** Whether this log could get a suggestion from anyone's heart-rate profile. */
export function hasUsableHeartRate(log: HeartRateRpeLog): boolean {
  return (log.avgHeartrate ?? 0) > 0 && heartRateReflectsEffort(recordedSportType(log));
}

/**
 * The heart-rate RPE, or null when there is nothing honest to suggest: no
 * average heart rate, a sport whose heart rate does not reflect effort, or no
 * measured max HR or age to read it against (`hrReserveRatio` withholds then).
 * Computed whether or not the athlete has rated the session; the client shows
 * it only while `rpe` is empty, so clearing a rating brings it back.
 */
export function suggestRpeFromHeartRate(
  log: HeartRateRpeLog,
  athlete: AthleteLoadContext | undefined,
): number | null {
  if (!hasUsableHeartRate(log)) return null;
  const hrr = hrReserveRatio(log.avgHeartrate, athlete);
  return hrr == null ? null : rpeEquivalentOfHrReserve(hrr);
}
