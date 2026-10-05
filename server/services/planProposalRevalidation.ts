import type { EnrichedPlanAdjustmentChange, ExerciseSet, PlanDay } from "@shared/schema";

import { changeLandsBefore } from "../storage/planProposals";
import {
  buildWorkoutPrescriptionFingerprint,
  mapExerciseSetToPromptDetail,
} from "./aiModificationGuard";

/**
 * Checking a plan-adjustment proposal against the plan as it is now, before
 * the apply writes anything (planAdjustmentService). Pure: the caller reads
 * the days, unlocked first and then again under the row locks.
 */

/** A day a change will write, as it stands now, with its prescribed sets. */
export type LivePlanDay = { day: PlanDay; sets: ExerciseSet[] };

/** A change the plan has moved on from, named for the athlete. */
export type StaleChange = { planDayId: string; dayLabel: string };

/** The rows a check reads: each day by id, and its prescribed sets. */
export interface ChangePlanDays {
  readonly dayById: ReadonlyMap<string, PlanDay>;
  readonly setsByDay: ReadonlyMap<string, ExerciseSet[]>;
}

function fingerprintLiveDay({ day, sets }: LivePlanDay): string | undefined {
  return buildWorkoutPrescriptionFingerprint({
    mainWorkout: day.mainWorkout,
    accessory: day.accessory ?? undefined,
    notes: day.notes ?? undefined,
    exerciseDetails: sets.map(mapExerciseSetToPromptDetail),
  });
}

/**
 * Revalidate every change against the live plan. Multi-day rebalances are
 * coherent units, so this apply is ALL-OR-NOTHING: any stale day invalidates
 * the whole proposal rather than applying a nonsense subset.
 *
 * A change that would leave its day before the athlete's `today` is stale
 * too. Proposals carry no date bounds, so one applied days after it was made
 * could put a session on a date already gone, where it read as missed at
 * once — C33 (CODEBASE_ANALYSIS_2026-10-03).
 */
export function revalidateProposalChanges(
  changes: EnrichedPlanAdjustmentChange[],
  { dayById, setsByDay }: ChangePlanDays,
  today: string,
): { liveDays: Map<string, LivePlanDay>; staleChanges: StaleChange[] } {
  const liveDays = new Map<string, LivePlanDay>();
  const staleChanges: StaleChange[] = [];

  for (const change of changes) {
    const day = dayById.get(change.planDayId);
    const sets = setsByDay.get(change.planDayId) ?? [];
    const live: LivePlanDay | null =
      day?.status === "planned" && !changeLandsBefore(change, day.scheduledDate, today)
        ? { day, sets }
        : null;
    if (!live || fingerprintLiveDay(live) !== change.baseline.fingerprint) {
      staleChanges.push({ planDayId: change.planDayId, dayLabel: change.dayLabel });
      continue;
    }
    liveDays.set(change.planDayId, live);
  }
  return { liveDays, staleChanges };
}
