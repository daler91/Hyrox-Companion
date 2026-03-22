import {
  trainingPlans,
  planDays,
  workoutLogs,
  type WorkoutLog,
  type TimelineEntry,
  type PlanDay,
  type WorkoutStatus,
} from "@shared/schema";
import { db } from "../db";
import { eq, and, isNull, inArray } from "drizzle-orm";
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

function calculatePlanDayStatus(dayStatus: string | null, scheduledDate: string, today: string): WorkoutStatus {
  if (dayStatus === "skipped") return "skipped";
  if (dayStatus === "completed") return "completed";
  if (dayStatus === "missed") return "missed";
  if (scheduledDate < today) return "missed";
  return "planned";
}

function createLinkedWorkoutEntry(day: PlanDay, linkedLog: WorkoutLog, row: { planName: string; planId: string }): TimelineEntry {
  return {
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
    aiSource: day.aiSource as TimelineEntry["aiSource"],
    ...mapWorkoutLogToTimelineFields(linkedLog),
  };
}

function createPlannedDayEntry(day: PlanDay, scheduledDate: string, row: { planName: string; planId: string }, today: string): TimelineEntry {
  const status = calculatePlanDayStatus(day.status, scheduledDate, today);
  return {
    id: `plan-${day.id}`,
    date: scheduledDate,
    type: "planned",
    status: status,
    focus: day.focus,
    mainWorkout: day.mainWorkout,
    accessory: day.accessory,
    notes: day.notes,
    planDayId: day.id,
    weekNumber: day.weekNumber,
    dayName: day.dayName,
    planName: row.planName,
    planId: row.planId,
    aiSource: day.aiSource as TimelineEntry["aiSource"],
  };
}

function createStandaloneWorkoutEntry(log: WorkoutLog): TimelineEntry {
  return {
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
  };
}

export class TimelineStorage {
  constructor(private readonly workoutStorage: WorkoutStorage) {}

  private async attachExerciseSets(entries: TimelineEntry[]): Promise<void> {
    const workoutLogIds = entries
      .filter(e => e.workoutLogId)
      .map(e => e.workoutLogId!);

    if (workoutLogIds.length === 0) return;

    const allSets = await this.workoutStorage.getExerciseSetsByWorkoutLogs(workoutLogIds);
    const setsByWorkoutId = Map.groupBy(allSets, (s) => s.workoutLogId);

    for (const entry of entries) {
      if (entry.workoutLogId) {
        entry.exerciseSets = setsByWorkoutId.get(entry.workoutLogId) || [];
      }
    }
  }

  private async fetchScheduledDays(userId: string, planId?: string) {
    let planDayConditions;
    if (planId) {
      planDayConditions = and(eq(trainingPlans.userId, userId), eq(planDays.planId, planId));
    } else {
      planDayConditions = eq(trainingPlans.userId, userId);
    }

    const scheduledDaysResult = await db
      .select({ planDay: planDays, planName: trainingPlans.name, planId: trainingPlans.id })
      .from(planDays)
      .innerJoin(trainingPlans, eq(planDays.planId, trainingPlans.id))
      .where(planDayConditions);

    return scheduledDaysResult.filter(r => r.planDay.scheduledDate);
  }

  async getTimeline(userId: string, planId?: string, limit?: number, offset?: number): Promise<TimelineEntry[]> {
    const entries: TimelineEntry[] = [];
    const today = toDateStr();

    const scheduledDays = await this.fetchScheduledDays(userId, planId);

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
          entries.push(createLinkedWorkoutEntry(day, linkedLog, { planName: row.planName, planId: row.planId }));
        } else {
          entries.push(createPlannedDayEntry(day, day.scheduledDate, { planName: row.planName, planId: row.planId }, today));
        }
      }
    }

    for (const log of standaloneWorkouts) {
      entries.push(createStandaloneWorkoutEntry(log));
    }

    await this.attachExerciseSets(entries);

    // Fast string comparison for YYYY-MM-DD dates instead of Date object instantiation
    entries.sort((a, b) => {
      if (b.date < a.date) return -1;
      if (b.date > a.date) return 1;
      return 0;
    });

    if (limit !== undefined || offset !== undefined) {
      const start = offset || 0;
      const end = limit === undefined ? undefined : start + limit;
      return entries.slice(start, end);
    }
    return entries;
  }
}
