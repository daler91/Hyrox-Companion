import type { ExerciseSet, PlanDay, SessionGrade, WorkoutLog } from "@shared/schema";

import { logger } from "../logger";
import { storage } from "../storage";
import { gradeWorkoutLogs } from "./sessionGrades/sessionGradeService";

/** What the workout-detail chat says it is about. Client-supplied, so unverified. */
export interface FocusedWorkoutIds {
  planDayId?: string;
  workoutLogId?: string;
}

/** The workout the athlete is chatting from, as the chat prompt describes it. */
export interface FocusedWorkout {
  planDay?: PlanDay;
  plannedSets: ExerciseSet[];
  log?: WorkoutLog;
  loggedSets: ExerciseSet[];
  grade?: SessionGrade;
}

/**
 * Load the focused workout, but only rows the athlete owns: the plan day and
 * log getters check ownership, and the log's sets are read only after its own
 * check. An id that isn't theirs, or a failed read, leaves the chat without
 * the block rather than failing the turn.
 */
export async function loadFocusedWorkout(
  userId: string,
  ids: FocusedWorkoutIds,
): Promise<FocusedWorkout | null> {
  if (!ids.planDayId && !ids.workoutLogId) return null;
  try {
    const log = ids.workoutLogId
      ? await storage.workouts.getWorkoutLog(ids.workoutLogId, userId)
      : undefined;
    const planDayId = ids.planDayId ?? log?.planDayId ?? undefined;
    const planDay = planDayId ? await storage.plans.getPlanDay(planDayId, userId) : undefined;
    if (!log && !planDay) return null;

    const [plannedSets, loggedSets, grades] = await Promise.all([
      planDay ? storage.workouts.getExerciseSetsByPlanDay(planDay.id, userId) : null,
      log ? storage.workouts.getExerciseSetsByWorkoutLog(log.id) : [],
      // Only plan-linked runs are graded; anything else returns at once.
      log ? gradeWorkoutLogs(storage, userId, [log]) : new Map<string, SessionGrade>(),
    ]);
    return {
      planDay,
      plannedSets: plannedSets ?? [],
      log,
      loggedSets,
      grade: log ? grades.get(log.id) : undefined,
    };
  } catch (error) {
    // A storage or grading error, not chat content.
    // bearer:disable javascript_lang_logger_leak
    logger.warn({ err: error }, "[chat] Could not load the focused workout; replying without it");
    return null;
  }
}
