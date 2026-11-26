/**
 * The athlete and plan the adaptation's tests share: a front squat that
 * climbs week on week, and the log that says how the last session went.
 */
import type { PlanEngineState } from "@shared/schema";

import {
  type AdaptablePlanDay,
  type AdaptationInput,
  type AdaptationLog,
  type AdaptationSet,
  type adaptPlan,
  type MissedPlanSession,
} from "./adaptation";

export const TODAY = "2026-10-14";
export const NOW = "2026-10-14T18:00:00.000Z";

export function squatDay(
  id: string,
  date: string,
  weekNumber: number,
  weight: number,
  reps = 6,
): AdaptablePlanDay {
  return {
    id,
    date,
    weekNumber,
    mainWorkout: `Warm-up: 8 min bike\nA) Front Squat 4x${reps} @ ${weight} kg (RPE 8, rest 2-3 min)`,
    accessory: null,
    notes: null,
    aiInputsUsed: null,
    sets: [1, 2, 3, 4].map((n) => ({
      id: `${id}-${n}`,
      exerciseName: "front_squat",
      reps,
      weight,
      weightUnit: "kg",
    })),
  };
}

export const UPCOMING = [
  squatDay("a", "2026-10-16", 5, 85),
  squatDay("b", "2026-10-23", 6, 87.5),
  // Beyond the three-week horizon: a later log will reach it.
  squatDay("c", "2026-11-20", 10, 95),
];

export function log(id: string, date: string, overrides: Partial<AdaptationLog> = {}): AdaptationLog {
  return { id, date, focus: "Strength", rpe: 7, countsAsTraining: true, ...overrides };
}

export function squatSets(
  logId: string,
  date: string,
  reps: number[],
  weight: number,
  planned: { reps: number; weight: number } | null = { reps: 6, weight: 82.5 },
): AdaptationSet[] {
  return reps.map((rep, index) => ({
    workoutLogId: logId,
    date,
    exerciseName: "front_squat",
    category: "strength",
    setNumber: index + 1,
    reps: rep,
    weight,
    weightUnit: "kg",
    plannedReps: planned?.reps ?? null,
    plannedWeight: planned?.weight ?? null,
  }));
}

export function input(overrides: Partial<AdaptationInput> = {}): AdaptationInput {
  return {
    today: TODAY,
    now: NOW,
    weightUnit: "kg",
    distanceUnit: "km",
    plan: { startDate: "2026-09-14", totalWeeks: 12, engineState: null },
    logs: [log("l1", "2026-10-13")],
    sets: squatSets("l1", "2026-10-13", [6, 6, 6, 6], 82.5),
    upcoming: UPCOMING,
    fatigued: false,
    ...overrides,
  };
}

export function weights(
  result: ReturnType<typeof adaptPlan>,
  dayId: string,
): (number | undefined)[] | undefined {
  const day = result.days.find((entry) => entry.planDayId === dayId);
  return day?.setUpdates.map((update) => update.weight);
}

// Tuesday's squat (13 October) was missed; the next three Tuesdays climb past it.
export const NEXT_SQUATS = [
  squatDay("n1", "2026-10-20", 6, 87.5),
  squatDay("n2", "2026-10-27", 7, 90),
  squatDay("n3", "2026-11-03", 8, 92.5),
];

export function missedSquatDay(
  overrides: Partial<MissedPlanSession> & { weight?: number } = {},
): MissedPlanSession {
  const { weight = 85, ...rest } = overrides;
  const date = rest.date ?? "2026-10-13";
  return {
    planDayId: "m",
    date,
    weekNumber: 5,
    kind: "missed",
    sets: squatDay("m", date, 5, weight).sets,
    ...rest,
  };
}

/** A pass with no new logs: only the missed sessions speak. */
export function missInput(overrides: Partial<AdaptationInput> = {}): AdaptationInput {
  return input({
    logs: [],
    sets: [],
    upcoming: NEXT_SQUATS,
    missed: [missedSquatDay()],
    ...overrides,
  });
}

/** The upcoming days as a pass left them. */
export function afterPass(
  result: ReturnType<typeof adaptPlan>,
  days: readonly AdaptablePlanDay[] = NEXT_SQUATS,
): AdaptablePlanDay[] {
  return days.map((day) => {
    const adapted = result.days.find((entry) => entry.planDayId === day.id);
    if (!adapted) return day;
    const byId = new Map(adapted.setUpdates.map((update) => [update.setId, update.weight]));
    return {
      ...day,
      mainWorkout: adapted.mainWorkout ?? day.mainWorkout,
      sets: day.sets.map((set) => ({ ...set, weight: byId.get(set.id) ?? set.weight })),
    };
  });
}

export function withState(engineState: PlanEngineState): AdaptationInput["plan"] {
  return { startDate: "2026-09-14", totalWeeks: 12, engineState };
}
