import { exerciseSets, type InsertExerciseSet, workoutStructureBlocks } from "@shared/schema";
import { eq } from "drizzle-orm";

import type { SetOwner } from "./types";

export function ownerForeignKeys(owner: SetOwner) {
  if ("workoutLogId" in owner) {
    return { workoutLogId: owner.workoutLogId, planDayId: null };
  }
  return { workoutLogId: null, planDayId: owner.planDayId };
}

export function ownerColumns(owner: SetOwner): Partial<InsertExerciseSet> {
  return ownerForeignKeys(owner);
}

export function exerciseSetOwnerCondition(owner: SetOwner) {
  return "workoutLogId" in owner
    ? eq(exerciseSets.workoutLogId, owner.workoutLogId)
    : eq(exerciseSets.planDayId, owner.planDayId);
}

export function structureBlockOwnerCondition(owner: SetOwner) {
  return "workoutLogId" in owner
    ? eq(workoutStructureBlocks.workoutLogId, owner.workoutLogId)
    : eq(workoutStructureBlocks.planDayId, owner.planDayId);
}
