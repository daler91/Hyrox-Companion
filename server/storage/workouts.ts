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
import { normalizeExerciseName } from "@shared/schema/exercises";
import { restampSetPatch, type UnitPreferences } from "@shared/unitConversion";
import { and, asc, desc, eq, gte, inArray,isNotNull, isNull, ne, or, sql } from "drizzle-orm";

import { db, type DbExecutor } from "../db";
import { AppError, ErrorCode } from "../errors";
import { syncPlanDayStatusFromWorkouts } from "./planDayStatus";
import {
  prescribedSetToLogRow,
  queryExerciseSetsWithDates,
  structureTargetsFromExerciseSet,
} from "./shared";

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

// Count distinct exercises in a logged workout that BEAT the user's previous
// best weight for that exercise. "Conservative PR" — we only credit exercises
// that include a weighted set; running/time/distance PRs are not counted here.
// Extracted as a pure function so the storage method stays within Sonar's
// cognitive-complexity ceiling.
//
// `maxByExercise` must be the athlete's best EXCLUDING this workout. It used to
// include it, and the test was `>=`, so the comparison could not tell a new
// best from a tie: the set was measured against a maximum it was itself inside,
// and repeating last week's 120 kg was reported as a fresh PR (audit M12).
// `analyticsService.updateMaxWeight` has always used a strict `>`; these two PR
// paths disagreed.
export function countPrSets(
  workoutSets: Array<{ exerciseName: string; weight: number | null }>,
  maxByExercise: Map<string, number | null>,
): number {
  const counted = new Set<string>();
  let prs = 0;
  for (const s of workoutSets) {
    if (s.weight == null || counted.has(s.exerciseName)) continue;
    const previousBest = maxByExercise.get(s.exerciseName);
    // No prior best means this is the athlete's first weighted attempt at the
    // movement, which is a baseline rather than a record — unchanged from the
    // previous behaviour, where the `max != null` guard did the same job.
    if (previousBest != null && s.weight > previousBest) {
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
  /**
   * The units the patch's numbers are in (the athlete's current preference).
   * Like `expectedVersion`, a pseudo-field consumed by storage: it drives the
   * unit re-stamp of the axes the patch touches (restampSetPatch) and never
   * reaches the SET clause itself.
   */
  readonly unitPreferences?: UnitPreferences;
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

  /**
   * How many workout logs the athlete has, total. Half of the analytics
   * staleness anchor (audit L16) — the latest DATE cannot see a second session
   * logged on a day that already had one, nor a delete of anything but the
   * single latest row, and both change the history an analysis was built on.
   */
  async countWorkoutLogs(userId: string): Promise<number> {
    const [row] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(workoutLogs)
      .where(eq(workoutLogs.userId, userId));
    return row?.total ?? 0;
  }

  async getWorkoutLog(logId: string, userId: string): Promise<WorkoutLog | undefined> {
    const [log] = await db
      .select()
      .from(workoutLogs)
      .where(and(eq(workoutLogs.id, logId), eq(workoutLogs.userId, userId)));
    return log;
  }

  /** The user's most recent workout with a real start instant at/after `since`
   *  (refuel-reminder scan; rides idx_workout_logs_user_started_at). */
  async getLatestStartedWorkout(userId: string, since: Date): Promise<WorkoutLog | undefined> {
    const [log] = await db
      .select()
      .from(workoutLogs)
      .where(
        and(
          eq(workoutLogs.userId, userId),
          isNotNull(workoutLogs.startedAt),
          gte(workoutLogs.startedAt, since),
        ),
      )
      .orderBy(desc(workoutLogs.startedAt))
      .limit(1);
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

  /**
   * Every logged set of one exercise, newest session first.
   *
   * The name is resolved through `normalizeExerciseName` so "RDL" finds
   * `romanian_deadlift`; unresolvable names fall back to the raw string, which
   * preserves the exact-match behaviour CSV imports and custom labels rely on.
   *
   * `sessionLimit` bounds *distinct dates*, not rows.
   */
  async getExerciseHistory(userId: string, exerciseName: string, options?: { sessionLimit?: number }): Promise<(ExerciseSet & { date: string; timeOfDayMin?: number | null })[]> {
    const canonical = normalizeExerciseName(exerciseName) ?? exerciseName;
    const sessionLimit = options?.sessionLimit;
    if (!sessionLimit) {
      // Unbounded callers keep the existing relational scan.
      return queryExerciseSetsWithDates(userId, { exerciseName: canonical });
    }

    // ⚡ Bolt Performance Optimization: queryExerciseSetsWithDates applies the
    // exerciseName filter on the *nested* relation, so even a bounded call used
    // to fetch every workout_logs row the user owns (up to MAX_WORKOUT_LOGS_PER_QUERY
    // — 5000 rows) before takeMostRecentSessions() threw almost all of it away.
    // This is the hottest exercise-history path: opening a workout with N
    // distinct exercises fires N of these calls in a burst (see the rate-limit
    // comment on its route). Drive the query from an inner join instead:
    // first resolve just the `sessionLimit` most recent dates this exercise
    // was logged (idx_exercise_sets_exercise_name + idx_workout_logs_user_date),
    // then fetch only those sessions' sets (idx_exercise_sets_workout_sort).
    // Two small, indexed queries replace one that scanned the athlete's whole
    // training history — for a staple lift with years of logs, that's a few
    // rows fetched instead of thousands.
    const recentDates = await db
      .selectDistinct({ date: workoutLogs.date })
      .from(workoutLogs)
      .innerJoin(exerciseSets, eq(exerciseSets.workoutLogId, workoutLogs.id))
      .where(and(eq(workoutLogs.userId, userId), eq(exerciseSets.exerciseName, canonical)))
      .orderBy(desc(workoutLogs.date))
      .limit(sessionLimit);

    if (recentDates.length === 0) return [];

    const rows = await db
      .select({ set: exerciseSets, date: workoutLogs.date, timeOfDayMin: workoutLogs.timeOfDayMin })
      .from(exerciseSets)
      .innerJoin(workoutLogs, eq(exerciseSets.workoutLogId, workoutLogs.id))
      .where(
        and(
          eq(workoutLogs.userId, userId),
          eq(exerciseSets.exerciseName, canonical),
          inArray(workoutLogs.date, recentDates.map((r) => r.date)),
        ),
      )
      .orderBy(desc(workoutLogs.date), asc(exerciseSets.sortOrder));

    return rows.map((r) => ({ ...r.set, date: r.date, timeOfDayMin: r.timeOfDayMin }));
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
    // The set row and its structure-step mirror commit together: a sync
    // failure rolls the insert back rather than leaving a set whose step
    // still shows the previous prescription.
    return db.transaction(async (tx) => {
      const [created] = await tx
        .insert(exerciseSets)
        .values({
          ...baseValues,
          sortOrder: sql<number>`(select coalesce(max(${exerciseSets.sortOrder}), -1) + 1 from ${exerciseSets} where ${adapter.scopeWhere(context.id)})`,
        })
        .returning();
      if (created) await this.syncStructureStepMirror(created, tx);
      return created;
    });
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
    const { expectedVersion, unitPreferences, ...patch } = updates;
    // Unit stamp maintenance (audit L4): the patch's numbers are in the
    // athlete's current unit, so re-stamp the axes it touches and convert the
    // values on those axes it leaves alone. See restampSetPatch.
    const setData = unitPreferences ? restampSetPatch(owned, patch, unitPreferences) : patch;
    const conditions = [eq(exerciseSets.id, setId)];
    if (expectedVersion !== undefined) {
      conditions.push(eq(exerciseSets.version, expectedVersion));
    }
    // Same transaction as the mirror sync (see addExerciseSetNormalized).
    return db.transaction(async (tx) => {
      const [updated] = await tx
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

      if (updated) await this.syncStructureStepMirror(updated, tx);
      return updated;
    });
  }

  /**
   * Copies a set's prescription onto the structure step it was expanded from,
   * so the structured view and the flat set list never disagree. Runs on the
   * caller's executor so it commits (or rolls back) with the set write.
   */
  private async syncStructureStepMirror(row: ExerciseSet, executor: DbExecutor = db): Promise<void> {
    if (!row.blockId || row.stepNumber == null) return;
    let ownerCondition = null;
    if (row.workoutLogId) {
      ownerCondition = eq(workoutStructureBlocks.workoutLogId, row.workoutLogId);
    } else if (row.planDayId) {
      ownerCondition = eq(workoutStructureBlocks.planDayId, row.planDayId);
    }
    if (!ownerCondition) return;
    const [block] = await executor
      .select({ id: workoutStructureBlocks.id })
      .from(workoutStructureBlocks)
      .where(and(eq(workoutStructureBlocks.id, row.blockId), ownerCondition))
      .limit(1);
    if (!block) return;
    await executor
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
        targets: structureTargetsFromExerciseSet(row),
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
    await db.transaction(async (tx) => {
      await tx.delete(exerciseSets).where(eq(exerciseSets.id, setId));
      // Many sets can mirror one step (EMOM minutes, rounds). When the deleted
      // set was the one most recently copied onto the step, the step would
      // keep a prescription no surviving set carries — re-sync it from the
      // lowest-ordered sibling still on that step. If none survive, the step
      // stays as the structure's own record of what was prescribed.
      if (!owned.blockId || owned.stepNumber == null) return;
      const [sibling] = await tx
        .select()
        .from(exerciseSets)
        .where(and(
          adapter.scopeWhere(context.id),
          eq(exerciseSets.blockId, owned.blockId),
          eq(exerciseSets.stepNumber, owned.stepNumber),
        ))
        .orderBy(asc(exerciseSets.sortOrder))
        .limit(1);
      if (sibling) await this.syncStructureStepMirror(sibling, tx);
    });
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

  // ⚡ Bolt Performance Optimization: batched sibling of getExerciseSetsByPlanDay(),
  // for callers enriching several plan days in one pass (e.g. an AI plan-adjustment
  // proposal touching a handful of upcoming sessions). One inner join across
  // exercise_sets -> plan_days -> training_plans (all on indexed FK columns)
  // replaces one ownsPlanDay() + one select per day, dropping 2N sequential
  // round trips to 1. Keyed by planDayId so callers can look up each day's sets
  // in O(1) instead of filtering the combined result per day.
  async getExerciseSetsByPlanDays(planDayIds: string[], userId: string): Promise<Map<string, ExerciseSet[]>> {
    const byDay = new Map<string, ExerciseSet[]>();
    if (planDayIds.length === 0) return byDay;
    const rows = await db
      .select({ set: exerciseSets })
      .from(exerciseSets)
      .innerJoin(planDays, eq(exerciseSets.planDayId, planDays.id))
      .innerJoin(trainingPlans, eq(planDays.planId, trainingPlans.id))
      .where(and(inArray(exerciseSets.planDayId, planDayIds), eq(trainingPlans.userId, userId)))
      .orderBy(asc(exerciseSets.sortOrder));
    for (const { set } of rows) {
      const existing = byDay.get(set.planDayId as string);
      if (existing) existing.push(set);
      else byDay.set(set.planDayId as string, [set]);
    }
    return byDay;
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
          // Exclude the workout being scored from its own baseline (audit M12).
          ne(exerciseSets.workoutLogId, workoutLogId),
        ),
      )
      .groupBy(exerciseSets.exerciseName);
    const maxByExercise = new Map(userMaxes.map((m) => [m.exerciseName, m.maxWeight]));

    return countPrSets(thisWorkoutSets, maxByExercise);
  }

  /**
   * Average RPE across the 4-week block LEADING UP TO this workout.
   *
   * The window used to run `currentDate - 14 days` to `currentDate + 14 days`,
   * which was two separate problems (audit L12). It spanned 29 days rather than
   * 28, and it averaged in sessions logged AFTER the workout being viewed — so
   * the figure attached to a given day kept changing as the athlete trained on,
   * and the same historical record showed a different number each time it was
   * opened. A trailing window is fixed the moment the workout is logged.
   *
   * NOTE: nothing in the client currently renders this. `useWorkoutDetail`
   * fetches `/history` and exposes it, but no component reads `blockAvgRpe`,
   * `prSetCount` or `lastSameFocus`. Fixed anyway so a future consumer does not
   * inherit a retroactive statistic.
   */
  private async fetchBlockAvgRpe(currentDate: string, userId: string): Promise<number | null> {
    const [rpe] = await db
      .select({ avg: sql<number | null>`avg(${workoutLogs.rpe})` })
      .from(workoutLogs)
      .where(
        and(
          eq(workoutLogs.userId, userId),
          isNotNull(workoutLogs.rpe),
          sql`${workoutLogs.date} > (${currentDate}::date - INTERVAL '28 days')`,
          sql`${workoutLogs.date} <= ${currentDate}`,
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
