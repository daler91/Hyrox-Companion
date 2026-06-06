import {
  type ExerciseSet,
  exerciseSets,
  type InsertExerciseSet,
  type InsertWorkoutLog,
  planDays,
  type StructureBlockInput,
  trainingPlans,
  type UpdateWorkoutLog,
  type WorkoutLog,
  workoutLogs,
  workoutStructureBlocks,
  workoutStructureSteps,
} from "@shared/schema";
import { and, asc, desc, eq, inArray,isNotNull, isNull, or, sql } from "drizzle-orm";

import { db } from "../db";
import { AppError, ErrorCode } from "../errors";
import { syncPlanDayStatusFromWorkouts } from "./planDayStatus";
import { prescribedSetToLogRow, queryExerciseSetsWithDates } from "./shared";

type WorkoutStructureBlockRow = typeof workoutStructureBlocks.$inferSelect;
type WorkoutStructureStepRow = typeof workoutStructureSteps.$inferSelect;

function stepTargets(step: WorkoutStructureStepRow): NonNullable<StructureBlockInput["steps"][number]["targets"]> | null {
  const targets: Record<string, unknown> =
    step.targets && typeof step.targets === "object" && !Array.isArray(step.targets)
      ? { ...(step.targets as Record<string, unknown>) }
      : {};
  if (step.targetReps != null) targets.targetReps = step.targetReps;
  if (step.targetTime != null) targets.targetTime = step.targetTime;
  if (step.targetDistance != null) targets.targetDistance = step.targetDistance;
  if (step.targetWeight != null) targets.targetWeight = step.targetWeight;
  return Object.keys(targets).length > 0
    ? (targets)
    : null;
}

function mapStructureBlockRows(
  blocks: WorkoutStructureBlockRow[],
  stepsByBlock: Map<string, WorkoutStructureStepRow[]>,
): StructureBlockInput[] {
  return blocks.map((block) => ({
    id: block.id,
    sectionType: block.sectionType as StructureBlockInput["sectionType"],
    formatType: block.formatType as StructureBlockInput["formatType"],
    durationSeconds: block.durationSeconds,
    rounds: block.rounds,
    workSeconds: block.workSeconds,
    restSeconds: block.restSeconds,
    durationMinutes: block.durationMinutes,
    roundCount: block.roundCount,
    timeCapMinutes: block.timeCapMinutes,
    workIntervalSec: block.workIntervalSec,
    restIntervalSec: block.restIntervalSec,
    instructions: block.instructions,
    score: block.score as StructureBlockInput["score"],
    sequenceOrder: block.sequenceOrder,
    sortOrder: block.sortOrder,
    steps: (stepsByBlock.get(block.id) ?? []).map((step) => ({
      stepNumber: step.stepNumber,
      minuteIndex: step.minuteIndex,
      stepType: step.stepType as StructureBlockInput["steps"][number]["stepType"],
      exerciseName: step.exerciseName,
      category: step.category,
      customLabel: step.customLabel,
      stepRole: step.stepRole,
      intensity: step.intensity as StructureBlockInput["steps"][number]["intensity"],
      loadMode: step.loadMode,
      unilateralMode: step.unilateralMode,
      tempo: step.tempo as StructureBlockInput["steps"][number]["tempo"],
      constraintTags: step.constraintTags as StructureBlockInput["steps"][number]["constraintTags"],
      groupId: step.groupId,
      groupMeta: step.groupMeta as StructureBlockInput["steps"][number]["groupMeta"],
      targets: stepTargets(step),
    })),
  }));
}

function setTargetsForStructureMirror(row: ExerciseSet): Record<string, unknown> | null {
  const targets: Record<string, unknown> = {};
  const reps = row.plannedReps ?? row.reps;
  const weight = row.plannedWeight ?? row.weight;
  const distance = row.plannedDistance ?? row.distance;
  const time = row.plannedTime ?? row.time;
  if (reps != null) targets.targetReps = reps;
  if (weight != null) targets.targetWeight = weight;
  if (distance != null) targets.targetDistance = distance;
  if (time != null) targets.targetTime = time;
  return Object.keys(targets).length > 0 ? targets : null;
}

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

type MutationOwnerContext =
  | { kind: "workout"; id: string; userId: string }
  | { kind: "planDay"; id: string; userId: string };

type NormalizedSetCreateInput = Omit<InsertExerciseSet, "id" | "workoutLogId" | "planDayId" | "sortOrder">;

/**
 * Update payload accepted by updateExerciseSetNormalized. `version` is
 * explicitly excluded because storage manages it (always bumps by one on
 * every UPDATE). `expectedVersion` is a pseudo-field consumed by storage to
 * gate the WHERE clause for optimistic-concurrency control (W18); it is
 * extracted from the object before the SET clause is built.
 */
type NormalizedSetUpdateInput = Partial<Omit<InsertExerciseSet, "id" | "workoutLogId" | "planDayId" | "version">> & {
  readonly expectedVersion?: number;
};

type MutationOwnerAdapter = {
  getContainerId: (set: ExerciseSet) => string | null;
  ownsContainer: (containerId: string, userId: string) => Promise<boolean>;
  buildInsertValues: (
    containerId: string,
    set: NormalizedSetCreateInput,
    sortOrder: number,
  ) => InsertExerciseSet;
  scopeWhere: (containerId: string) => ReturnType<typeof eq>;
};


export class WorkoutStorage {
  private async loadStepsForBlocks(blockIds: string[]): Promise<Map<string, WorkoutStructureStepRow[]>> {
    if (blockIds.length === 0) return new Map();
    const steps = await db
      .select()
      .from(workoutStructureSteps)
      .where(inArray(workoutStructureSteps.blockId, blockIds))
      .orderBy(asc(workoutStructureSteps.stepNumber));
    const stepsByBlock = new Map<string, WorkoutStructureStepRow[]>();
    for (const step of steps) {
      const arr = stepsByBlock.get(step.blockId) ?? [];
      arr.push(step);
      stepsByBlock.set(step.blockId, arr);
    }
    return stepsByBlock;
  }

  private async loadWorkoutStructure(whereClause: ReturnType<typeof eq>): Promise<StructureBlockInput[]> {
    const blocks = await db
      .select()
      .from(workoutStructureBlocks)
      .where(whereClause)
      .orderBy(asc(workoutStructureBlocks.sortOrder));
    if (blocks.length === 0) return [];
    return mapStructureBlockRows(blocks, await this.loadStepsForBlocks(blocks.map((b) => b.id)));
  }

  private async groupWorkoutStructuresByOwner(
    blocks: WorkoutStructureBlockRow[],
    getOwnerId: (block: WorkoutStructureBlockRow) => string | null,
  ): Promise<Map<string, StructureBlockInput[]>> {
    if (blocks.length === 0) return new Map();
    const stepsByBlock = await this.loadStepsForBlocks(blocks.map((b) => b.id));
    const blocksByOwner = new Map<string, WorkoutStructureBlockRow[]>();
    for (const block of blocks) {
      const ownerId = getOwnerId(block);
      if (!ownerId) continue;
      const ownerBlocks = blocksByOwner.get(ownerId) ?? [];
      ownerBlocks.push(block);
      blocksByOwner.set(ownerId, ownerBlocks);
    }
    const result = new Map<string, StructureBlockInput[]>();
    for (const [ownerId, ownerBlocks] of blocksByOwner.entries()) {
      result.set(ownerId, mapStructureBlockRows(ownerBlocks, stepsByBlock));
    }
    return result;
  }

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

  async getWorkoutStructureByWorkoutLog(workoutLogId: string) {
    return this.loadWorkoutStructure(eq(workoutStructureBlocks.workoutLogId, workoutLogId));
  }

  async getWorkoutStructureByPlanDay(planDayId: string, userId: string) {
    const owns = await this.ownsPlanDay(planDayId, userId);
    if (!owns) return null;
    return this.loadWorkoutStructure(eq(workoutStructureBlocks.planDayId, planDayId));
  }

  async getWorkoutStructuresByWorkoutLogs(workoutLogIds: string[]): Promise<Map<string, StructureBlockInput[]>> {
    if (workoutLogIds.length === 0) return new Map();
    const blocks = await db
      .select()
      .from(workoutStructureBlocks)
      .where(inArray(workoutStructureBlocks.workoutLogId, workoutLogIds))
      .orderBy(asc(workoutStructureBlocks.workoutLogId), asc(workoutStructureBlocks.sortOrder));
    return this.groupWorkoutStructuresByOwner(blocks, (block) => block.workoutLogId);
  }

  async getWorkoutStructuresByPlanDays(planDayIds: string[]): Promise<Map<string, StructureBlockInput[]>> {
    if (planDayIds.length === 0) return new Map();
    const blocks = await db
      .select()
      .from(workoutStructureBlocks)
      .where(inArray(workoutStructureBlocks.planDayId, planDayIds))
      .orderBy(asc(workoutStructureBlocks.planDayId), asc(workoutStructureBlocks.sortOrder));
    return this.groupWorkoutStructuresByOwner(blocks, (block) => block.planDayId);
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

  private getMutationOwnerAdapter(context: MutationOwnerContext): MutationOwnerAdapter {
    if (context.kind === "workout") {
      return {
        getContainerId: (set) => set.workoutLogId,
        ownsContainer: (containerId, userId) => this.getWorkoutLog(containerId, userId).then(Boolean),
        buildInsertValues: (containerId, set, sortOrder) => ({
          ...set,
          workoutLogId: containerId,
          planDayId: null,
          sortOrder,
        }),
        scopeWhere: (containerId) => eq(exerciseSets.workoutLogId, containerId),
      };
    }

    return {
      getContainerId: (set) => set.planDayId,
      ownsContainer: (containerId, userId) => this.ownsPlanDay(containerId, userId),
      buildInsertValues: (containerId, set, sortOrder) => ({
        ...set,
        planDayId: containerId,
        workoutLogId: null,
        sortOrder,
      }),
      scopeWhere: (containerId) => eq(exerciseSets.planDayId, containerId),
    };
  }

  async addExerciseSetNormalized(
    context: MutationOwnerContext,
    set: NormalizedSetCreateInput,
    adapter: MutationOwnerAdapter = this.getMutationOwnerAdapter(context),
  ): Promise<ExerciseSet | undefined> {
    // W10: after the ownership check, fold the next-sort-order lookup into the
    // INSERT as a correlated subquery. That drops the separate MAX round-trip
    // (one ownership read + one INSERT instead of three queries) and computes
    // sortOrder atomically at insert time rather than read-then-write.
    const owns = await adapter.ownsContainer(context.id, context.userId);
    if (!owns) return undefined;
    const baseValues = adapter.buildInsertValues(context.id, set, 0);
    const [created] = await db
      .insert(exerciseSets)
      .values({
        ...baseValues,
        sortOrder: sql<number>`(select coalesce(max(${exerciseSets.sortOrder}), -1) + 1 from ${exerciseSets} where ${adapter.scopeWhere(context.id)})`,
      })
      .returning();
    if (created) await this.syncStructureStepMirror(created);
    return created;
  }

  async updateExerciseSetNormalized(
    context: MutationOwnerContext,
    setId: string,
    updates: NormalizedSetUpdateInput,
    adapter: MutationOwnerAdapter = this.getMutationOwnerAdapter(context),
  ): Promise<ExerciseSet | undefined> {
    const owned = await this.getExerciseSetOwned(setId, context.userId);
    if (!owned || adapter.getContainerId(owned) !== context.id) return undefined;

    // Optimistic concurrency control (W18). When the caller supplies
    // `expectedVersion`, gate the UPDATE on it so a concurrent writer that
    // already bumped the row produces a no-match instead of silently
    // overwriting. Always bump `version` on success so the next read sees
    // the new value and any client holding the stale version trips the
    // check on its next write.
    const { expectedVersion, ...setData } = updates;
    const conditions = [eq(exerciseSets.id, setId)];
    if (expectedVersion !== undefined) {
      conditions.push(eq(exerciseSets.version, expectedVersion));
    }
    const [updated] = await db
      .update(exerciseSets)
      .set({ ...setData, version: sql`${exerciseSets.version} + 1` })
      .where(conditions.length === 1 ? conditions[0] : and(...conditions))
      .returning();

    if (!updated && expectedVersion !== undefined) {
      // Row exists (owned check passed above) but the version condition
      // didn't match → another writer bumped it. Surface the current
      // version in the error details so the client can refresh + retry.
      throw new AppError(
        ErrorCode.CONFLICT,
        "Exercise set was modified by another request",
        409,
        { currentVersion: owned.version, expectedVersion },
      );
    }

    if (updated) await this.syncStructureStepMirror(updated);
    return updated;
  }

  private async syncStructureStepMirror(row: ExerciseSet): Promise<void> {
    if (!row.blockId || row.stepNumber == null) return;
    let ownerCondition = null;
    if (row.workoutLogId) {
      ownerCondition = eq(workoutStructureBlocks.workoutLogId, row.workoutLogId);
    } else if (row.planDayId) {
      ownerCondition = eq(workoutStructureBlocks.planDayId, row.planDayId);
    }
    if (!ownerCondition) return;
    const [block] = await db
      .select({ id: workoutStructureBlocks.id })
      .from(workoutStructureBlocks)
      .where(and(eq(workoutStructureBlocks.id, row.blockId), ownerCondition))
      .limit(1);
    if (!block) return;
    await db
      .update(workoutStructureSteps)
      .set({
        exerciseName: row.exerciseName,
        category: row.category,
        customLabel: row.customLabel,
        targetReps: row.plannedReps ?? row.reps,
        targetWeight: row.plannedWeight ?? row.weight,
        targetDistance: row.plannedDistance ?? row.distance,
        targetTime: row.plannedTime ?? row.time,
        stepRole: row.stepRole ?? "work",
        groupId: row.groupId,
        targets: setTargetsForStructureMirror(row),
      })
      .where(and(
        eq(workoutStructureSteps.blockId, row.blockId),
        eq(workoutStructureSteps.stepNumber, row.stepNumber),
      ));
  }

  async deleteExerciseSetNormalized(
    context: MutationOwnerContext,
    setId: string,
    adapter: MutationOwnerAdapter = this.getMutationOwnerAdapter(context),
  ): Promise<boolean> {
    const owned = await this.getExerciseSetOwned(setId, context.userId);
    if (!owned) return true;
    if (adapter.getContainerId(owned) !== context.id) return false;
    await db.delete(exerciseSets).where(eq(exerciseSets.id, setId));
    return true;
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


  async mutateExerciseSetUpdate(owner: { kind: "workoutLog" | "planDay"; ownerId: string }, setId: string, updates: NormalizedSetUpdateInput, userId: string): Promise<ExerciseSet | undefined> {
    return this.updateExerciseSetNormalized({ kind: owner.kind === "workoutLog" ? "workout" : "planDay", id: owner.ownerId, userId }, setId, updates);
  }

  async mutateExerciseSetAdd(owner: { kind: "workoutLog" | "planDay"; ownerId: string }, set: NormalizedSetCreateInput, userId: string): Promise<ExerciseSet | undefined> {
    return this.addExerciseSetNormalized({ kind: owner.kind === "workoutLog" ? "workout" : "planDay", id: owner.ownerId, userId }, set);
  }

  async mutateExerciseSetDelete(owner: { kind: "workoutLog" | "planDay"; ownerId: string }, setId: string, userId: string): Promise<boolean> {
    return this.deleteExerciseSetNormalized({ kind: owner.kind === "workoutLog" ? "workout" : "planDay", id: owner.ownerId, userId }, setId);
  }

  async updateExerciseSet(
    workoutLogId: string,
    setId: string,
    updates: NormalizedSetUpdateInput,
    userId: string,
  ): Promise<ExerciseSet | undefined> {
    return this.updateExerciseSetNormalized({ kind: "workout", id: workoutLogId, userId }, setId, updates);
  }

  async deleteExerciseSet(workoutLogId: string, setId: string, userId: string): Promise<boolean> {
    return this.deleteExerciseSetNormalized({ kind: "workout", id: workoutLogId, userId }, setId);
  }

  /**
   * Creates a new exercise set under a workoutLog the user owns. Used by the
   * "+Add" row in the structured exercises table. Auto-assigns sortOrder to
   * append at the end so the new row lands below existing sets.
   */
  async addExerciseSetToWorkoutLog(
    workoutLogId: string,
    set: NormalizedSetCreateInput,
    userId: string,
  ): Promise<ExerciseSet | undefined> {
    return this.addExerciseSetNormalized({ kind: "workout", id: workoutLogId, userId }, set);
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
    set: NormalizedSetCreateInput,
    userId: string,
  ): Promise<ExerciseSet | undefined> {
    return this.addExerciseSetNormalized({ kind: "planDay", id: planDayId, userId }, set);
  }

  async updateExerciseSetForPlanDay(
    planDayId: string,
    setId: string,
    updates: NormalizedSetUpdateInput,
    userId: string,
  ): Promise<ExerciseSet | undefined> {
    return this.updateExerciseSetNormalized({ kind: "planDay", id: planDayId, userId }, setId, updates);
  }

  async deleteExerciseSetForPlanDay(planDayId: string, setId: string, userId: string): Promise<boolean> {
    return this.deleteExerciseSetNormalized({ kind: "planDay", id: planDayId, userId }, setId);
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

      const [ownedPlanDay] = await tx
        .select({ id: planDays.id })
        .from(planDays)
        .innerJoin(trainingPlans, eq(planDays.planId, trainingPlans.id))
        .where(and(eq(planDays.id, log.planDayId), eq(trainingPlans.userId, userId)))
        .limit(1);
      if (!ownedPlanDay) return 0;

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

      const rows = prescribed.map((p) => prescribedSetToLogRow(p, workoutLogId));
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
