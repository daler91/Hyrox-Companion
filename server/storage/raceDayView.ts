import { addDaysToISODate } from "@shared/dateUtils";
import { RACE_DAY_FOCUS } from "@shared/raceDay";

// Deterministic copy for the days shaped around the athlete's race date. These are
// DERIVED at read time (timeline + coach context) from a day's scheduledDate vs the
// plan's raceDate — plan_days are never mutated, so reschedules stay correct and the
// day's original workout is preserved. "Shakeout"/"Recovery" read as light sessions,
// which the coaching prompt already treats as not-to-be-inflated.
const RACE_DAY_MAIN_WORKOUT =
  "HYROX race day. Trust your training — execute your pacing and transitions.";
const RACE_DAY_NOTES = "Race day. Arrive early, warm up, hydrate, and race your plan.";
const SHAKEOUT_FOCUS = "Shakeout";
const SHAKEOUT_MAIN_WORKOUT =
  "Pre-race shakeout: 10-15 min easy jog, light mobility, and 3-4 short strides. Keep it very light.";
const POST_RACE_FOCUS = "Recovery";
const POST_RACE_MAIN_WORKOUT =
  "Active recovery: easy walk or light mobility. Let your body recover from race day.";

export interface RaceDayOverride {
  readonly focus: string;
  readonly mainWorkout: string;
  readonly accessory: null;
  readonly notes: string | null;
}

/**
 * How a planned day should DISPLAY given its scheduledDate and the plan's raceDate,
 * or null for a normal day:
 *   - on the race date → the HYROX race (callers also suppress its exercises)
 *   - the day before    → a light shakeout
 *   - any day after      → easy recovery
 *
 * Read-time only — the underlying plan_day is never modified, so this is correct
 * after a reschedule (which changes scheduledDate but not raceDate) and never loses
 * the day's original workout. Dates are `YYYY-MM-DD` (lexical compare = chronological).
 */
export function deriveRaceDayOverride(
  scheduledDate: string,
  raceDate: string | null | undefined,
): RaceDayOverride | null {
  if (!raceDate) return null;
  if (scheduledDate === raceDate) {
    return {
      focus: RACE_DAY_FOCUS,
      mainWorkout: RACE_DAY_MAIN_WORKOUT,
      accessory: null,
      notes: RACE_DAY_NOTES,
    };
  }
  if (scheduledDate === addDaysToISODate(raceDate, -1)) {
    return {
      focus: SHAKEOUT_FOCUS,
      mainWorkout: SHAKEOUT_MAIN_WORKOUT,
      accessory: null,
      notes: null,
    };
  }
  if (scheduledDate > raceDate) {
    return {
      focus: POST_RACE_FOCUS,
      mainWorkout: POST_RACE_MAIN_WORKOUT,
      accessory: null,
      notes: null,
    };
  }
  return null;
}
