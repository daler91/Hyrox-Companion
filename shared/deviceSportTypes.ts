/**
 * Whether a device activity's sport counts as TRAINING.
 *
 * Every activity a watch records becomes a `workout_logs` row — the interval
 * session, the commute, the dog walk, the yoga class. Counting all of them as
 * training is what made "Total Workouts", "Avg / Week", "Avg Duration" and the
 * streak describe something other than the athlete's training: a 20-minute walk
 * kept a streak alive and pulled the average session length down.
 *
 * The question this answers is narrow — "does this count as a session I did?" —
 * and deliberately NOT "did my body do work?". A walk's calories are real and
 * still reach the energy balance; its duration is real and still reaches the
 * training-load model. Only the bookkeeping surfaces filter on the answer.
 *
 * A DENY-LIST, not an allow-list. Sports we do not recognise count, because
 * silently dropping an athlete's activity because we had not heard of its name
 * is the worse failure — a new Strava sport type, or a Garmin key we have not
 * seen, should show up rather than vanish.
 *
 * Zero-import module so the mappers, the backfill and the client can all share
 * one answer.
 */

/**
 * Sports that are not Hyrox training, in both providers' spellings: Strava
 * sends PascalCase `sport_type` ("EBikeRide"), Garmin sends snake_case
 * `activityType.typeKey` ("e_bike_fitness"). Both normalise to lowercase
 * alphanumerics here so one list covers both.
 *
 * Hiking is deliberately ABSENT — three hours uphill is real aerobic work, and
 * an athlete who hikes as training should not have to re-tag every one. Walking
 * is present for the same reason in reverse: it is the activity that most often
 * arrives without being training at all.
 */
const NON_TRAINING_SPORTS: ReadonlySet<string> = new Set([
  "walk",
  "walking",
  "casualwalking",
  "speedwalking",
  "ebikeride",
  "ebikefitness",
  "ebikemountain",
  "yoga",
  "pilates",
  "meditation",
  "breathwork",
  "golf",
]);

/** Lowercase alphanumerics, so "E-Bike Ride", "EBikeRide" and "e_bike_ride" agree. */
function normalizeSportType(sportType: string): string {
  return sportType.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
}

/**
 * The `counts_as_training` value to stamp on a device import.
 *
 * An empty or unknown sport counts, per the deny-list rule above.
 */
export function countsAsTraining(sportType: string | null | undefined): boolean {
  if (!sportType) return true;
  return !NON_TRAINING_SPORTS.has(normalizeSportType(sportType));
}
