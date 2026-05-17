import { type ExerciseSet, exerciseSets, workoutLogs } from "@shared/schema";
import { asc, eq } from "drizzle-orm";

import { logger } from "../../logger";
import type { WorkoutTx } from "./types";

export function summarizeSetAdherence(planned: ExerciseSet[], actual: ExerciseSet[]) {
  const counts = new Map<string, { planned: number; actual: number }>();
  const keyFor = (s: ExerciseSet) => (s.customLabel || s.exerciseName || "").toLowerCase().trim();

  for (const s of planned) {
    const key = keyFor(s);
    let entry = counts.get(key);
    if (!entry) {
      entry = { planned: 0, actual: 0 };
      counts.set(key, entry);
    }
    entry.planned++;
  }

  for (const s of actual) {
    const key = keyFor(s);
    let entry = counts.get(key);
    if (!entry) {
      entry = { planned: 0, actual: 0 };
      counts.set(key, entry);
    }
    entry.actual++;
  }

  let matchedSetCount = 0;
  let addedSetCount = 0;
  let removedSetCount = 0;

  for (const { planned, actual } of counts.values()) {
    matchedSetCount += Math.min(planned, actual);
    if (actual > planned) addedSetCount += actual - planned;
    if (planned > actual) removedSetCount += planned - actual;
  }

  return {
    plannedSetCount: planned.length,
    actualSetCount: actual.length,
    matchedSetCount,
    addedSetCount,
    removedSetCount,
    compliancePct: planned.length > 0 ? Math.round((matchedSetCount / planned.length) * 100) : null,
  };
}

export function classifyWorkoutCompliance(compliancePct: number | null): "compliant" | "mostly" | "non_compliant" | "unknown" {
  if (compliancePct == null) return "unknown";
  if (compliancePct >= 85) return "compliant";
  if (compliancePct >= 60) return "mostly";
  return "non_compliant";
}

export async function persistAdherenceSnapshot(
  tx: WorkoutTx,
  workoutLogId: string,
  planDayId: string,
  actualSets: ExerciseSet[],
): Promise<void> {
  const plannedSets = await tx
    .select()
    .from(exerciseSets)
    .where(eq(exerciseSets.planDayId, planDayId))
    .orderBy(asc(exerciseSets.sortOrder));

  const snapshot = summarizeSetAdherence(plannedSets, actualSets);
  const classification = classifyWorkoutCompliance(snapshot.compliancePct);
  await tx.update(workoutLogs).set(snapshot).where(eq(workoutLogs.id, workoutLogId));
  logger.info({
    context: "health-metrics",
    event: "workout_compliance_classified",
    workoutLogId,
    planDayId,
    classification,
    compliancePct: snapshot.compliancePct,
    plannedSetCount: snapshot.plannedSetCount,
    actualSetCount: snapshot.actualSetCount,
  }, "Workout compliance classification recorded");
}
