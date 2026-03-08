import {
  trainingPlans,
  planDays,
  workoutLogs,
  type WorkoutLog,
  type TimelineEntry,
} from "@shared/schema";
import { db } from "../db";
import { eq, and, isNull, inArray, sql, desc } from "drizzle-orm";
import type { WorkoutStorage } from "./workouts";
import { toDateStr } from "../types";

function mapWorkoutLogToTimelineFields(log: WorkoutLog) {
  return {
    source: (log.source as "manual" | "strava") || "manual",
    calories: log.calories,
    distanceMeters: log.distanceMeters,
    elevationGain: log.elevationGain,
    avgHeartrate: log.avgHeartrate,
    maxHeartrate: log.maxHeartrate,
    avgSpeed: log.avgSpeed,
    maxSpeed: log.maxSpeed,
    avgCadence: log.avgCadence,
    avgWatts: log.avgWatts,
    sufferScore: log.sufferScore,
  };
}

export class TimelineStorage {
  constructor(private workoutStorage: WorkoutStorage) {}

  async getTimeline(userId: string, planId?: string): Promise<TimelineEntry[]> {
    const entries: TimelineEntry[] = [];
    const today = toDateStr();

    const planDayConditions = planId 
      ? and(eq(trainingPlans.userId, userId), eq(planDays.planId, planId))
      : eq(trainingPlans.userId, userId);

    const scheduledDaysResult = await db
      .select({ planDay: planDays, planName: trainingPlans.name, planId: trainingPlans.id })
      .from(planDays)
      .innerJoin(trainingPlans, eq(planDays.planId, trainingPlans.id))
      .where(planDayConditions);

    const scheduledDays = scheduledDaysResult
      .filter(r => r.planDay.scheduledDate);

    const planDayIds = scheduledDays.map(r => r.planDay.id);

    const [linkedWorkouts, standaloneWorkouts] = await Promise.all([
      planDayIds.length > 0
        ? db.select().from(workoutLogs).where(
            and(eq(workoutLogs.userId, userId), inArray(workoutLogs.planDayId, planDayIds))
          )
        : Promise.resolve([]),
      db.select().from(workoutLogs).where(
        and(eq(workoutLogs.userId, userId), isNull(workoutLogs.planDayId))
      ),
    ]);

    const workoutsByPlanDayId = new Map<string, WorkoutLog>();
    for (const log of linkedWorkouts) {
      if (log.planDayId) {
        workoutsByPlanDayId.set(log.planDayId, log);
      }
    }

    for (const row of scheduledDays) {
      const day = row.planDay;
      if (day.scheduledDate) {
        const linkedLog = workoutsByPlanDayId.get(day.id);

        if (linkedLog) {
          entries.push({
            id: `log-${linkedLog.id}`,
            date: linkedLog.date,
            type: "logged",
            status: "completed",
            focus: linkedLog.focus,
            mainWorkout: linkedLog.mainWorkout,
            accessory: linkedLog.accessory,
            notes: linkedLog.notes,
            duration: linkedLog.duration,
            rpe: linkedLog.rpe,
            planDayId: day.id,
            workoutLogId: linkedLog.id,
            weekNumber: day.weekNumber,
            dayName: day.dayName,
            planName: row.planName,
            planId: row.planId,
            ...mapWorkoutLogToTimelineFields(linkedLog),
          });
        } else {
          const status = day.status === "skipped" ? "skipped" :
            day.status === "completed" ? "completed" :
            day.status === "missed" ? "missed" :
            day.scheduledDate < today ? "missed" : "planned";

          entries.push({
            id: `plan-${day.id}`,
            date: day.scheduledDate,
            type: "planned",
            status: status as any,
            focus: day.focus,
            mainWorkout: day.mainWorkout,
            accessory: day.accessory,
            notes: day.notes,
            planDayId: day.id,
            weekNumber: day.weekNumber,
            dayName: day.dayName,
            planName: row.planName,
            planId: row.planId,
          });
        }
      }
    }

    for (const log of standaloneWorkouts) {
      entries.push({
        id: `log-${log.id}`,
        date: log.date,
        type: "logged",
        status: "completed",
        focus: log.focus,
        mainWorkout: log.mainWorkout,
        accessory: log.accessory,
        notes: log.notes,
        duration: log.duration,
        rpe: log.rpe,
        workoutLogId: log.id,
        ...mapWorkoutLogToTimelineFields(log),
      });
    }

    const workoutLogIds = entries
      .filter(e => e.workoutLogId)
      .map(e => e.workoutLogId!);
    
    if (workoutLogIds.length > 0) {
      const allSets = await this.workoutStorage.getExerciseSetsByWorkoutLogs(workoutLogIds);
      const setsByWorkoutId = new Map<string, typeof allSets>();
      for (const s of allSets) {
        const existing = setsByWorkoutId.get(s.workoutLogId) || [];
        existing.push(s);
        setsByWorkoutId.set(s.workoutLogId, existing);
      }
      for (const entry of entries) {
        if (entry.workoutLogId) {
          entry.exerciseSets = setsByWorkoutId.get(entry.workoutLogId) || [];
        }
      }
    }

    return entries.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }
}
