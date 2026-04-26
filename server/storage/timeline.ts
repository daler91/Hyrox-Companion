import {
  type ExerciseSet,
  exerciseSets,
  type PlanDay,
  planDays,
  type TimelineEntry,
  trainingPlans,
  type WorkoutLog,
  workoutLogs,
  type WorkoutStatus,
} from "@shared/schema";
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, notInArray } from "drizzle-orm";

import { db } from "../db";
import { toDateStr } from "../types";
import type { WorkoutStorage } from "./workouts";

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
    plannedSetCount: log.plannedSetCount,
    actualSetCount: log.actualSetCount,
    matchedSetCount: log.matchedSetCount,
    addedSetCount: log.addedSetCount,
    removedSetCount: log.removedSetCount,
    compliancePct: log.compliancePct,
  };
}

function calculatePlanDayStatus(
  dayStatus: string | null,
  scheduledDate: string,
  today: string,
): WorkoutStatus {
  if (dayStatus === "skipped") return "skipped";
  if (dayStatus === "completed") return "completed";
  if (dayStatus === "missed") return "missed";
  if (scheduledDate < today) return "missed";
  return "planned";
}

function createLinkedWorkoutEntry(
  day: PlanDay,
  linkedLog: WorkoutLog,
  row: { planName: string; planId: string },
): TimelineEntry {
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
    aiRationale: day.aiRationale,
    aiNoteUpdatedAt: day.aiNoteUpdatedAt,
    aiInputsUsed: day.aiInputsUsed,
    ...mapWorkoutLogToTimelineFields(linkedLog),
  };
}

function createPlannedDayEntry(
  day: PlanDay,
  scheduledDate: string,
  row: { planName: string; planId: string },
  today: string,
): TimelineEntry {
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
    aiRationale: day.aiRationale,
    aiNoteUpdatedAt: day.aiNoteUpdatedAt,
    aiInputsUsed: day.aiInputsUsed,
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

function addSetToGroup(groups: Map<string, ExerciseSet[]>, key: string, set: ExerciseSet): void {
  const existing = groups.get(key);
  if (existing) {
    existing.push(set);
    return;
  }
  groups.set(key, [set]);
}

function collectExerciseSetOwnerIds(entries: TimelineEntry[]): {
  readonly workoutLogIds: string[];
  readonly planDayIds: string[];
} {
  const workoutLogIds = new Set<string>();
  const planDayIds = new Set<string>();

  for (const entry of entries) {
    if (entry.workoutLogId) {
      workoutLogIds.add(entry.workoutLogId);
      continue;
    }
    if (entry.planDayId) {
      planDayIds.add(entry.planDayId);
    }
  }

  return {
    workoutLogIds: Array.from(workoutLogIds),
    planDayIds: Array.from(planDayIds),
  };
}

function groupExerciseSetsByWorkoutLogId(sets: ExerciseSet[]): Map<string, ExerciseSet[]> {
  const setsByWorkoutId = new Map<string, ExerciseSet[]>();
  for (const set of sets) {
    if (set.workoutLogId) {
      addSetToGroup(setsByWorkoutId, set.workoutLogId, set);
    }
  }
  return setsByWorkoutId;
}

async function fetchPlanDayExerciseSets(planDayIds: string[]): Promise<Map<string, ExerciseSet[]>> {
  if (planDayIds.length === 0) return new Map();

  const prescribedSets = await db
    .select()
    .from(exerciseSets)
    .where(inArray(exerciseSets.planDayId, planDayIds))
    .orderBy(asc(exerciseSets.planDayId), asc(exerciseSets.sortOrder));

  const setsByPlanDayId = new Map<string, ExerciseSet[]>();
  for (const set of prescribedSets) {
    if (set.planDayId) {
      addSetToGroup(setsByPlanDayId, set.planDayId, set);
    }
  }
  return setsByPlanDayId;
}

function getTimelineEntryExerciseSets(
  entry: TimelineEntry,
  setsByWorkoutId: Map<string, ExerciseSet[]>,
  setsByPlanDayId: Map<string, ExerciseSet[]>,
): ExerciseSet[] | undefined {
  if (entry.workoutLogId) return setsByWorkoutId.get(entry.workoutLogId) || [];
  if (entry.planDayId) return setsByPlanDayId.get(entry.planDayId) || [];
  return undefined;
}

function hydrateTimelineExerciseSets(
  entries: TimelineEntry[],
  setsByWorkoutId: Map<string, ExerciseSet[]>,
  setsByPlanDayId: Map<string, ExerciseSet[]>,
): void {
  for (const entry of entries) {
    const sets = getTimelineEntryExerciseSets(entry, setsByWorkoutId, setsByPlanDayId);
    if (sets) {
      entry.exerciseSets = sets;
    }
  }
}

export class TimelineStorage {
  constructor(private readonly workoutStorage: WorkoutStorage) {}

  private async attachExerciseSets(entries: TimelineEntry[]): Promise<void> {
    const { workoutLogIds, planDayIds } = collectExerciseSetOwnerIds(entries);

    if (workoutLogIds.length === 0 && planDayIds.length === 0) return;

    const [allSets, setsByPlanDayId] = await Promise.all([
      workoutLogIds.length > 0
        ? this.workoutStorage.getExerciseSetsByWorkoutLogs(workoutLogIds)
        : Promise.resolve([]),
      fetchPlanDayExerciseSets(planDayIds),
    ]);

    hydrateTimelineExerciseSets(entries, groupExerciseSetsByWorkoutLogId(allSets), setsByPlanDayId);
  }

  private async fetchScheduledDays(userId: string, planId?: string, sqlLimit?: number) {
    // Two-step relational query. First, resolve the user's plan metadata
    // (cheap — a user has ≪10 plans). Then query planDays filtered by those
    // plan IDs using the relational API. This replaces the prior manual
    // `innerJoin(trainingPlans ON plan_days.plan_id)` and keeps all filtering
    // and pagination in SQL, unlike a post-fetch user filter which would
    // break `sqlLimit` semantics.
    const userPlans = await db.query.trainingPlans.findMany({
      where: eq(trainingPlans.userId, userId),
      columns: { id: true, name: true },
    });
    if (userPlans.length === 0) return [];

    const planIds = userPlans.map((p) => p.id);
    const relevantPlanIds = planId && planIds.includes(planId) ? [planId] : planIds;
    if (relevantPlanIds.length === 0) return [];
    const planNameById = new Map(userPlans.map((p) => [p.id, p.name]));

    const days = await db.query.planDays.findMany({
      where: and(inArray(planDays.planId, relevantPlanIds), isNotNull(planDays.scheduledDate)),
      orderBy: desc(planDays.scheduledDate),
      ...(sqlLimit === undefined ? {} : { limit: sqlLimit }),
    });

    return days.map((day) => ({
      planDay: day as PlanDay,
      planName: planNameById.get(day.planId)!,
      planId: day.planId,
    }));
  }

  private computeSqlOverFetch(limit?: number, offset?: number): number | undefined {
    if (limit === undefined && offset === undefined) return undefined;
    if (limit === undefined) return undefined;
    return (offset || 0) + limit * 3;
  }

  private async fetchStandaloneWorkouts(userId: string, sqlLimit?: number): Promise<WorkoutLog[]> {
    let query = db
      .select()
      .from(workoutLogs)
      .where(and(eq(workoutLogs.userId, userId), isNull(workoutLogs.planDayId)))
      .orderBy(desc(workoutLogs.date))
      .$dynamic();

    if (sqlLimit !== undefined) {
      query = query.limit(sqlLimit);
    }

    return query;
  }

  private buildTimelineEntries(
    scheduledDays: Awaited<ReturnType<TimelineStorage["fetchScheduledDays"]>>,
    linkedWorkouts: WorkoutLog[],
    standaloneWorkouts: WorkoutLog[],
    today: string,
  ): TimelineEntry[] {
    const entries: TimelineEntry[] = [];

    const workoutsByPlanDayId = new Map<string, WorkoutLog>();
    for (const log of linkedWorkouts) {
      if (log.planDayId) {
        workoutsByPlanDayId.set(log.planDayId, log);
      }
    }

    for (const row of scheduledDays) {
      const day = row.planDay;
      if (!day.scheduledDate) continue;
      const linkedLog = workoutsByPlanDayId.get(day.id);
      if (linkedLog) {
        entries.push(
          createLinkedWorkoutEntry(day, linkedLog, { planName: row.planName, planId: row.planId }),
        );
      } else {
        entries.push(
          createPlannedDayEntry(
            day,
            day.scheduledDate,
            { planName: row.planName, planId: row.planId },
            today,
          ),
        );
      }
    }

    for (const log of standaloneWorkouts) {
      entries.push(createStandaloneWorkoutEntry(log));
    }

    return entries;
  }

  async getTimeline(
    userId: string,
    planId?: string,
    limit?: number,
    offset?: number,
  ): Promise<TimelineEntry[]> {
    const today = toDateStr();
    const sqlOverFetch = this.computeSqlOverFetch(limit, offset);

    const scheduledDays = await this.fetchScheduledDays(userId, planId, sqlOverFetch);
    const planDayIds = scheduledDays.map((r) => r.planDay.id);

    const [linkedWorkouts, standaloneWorkouts] = await Promise.all([
      planDayIds.length > 0
        ? db
            .select()
            .from(workoutLogs)
            .where(and(eq(workoutLogs.userId, userId), inArray(workoutLogs.planDayId, planDayIds)))
        : Promise.resolve([]),
      this.fetchStandaloneWorkouts(userId, sqlOverFetch),
    ]);

    const entries = this.buildTimelineEntries(
      scheduledDays,
      linkedWorkouts,
      standaloneWorkouts,
      today,
    );
    await this.attachExerciseSets(entries);

    // Fast string comparison for YYYY-MM-DD dates instead of Date object instantiation
    entries.sort((a, b) => {
      if (b.date < a.date) return -1;
      if (b.date > a.date) return 1;
      return 0;
    });

    if (sqlOverFetch !== undefined) {
      const start = offset || 0;
      const end = limit === undefined ? undefined : start + limit;
      return entries.slice(start, end);
    }
    return entries;
  }

  /**
   * Fetch only upcoming planned workouts directly from DB with LIMIT.
   * Avoids loading the full timeline for AI suggestions.
   */
  async getUpcomingPlannedDays(
    userId: string,
    limit: number,
  ): Promise<
    Array<{
      planDayId: string;
      date: string;
      focus: string;
      mainWorkout: string;
      accessory: string | null;
      notes: string | null;
      exerciseSets?: ExerciseSet[];
    }>
  > {
    const today = toDateStr();
    // Relational query: resolve user's plans first, then pull matching days
    // filtered by plan IDs. Same pattern as fetchScheduledDays.
    const userPlanIds = (
      await db.query.trainingPlans.findMany({
        where: eq(trainingPlans.userId, userId),
        columns: { id: true },
      })
    ).map((p) => p.id);
    if (userPlanIds.length === 0) return [];

    const rows = await db.query.planDays.findMany({
      where: and(
        inArray(planDays.planId, userPlanIds),
        isNotNull(planDays.scheduledDate),
        gte(planDays.scheduledDate, today),
        // Exclude already-completed/skipped/missed days
        notInArray(planDays.status, ["completed", "skipped", "missed"]),
      ),
      columns: {
        id: true,
        scheduledDate: true,
        focus: true,
        mainWorkout: true,
        accessory: true,
        notes: true,
        status: true,
      },
      orderBy: asc(planDays.scheduledDate),
      limit,
    });

    const setsByPlanDayId = await fetchPlanDayExerciseSets(rows.map((r) => r.id));

    const upcoming: Array<{
      planDayId: string;
      date: string;
      focus: string;
      mainWorkout: string;
      accessory: string | null;
      notes: string | null;
      exerciseSets: ExerciseSet[];
    }> = [];

    for (const r of rows) {
      if (r.scheduledDate !== null) {
        upcoming.push({
          planDayId: r.id,
          date: r.scheduledDate,
          focus: r.focus || "",
          mainWorkout: r.mainWorkout || "",
          accessory: r.accessory,
          notes: r.notes,
          exerciseSets: setsByPlanDayId.get(r.id) ?? [],
        });
      }
    }

    return upcoming;
  }
}
