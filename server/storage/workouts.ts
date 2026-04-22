import {
  type ExerciseSet,
  exerciseSets,
  type InsertExerciseSet,
  type InsertWorkoutLog,
  planDays,
  trainingPlans,
  type UpdateWorkoutLog,
  type WorkoutLog,
  workoutLogs,
} from "@shared/schema";
import { and, asc, desc, eq, inArray,isNotNull, isNull, or, sql } from "drizzle-orm";

import { db } from "../db";
import { syncPlanDayStatusFromWorkouts } from "./planDayStatus";
import { queryExerciseSetsWithDates } from "./shared";

// Count distinct exercises in a logged workout whose best weight matches the
// user's all-time max for that exercise. "Conservative PR" — we only credit
// exercises that include a weighted set; running/time/distance PRs are not
// counted here. Extracted as a pure function so the storage method stays
// within Sonar's cognitive-complexity ceiling.
function countPrSets(
  workoutSets: Array<{ exerciseName: string; weight: number | null }>,
  maxByExercise: Map<string, number | null>,
): number {
  const counted = new Set<string>();
  let prs = 0;
  for (const s of workoutSets) {
    if (s.weight == null || counted.has(s.exerciseName)) continue;
    const max = maxByExercise.get(s.exerciseName);
    if (max != null && s.weight >= max) {
      prs++;
      counted.add(s.exerciseName);
    }
  }
  return prs;
}

export class WorkoutStorage {
  private getPlanDayCompletionCondition(planDayIds: string | string[], userId: string) {
    const ids = Array.isArray(planDayIds) ? planDayIds : [planDayIds];
    return and(
      inArray(planDays.id, ids),
      eq(planDays.planId, trainingPlans.id),
      eq(trainingPlans.userId, userId)
    );
  }

  async createWorkoutLog(log: InsertWorkoutLog & { userId: string }): Promise<WorkoutLog> {
    // Wrap the insert and the plan_day status update in a single
    // transaction so two concurrent saves cannot interleave between the
    // insert and the status write, leaving the plan day's "completed" flag
    // out of sync with the underlying workout rows.
    return await db.transaction(async (tx) => {
      const [workoutLog] = await tx
        .insert(workoutLogs)
        .values(log)
        .returning();

      if (log.planDayId) {
        await tx
          .update(planDays)
          .set({ status: "completed" })
          .from(trainingPlans)
          .where(this.getPlanDayCompletionCondition(log.planDayId, log.userId));
      }

      return workoutLog;
    });
  }

  async createWorkoutLogs(logs: (InsertWorkoutLog & { userId: string })[]): Promise<WorkoutLog[]> {
    if (logs.length === 0) return [];

    // Use onConflictDoNothing against the (user_id, strava_activity_id) unique
    // index (partial: WHERE strava_activity_id IS NOT NULL) so concurrent
    // Strava syncs cannot create duplicate rows for the same activity
    // (CODEBASE_AUDIT.md §5). Non-Strava inserts are unaffected because the
    // index is partial and does not cover NULL activity IDs.
    const createdLogs = await db
      .insert(workoutLogs)
      .values(logs)
      .onConflictDoNothing({
        target: [workoutLogs.userId, workoutLogs.stravaActivityId],
        where: sql`${workoutLogs.stravaActivityId} IS NOT NULL`,
      })
      .returning();

    // Group planDayIds by userId to ensure proper authorization per user
    // Since logs could potentially come from different users in a batch
    const updateConditions = [];
    const updatesByUser = new Map<string, string[]>();

    for (const log of logs) {
      if (log.planDayId) {
        const ids = updatesByUser.get(log.userId) || [];
        ids.push(log.planDayId);
        updatesByUser.set(log.userId, ids);
      }
    }

    for (const [userId, planDayIds] of updatesByUser) {
      if (planDayIds.length > 0) {
        updateConditions.push(this.getPlanDayCompletionCondition(planDayIds, userId));
      }
    }

    if (updateConditions.length > 0) {
      // Bolt Optimization: Consolidate multiple user-specific updates into a single bulk query
      // and use direct JOIN via .from() instead of inArray() subquery to prevent N+1 execution
      await db
        .update(planDays)
        .set({ status: "completed" })
        .from(trainingPlans)
        .where(or(...updateConditions));
    }

    return createdLogs;
  }

  async listWorkoutLogs(userId: string, limit?: number, offset?: number): Promise<WorkoutLog[]> {
    let query = db
      .select()
      .from(workoutLogs)
      .where(eq(workoutLogs.userId, userId))
      .orderBy(desc(workoutLogs.date))
      .$dynamic();

    if (limit !== undefined) {
      query = query.limit(limit);
    }
    if (offset !== undefined) {
      query = query.offset(offset);
    }

    return await query;
  }

  async getWorkoutLog(logId: string, userId: string): Promise<WorkoutLog | undefined> {
    const [log] = await db
      .select()
      .from(workoutLogs)
      .where(and(eq(workoutLogs.id, logId), eq(workoutLogs.userId, userId)));
    return log;
  }

  // ⚡ Bolt Performance Optimization:
  // Removed redundant pre-fetch existence check (getWorkoutLog) that duplicated
  // the same WHERE clause used by the UPDATE. The UPDATE + RETURNING already
  // yields undefined when no rows match, saving 1 DB round trip per call.
  async updateWorkoutLog(logId: string, updates: UpdateWorkoutLog, userId: string): Promise<WorkoutLog | undefined> {
    const [updatedLog] = await db
      .update(workoutLogs)
      .set(updates)
      .where(and(eq(workoutLogs.id, logId), eq(workoutLogs.userId, userId)))
      .returning();
    return updatedLog;
  }

  // Deletes a single workout log AND re-syncs its linked plan_day status from
  // the remaining workout count. Prior to this fix (S6), the plan_day kept a
  // stale "completed" status after its only workout was deleted, which broke
  // analytics and the "Log workout" CTA on the Timeline.
  async deleteWorkoutLog(logId: string, userId: string): Promise<boolean> {
    return await db.transaction(async (tx) => {
      const [log] = await tx
        .select({ planDayId: workoutLogs.planDayId })
        .from(workoutLogs)
        .where(and(eq(workoutLogs.id, logId), eq(workoutLogs.userId, userId)))
        .limit(1);
      if (!log) return false;

      const result = await tx
        .delete(workoutLogs)
        .where(and(eq(workoutLogs.id, logId), eq(workoutLogs.userId, userId)));
      const deleted = result.rowCount !== null && result.rowCount > 0;
      if (!deleted) return false;

      if (log.planDayId) {
        await syncPlanDayStatusFromWorkouts(log.planDayId, userId, tx);
      }
      return true;
    });
  }

  async deleteWorkoutLogByPlanDayId(planDayId: string, userId: string): Promise<boolean> {
    return await db.transaction(async (tx) => {
      const result = await tx
        .delete(workoutLogs)
        .where(and(eq(workoutLogs.planDayId, planDayId), eq(workoutLogs.userId, userId)));
      const deleted = result.rowCount !== null && result.rowCount > 0;
      if (!deleted) return false;

      await syncPlanDayStatusFromWorkouts(planDayId, userId, tx);
      return true;
    });
  }

  async getWorkoutLogByPlanDayId(planDayId: string, userId: string): Promise<WorkoutLog | undefined> {
    const [log] = await db
      .select()
      .from(workoutLogs)
      .where(and(eq(workoutLogs.planDayId, planDayId), eq(workoutLogs.userId, userId)))
      .limit(1);
    return log;
  }

  async getWorkoutByStravaActivityId(userId: string, stravaActivityId: string): Promise<WorkoutLog | undefined> {
    const [log] = await db
      .select()
      .from(workoutLogs)
      .where(and(eq(workoutLogs.userId, userId), eq(workoutLogs.stravaActivityId, stravaActivityId)));
    return log;
  }

  async getExistingStravaActivityIds(userId: string, stravaActivityIds: string[]): Promise<string[]> {
    if (stravaActivityIds.length === 0) return [];
    const rows = await db
      .select({ stravaActivityId: workoutLogs.stravaActivityId })
      .from(workoutLogs)
      .where(
        and(
          eq(workoutLogs.userId, userId),
          inArray(workoutLogs.stravaActivityId, stravaActivityIds),
          isNotNull(workoutLogs.stravaActivityId)
        )
      );
    return rows.map((r) => r.stravaActivityId as string);
  }

  /**
   * Garmin-specific bulk insert. Mirrors createWorkoutLogs but targets the
   * (user_id, garmin_activity_id) partial unique index so concurrent Garmin
   * syncs can't double-import the same activity. Routes still pre-dedupe via
   * getExistingGarminActivityIds; this is the concurrent-safety backstop.
   */
  async createGarminWorkoutLogs(logs: (InsertWorkoutLog & { userId: string })[]): Promise<WorkoutLog[]> {
    if (logs.length === 0) return [];

    const createdLogs = await db
      .insert(workoutLogs)
      .values(logs)
      .onConflictDoNothing({
        target: [workoutLogs.userId, workoutLogs.garminActivityId],
        where: sql`${workoutLogs.garminActivityId} IS NOT NULL`,
      })
      .returning();

    return createdLogs;
  }

  async getExistingGarminActivityIds(userId: string, garminActivityIds: string[]): Promise<string[]> {
    if (garminActivityIds.length === 0) return [];
    const rows = await db
      .select({ garminActivityId: workoutLogs.garminActivityId })
      .from(workoutLogs)
      .where(
        and(
          eq(workoutLogs.userId, userId),
          inArray(workoutLogs.garminActivityId, garminActivityIds),
          isNotNull(workoutLogs.garminActivityId)
        )
      );
    return rows.map((r) => r.garminActivityId as string);
  }

  async createExerciseSets(sets: InsertExerciseSet[]): Promise<ExerciseSet[]> {
    if (sets.length === 0) return [];
    return await db.insert(exerciseSets).values(sets).returning();
  }

  async getExerciseSetsByWorkoutLog(workoutLogId: string): Promise<ExerciseSet[]> {
    return await db
      .select()
      .from(exerciseSets)
      .where(eq(exerciseSets.workoutLogId, workoutLogId))
      .orderBy(asc(exerciseSets.sortOrder));
  }

  async getExerciseSetsByWorkoutLogs(workoutLogIds: string[]): Promise<ExerciseSet[]> {
    if (workoutLogIds.length === 0) return [];
    return await db
      .select()
      .from(exerciseSets)
      .where(inArray(exerciseSets.workoutLogId, workoutLogIds))
      .orderBy(asc(exerciseSets.sortOrder));
  }

  // ⚡ Bolt Performance Optimization:
  // Removed redundant pre-fetch existence check (getWorkoutLog). The DELETE's
  // subquery already includes the same userId authorization, so if the workout
  // doesn't exist or belongs to another user, zero rows are deleted (safe no-op).
  // Saves 1 DB round trip per call.
  async deleteExerciseSetsByWorkoutLog(workoutLogId: string, userId: string): Promise<boolean> {
    await db
      .delete(exerciseSets)
      .where(
        inArray(
          exerciseSets.workoutLogId,
          db.select({ id: workoutLogs.id })
            .from(workoutLogs)
            .where(and(eq(workoutLogs.id, workoutLogId), eq(workoutLogs.userId, userId)))
        )
      );
    return true;
  }

  async getExerciseHistory(userId: string, exerciseName: string): Promise<(ExerciseSet & { date: string })[]> {
    return await queryExerciseSetsWithDates(userId, { exerciseName });
  }

  /**
   * Fetches a single exercise set and verifies the requesting user owns the
   * parent row — either the workoutLog or the planDay via its trainingPlan.
   * Returns undefined when the set doesn't exist or belongs to someone else,
   * so callers can surface a 404 without leaking existence (§IDOR).
   */
  async getExerciseSetOwned(setId: string, userId: string): Promise<ExerciseSet | undefined> {
    const [row] = await db
      .select({ set: exerciseSets })
      .from(exerciseSets)
      .leftJoin(workoutLogs, eq(exerciseSets.workoutLogId, workoutLogs.id))
      .leftJoin(planDays, eq(exerciseSets.planDayId, planDays.id))
      .leftJoin(trainingPlans, eq(planDays.planId, trainingPlans.id))
      .where(
        and(
          eq(exerciseSets.id, setId),
          or(eq(workoutLogs.userId, userId), eq(trainingPlans.userId, userId)),
        ),
      )
      .limit(1);
    return row?.set;
  }

  async updateExerciseSet(
    workoutLogId: string,
    setId: string,
    updates: Partial<Omit<InsertExerciseSet, "id" | "workoutLogId" | "planDayId">>,
    userId: string,
  ): Promise<ExerciseSet | undefined> {
    const owned = await this.getExerciseSetOwned(setId, userId);
    // Reject when the set doesn't exist, belongs to someone else, or belongs
    // to a different workoutLog than the nested route's :id segment. Without
    // the parent-id check, /workouts/<A>/sets/<setId-from-B> could silently
    // mutate B's set when the caller owns both (Codex P2).
    if (owned?.workoutLogId !== workoutLogId) return undefined;
    const [updated] = await db
      .update(exerciseSets)
      .set(updates)
      .where(eq(exerciseSets.id, setId))
      .returning();
    return updated;
  }

  async deleteExerciseSet(workoutLogId: string, setId: string, userId: string): Promise<boolean> {
    const owned = await this.getExerciseSetOwned(setId, userId);
    if (owned?.workoutLogId !== workoutLogId) return false;
    const result = await db.delete(exerciseSets).where(eq(exerciseSets.id, setId));
    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Creates a new exercise set under a workoutLog the user owns. Used by the
   * "+Add" row in the structured exercises table. Auto-assigns sortOrder to
   * append at the end so the new row lands below existing sets.
   */
  async addExerciseSetToWorkoutLog(
    workoutLogId: string,
    set: Omit<InsertExerciseSet, "id" | "workoutLogId" | "planDayId" | "sortOrder">,
    userId: string,
  ): Promise<ExerciseSet | undefined> {
    const log = await this.getWorkoutLog(workoutLogId, userId);
    if (!log) return undefined;
    const [max] = await db
      .select({ maxOrder: sql<number | null>`max(${exerciseSets.sortOrder})` })
      .from(exerciseSets)
      .where(eq(exerciseSets.workoutLogId, workoutLogId));
    const nextOrder = (max?.maxOrder ?? -1) + 1;
    const [created] = await db
      .insert(exerciseSets)
      .values({ ...set, workoutLogId, planDayId: null, sortOrder: nextOrder })
      .returning();
    return created;
  }

  // -------------------------------------------------------------------
  // Plan-day prescribed exerciseSets — mirrors the workoutLog CRUD above
  // but writes to rows owned by a planDay instead. Used by the v2 dialog
  // when a planned entry is open: the user can edit the prescribed sets
  // before hitting Mark complete, and those edits get copied into the
  // new workoutLog by createWorkoutInTx's copy-from-plan path.
  // -------------------------------------------------------------------

  /**
   * Confirms the plan day belongs to a training plan owned by the user.
   * Used as an IDOR guard on every plan-day set mutation so a caller
   * can't write to another tenant's plan.
   */
  private async ownsPlanDay(planDayId: string, userId: string): Promise<boolean> {
    const [row] = await db
      .select({ id: planDays.id })
      .from(planDays)
      .innerJoin(trainingPlans, eq(planDays.planId, trainingPlans.id))
      .where(and(eq(planDays.id, planDayId), eq(trainingPlans.userId, userId)))
      .limit(1);
    return !!row;
  }

  async getExerciseSetsByPlanDay(planDayId: string, userId: string): Promise<ExerciseSet[] | null> {
    // Distinguish "unauthorized / missing plan day" (null → 404 at the
    // route) from "owned but prescription is empty" ([]). Returning []
    // in both cases would let a foreign or bogus dayId look like a
    // valid empty plan, weakening IDOR on this read path.
    if (!(await this.ownsPlanDay(planDayId, userId))) return null;
    return await db
      .select()
      .from(exerciseSets)
      .where(eq(exerciseSets.planDayId, planDayId))
      .orderBy(asc(exerciseSets.sortOrder));
  }

  async addExerciseSetToPlanDay(
    planDayId: string,
    set: Omit<InsertExerciseSet, "id" | "workoutLogId" | "planDayId" | "sortOrder">,
    userId: string,
  ): Promise<ExerciseSet | undefined> {
    if (!(await this.ownsPlanDay(planDayId, userId))) return undefined;
    const [max] = await db
      .select({ maxOrder: sql<number | null>`max(${exerciseSets.sortOrder})` })
      .from(exerciseSets)
      .where(eq(exerciseSets.planDayId, planDayId));
    const nextOrder = (max?.maxOrder ?? -1) + 1;
    const [created] = await db
      .insert(exerciseSets)
      .values({ ...set, planDayId, workoutLogId: null, sortOrder: nextOrder })
      .returning();
    return created;
  }

  async updateExerciseSetForPlanDay(
    planDayId: string,
    setId: string,
    updates: Partial<Omit<InsertExerciseSet, "id" | "workoutLogId" | "planDayId">>,
    userId: string,
  ): Promise<ExerciseSet | undefined> {
    const owned = await this.getExerciseSetOwned(setId, userId);
    // Same IDOR guard pattern as updateExerciseSet: reject when the set
    // doesn't exist, belongs to someone else, or belongs to a different
    // plan day than the nested-route segment.
    if (owned?.planDayId !== planDayId) return undefined;
    const [updated] = await db
      .update(exerciseSets)
      .set(updates)
      .where(eq(exerciseSets.id, setId))
      .returning();
    return updated;
  }

  async deleteExerciseSetForPlanDay(planDayId: string, setId: string, userId: string): Promise<boolean> {
    const owned = await this.getExerciseSetOwned(setId, userId);
    if (owned?.planDayId !== planDayId) return false;
    const result = await db.delete(exerciseSets).where(eq(exerciseSets.id, setId));
    return (result.rowCount ?? 0) > 0;
  }

  private async fetchLastSameFocus(
    currentDate: string,
    focus: string | null | undefined,
    userId: string,
  ): Promise<{ date: string; focus: string } | null> {
    if (!focus) return null;
    const [prev] = await db
      .select({ date: workoutLogs.date, focus: workoutLogs.focus })
      .from(workoutLogs)
      .where(
        and(
          eq(workoutLogs.userId, userId),
          eq(workoutLogs.focus, focus),
          sql`${workoutLogs.date} < ${currentDate}`,
        ),
      )
      .orderBy(desc(workoutLogs.date))
      .limit(1);
    return prev ? { date: prev.date, focus: prev.focus } : null;
  }

  private async fetchPrSetCount(workoutLogId: string, userId: string): Promise<number> {
    const thisWorkoutSets = await db
      .select({
        exerciseName: exerciseSets.exerciseName,
        weight: exerciseSets.weight,
      })
      .from(exerciseSets)
      .where(eq(exerciseSets.workoutLogId, workoutLogId));

    const exerciseNames = [...new Set(thisWorkoutSets.map((s) => s.exerciseName))];
    if (exerciseNames.length === 0) return 0;

    const userMaxes = await db
      .select({
        exerciseName: exerciseSets.exerciseName,
        maxWeight: sql<number | null>`max(${exerciseSets.weight})`,
      })
      .from(exerciseSets)
      .innerJoin(workoutLogs, eq(exerciseSets.workoutLogId, workoutLogs.id))
      .where(
        and(
          eq(workoutLogs.userId, userId),
          inArray(exerciseSets.exerciseName, exerciseNames),
        ),
      )
      .groupBy(exerciseSets.exerciseName);
    const maxByExercise = new Map(userMaxes.map((m) => [m.exerciseName, m.maxWeight]));

    return countPrSets(thisWorkoutSets, maxByExercise);
  }

  private async fetchBlockAvgRpe(currentDate: string, userId: string): Promise<number | null> {
    const [rpe] = await db
      .select({ avg: sql<number | null>`avg(${workoutLogs.rpe})` })
      .from(workoutLogs)
      .where(
        and(
          eq(workoutLogs.userId, userId),
          isNotNull(workoutLogs.rpe),
          sql`${workoutLogs.date} >= (${currentDate}::date - INTERVAL '14 days')`,
          sql`${workoutLogs.date} <= (${currentDate}::date + INTERVAL '14 days')`,
        ),
      );
    return rpe?.avg == null ? null : Math.round(Number(rpe.avg) * 10) / 10;
  }

  /**
   * History stats shown on the workout-detail sidebar: when the athlete last
   * trained the same focus, how many PR sets this workout contains, and the
   * average RPE across the surrounding 4-week block. Computed at read time —
   * there is no dedicated denormalised table.
   */
  async getWorkoutHistoryStats(
    workoutLogId: string,
    userId: string,
  ): Promise<{
    lastSameFocus: { date: string; focus: string } | null;
    prSetCount: number;
    blockAvgRpe: number | null;
  } | undefined> {
    const log = await this.getWorkoutLog(workoutLogId, userId);
    if (!log) return undefined;

    const [lastSameFocus, prSetCount, blockAvgRpe] = await Promise.all([
      this.fetchLastSameFocus(log.date, log.focus, userId),
      this.fetchPrSetCount(workoutLogId, userId),
      this.fetchBlockAvgRpe(log.date, userId),
    ]);

    return { lastSameFocus, prSetCount, blockAvgRpe };
  }

  /**
   * Copy prescribed exercise sets from the workout's linked plan day into the
   * workout itself as starter rows. Used by the workout-detail UI when it
   * opens a logged workout that has a planDayId but no sets of its own
   * (legacy rows written before structured plan generation shipped).
   * Idempotent: if the workout already has sets, do nothing.
   */
  async seedExerciseSetsFromPlanDay(workoutLogId: string, userId: string): Promise<number> {
    return await db.transaction(async (tx) => {
      // Row-lock the parent workout so two concurrent seed calls serialize
      // through Postgres. Without this, both requests could observe an
      // empty exerciseSets table and each insert a full copy, producing
      // duplicate rows with colliding sortOrder values.
      const [log] = await tx
        .select({ id: workoutLogs.id, planDayId: workoutLogs.planDayId })
        .from(workoutLogs)
        .where(and(eq(workoutLogs.id, workoutLogId), eq(workoutLogs.userId, userId)))
        .for("update")
        .limit(1);
      if (log?.planDayId == null) return 0;

      const existing = await tx
        .select({ id: exerciseSets.id })
        .from(exerciseSets)
        .where(eq(exerciseSets.workoutLogId, workoutLogId))
        .limit(1);
      if (existing.length > 0) return 0;

      const prescribed = await tx
        .select()
        .from(exerciseSets)
        .where(eq(exerciseSets.planDayId, log.planDayId))
        .orderBy(asc(exerciseSets.sortOrder));
      if (prescribed.length === 0) return 0;

      const rows = prescribed.map((p) => ({
        workoutLogId,
        planDayId: null,
        exerciseName: p.exerciseName,
        customLabel: p.customLabel,
        category: p.category,
        setNumber: p.setNumber,
        reps: p.reps,
        weight: p.weight,
        distance: p.distance,
        time: p.time,
        notes: p.notes,
        confidence: p.confidence,
        sortOrder: p.sortOrder,
      }));
      await tx.insert(exerciseSets).values(rows);
      return rows.length;
    });
  }

  async getWorkoutsWithoutExerciseSets(userId: string): Promise<WorkoutLog[]> {
    const results = await db
      .select({ workoutLog: workoutLogs })
      .from(workoutLogs)
      .leftJoin(exerciseSets, eq(workoutLogs.id, exerciseSets.workoutLogId))
      .where(
        and(
          eq(workoutLogs.userId, userId),
          isNull(exerciseSets.id),
          isNotNull(workoutLogs.mainWorkout),
          sql`TRIM(${workoutLogs.mainWorkout}) <> ''`
        )
      );
    return results.map(r => r.workoutLog);
  }
}
