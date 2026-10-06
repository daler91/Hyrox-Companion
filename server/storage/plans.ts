import { addDaysToISODate, planWeekOneMonday } from "@shared/dateUtils";
import { inSequence } from "@shared/inSequence";
import { isRestLikePlanDay } from "@shared/planDayKind";
import {
  type ExerciseSet,
  exerciseSets,
  type InsertPlanDay,
  type InsertTrainingPlan,
  type PlanDay,
  planDays,
  type PlanEngineState,
  type TrainingPlan,
  trainingPlans,
  type TrainingPlanWithDays,
  type UpdatePlanDay,
  users,
  workoutLogs,
} from "@shared/schema";
import { and, asc, eq, gte, inArray, isNotNull, isNull, lt, lte, ne, notExists, sql } from "drizzle-orm";

import { db, type DbExecutor, type Tx } from "../db";
import { logger } from "../logger";
import { getLocalDateStrSafe } from "../timezone";
import { noAbsenceDeclaredForPlanDay } from "./absenceGuard";
import { syncPlanDayStatusFromWorkouts } from "./planDayStatus";
import { missedSweepRetirementGuard, planDayWithinPlanLifetime, planLiveForDate } from "./planRetirement";
import { planSlotForMove } from "./planSlot";
import { capturePlanDays, captureTrainingPlan } from "./recycleBinCapture";

/** `recovery` with a let-go dropped and a fold or shorten kept, for the missed-day sweep. */
const STALE_LET_GO_CLEARED = sql<string | null>`CASE WHEN ${planDays.recovery} = 'let_go' THEN NULL ELSE ${planDays.recovery} END`;

// A day the athlete already acted on (completed, skipped, or with a logged
// workout) keeps its date wherever it falls, so their history stays visible.
function isActedOn(day: PlanDay, loggedDayIds: ReadonlySet<string>): boolean {
  return day.status === "completed" || day.status === "skipped" || loggedDayIds.has(day.id);
}

// Only reset status when the day actually moves to a new date. Without
// this guard, calling schedulePlan with the same startDate (or any
// reschedule that happens to leave a specific day on its existing
// calendar slot) would silently revert that day's explicit "skipped"
// choice back to "planned". We reset both "missed" (system-assigned)
// and "skipped" (user choice) because a genuine date change semantically
// gives the day a fresh planned status (S18).
function needsStatusReset(day: PlanDay, dateStr: string, today: string): boolean {
  const dateChanged = dateStr !== day.scheduledDate;
  return dateChanged && (day.status === "missed" || day.status === "skipped") && dateStr >= today;
}

// The plan's lowest week number (a missing week counts as week 1). A single
// linear scan: no intermediate array, and no Math.min spread that can exceed
// the call-stack limit on a very long plan.
function lowestWeekNumber(days: readonly PlanDay[]): number {
  let minWeek = Infinity;
  for (const day of days) {
    minWeek = Math.min(minWeek, day.weekNumber || 1);
  }
  return minWeek;
}

/**
 * The days a reschedule re-dates (or takes off the calendar) that still carry
 * a fold or shorten's undo. That undo puts the session back on the absolute
 * date it was missed on, with its missed status, and the undo window runs
 * from that date: after the plan moves, the date belongs to the old schedule
 * (possibly before the new start), and moved by the plan's shift instead it
 * would bring back a "missed" session on a day that has not happened yet. A
 * re-dated day starts afresh, as needsStatusReset already treats it, so the
 * undo is dropped — C42 (CODEBASE_ANALYSIS_2026-10-03). A day that keeps its
 * date keeps its undo.
 */
function staleRecoveryUndoIds(
  days: readonly PlanDay[],
  nextDates: ReadonlyMap<string, string | null>,
): string[] {
  return days
    .filter((day) => day.recoveryUndo != null && nextDates.get(day.id) !== day.scheduledDate)
    .map((day) => day.id);
}

/** Drops the fold/shorten undo on `dayIds` (see staleRecoveryUndoIds). */
async function clearRecoveryUndo(executor: DbExecutor, dayIds: readonly string[]): Promise<void> {
  if (dayIds.length === 0) return;
  await executor.update(planDays).set({ recoveryUndo: null }).where(inArray(planDays.id, [...dayIds]));
}

/** The state a recovery was planned against, re-checked under the row lock. */
export interface PlanDayRecoveryGuard {
  readonly statuses: readonly string[];
  readonly scheduledDate: string | null;
  readonly recovery: string | null;
}

/** A prescribed set made smaller by shortening. Only the changed fields are present. */
export interface PlanDayRecoverySetUpdate {
  readonly id: string;
  readonly reps?: number;
  readonly plannedReps?: number;
  readonly distance?: number;
  readonly plannedDistance?: number;
  readonly time?: number;
  readonly plannedTime?: number;
}

export interface PlanDayRecoveryWrite {
  readonly guard: PlanDayRecoveryGuard;
  readonly update: Pick<
    UpdatePlanDay,
    "scheduledDate" | "status" | "recovery" | "missedOn" | "skipReason" | "expectedDurationMin" | "notes" | "recoveryUndo"
  >;
  readonly deleteSetIds?: readonly string[];
  readonly setUpdates?: readonly PlanDayRecoverySetUpdate[];
  /** Sets to put back, whole rows with their ids (undoing a shorten). */
  readonly insertSets?: readonly ExerciseSet[];
}

export type PlanDayRecoveryOutcome =
  | { readonly outcome: "applied"; readonly day: PlanDay }
  | { readonly outcome: "not_found" }
  | { readonly outcome: "conflict" };

/** The ids among `dayIds` that a workout log is linked to. */
async function getPlanDayIdsWithWorkouts(
  dayIds: readonly string[],
  executor: DbExecutor = db,
): Promise<Set<string>> {
  if (dayIds.length === 0) return new Set();
  const rows = await executor
    .selectDistinct({ planDayId: workoutLogs.planDayId })
    .from(workoutLogs)
    .where(inArray(workoutLogs.planDayId, [...dayIds]));
  return new Set(rows.flatMap((row) => (row.planDayId ? [row.planDayId] : [])));
}

/**
 * Mark missed the past planned days of every athlete whose stored timezone is
 * `tz`, judged against `today`, that zone's local date. The local date is
 * computed in JS rather than with `AT TIME ZONE u.user_timezone`: that form
 * raises `invalid value for parameter TimeZone` on a single unrecognised name
 * and would abort the sweep for every other athlete with it.
 */
async function sweepMissedPlanDaysInZone(tz: string, today: string): Promise<number> {
  const zonePlanIds = db
    .select({ id: trainingPlans.id })
    .from(trainingPlans)
    .innerJoin(users, eq(users.id, trainingPlans.userId))
    .where(eq(users.userTimezone, tz));

  const result = await db
    .update(planDays)
    // A let-go left behind on a planned day (logged, then the log deleted)
    // is not a decision about this miss, so the sweep clears it rather
    // than let the day arrive already "let go". A fold or shorten stays:
    // it is where the session came from, and the recovery sheet reads it
    // to stop chasing a session that has already been moved once.
    .set({ status: "missed", recovery: STALE_LET_GO_CLEARED })
    .where(
      and(
        eq(planDays.status, "planned"),
        lt(planDays.scheduledDate, today),
        inArray(planDays.planId, zonePlanIds),
        // Days from a retired plan's cutoff onward are training the athlete
        // deliberately walked away from — writing `missed` across them is the
        // app telling them they failed at something they already decided not
        // to do, and because `missed → planned` is FORBIDDEN (see enums.ts)
        // the damage would be permanent. Same reasoning as the declared-absence
        // guard below. Both guards are built in planRetirement.ts /
        // absenceGuard.ts so the SQL-rendering test asserts these exact
        // predicates instead of copies of them.
        missedSweepRetirementGuard(db),
        noAbsenceDeclaredForPlanDay(db),
      ),
    )
    .returning({ id: planDays.id });
  return result.length;
}

/** The athlete's plan days, and each one's prescribed sets, as locked rows. */
export interface LockedPlanDays {
  readonly days: PlanDay[];
  readonly setsByDay: Map<string, ExerciseSet[]>;
}

/**
 * The athlete's plan days among `dayIds`, with their prescribed sets, locked
 * (FOR UPDATE) for the rest of `tx`, so a write worked out from an earlier
 * read can check them again before it writes. Days by id, then their sets
 * by id: the order lockAutoCoachWriteTargets takes them in, so the two
 * never deadlock on each other.
 */
async function lockPlanDaysWithSets(
  dayIds: readonly string[],
  userId: string,
  tx: Tx,
): Promise<LockedPlanDays> {
  const setsByDay = new Map<string, ExerciseSet[]>();
  if (dayIds.length === 0) return { days: [], setsByDay };
  const rows = await tx
    .select({ day: planDays })
    .from(planDays)
    .innerJoin(trainingPlans, eq(planDays.planId, trainingPlans.id))
    .where(and(inArray(planDays.id, [...dayIds]), eq(trainingPlans.userId, userId)))
    .orderBy(asc(planDays.id))
    .for("update", { of: planDays });
  const days = rows.map((row) => row.day);
  if (days.length === 0) return { days, setsByDay };
  const sets = await tx
    .select()
    .from(exerciseSets)
    .where(inArray(exerciseSets.planDayId, days.map((day) => day.id)))
    .orderBy(asc(exerciseSets.id))
    .for("update");
  for (const set of sets) {
    if (!set.planDayId) continue;
    const list = setsByDay.get(set.planDayId) ?? [];
    list.push(set);
    setsByDay.set(set.planDayId, list);
  }
  return { days, setsByDay };
}

export class PlanStorage {
  /**
   * Each timezone's local date when this instance last swept it for missed
   * days (markMissedPlanDays). PF16 (CODEBASE_ANALYSIS_2026-10-03)
   */
  private readonly sweptZoneDates = new Map<string, string>();

  async createTrainingPlan(plan: InsertTrainingPlan, tx?: DbExecutor): Promise<TrainingPlan> {
    const executor = tx ?? db;
    const [trainingPlan] = await executor.insert(trainingPlans).values(plan).returning();
    return trainingPlan;
  }

  async updateGenerationStatus(
    planId: string,
    status: "pending" | "generating" | "ready" | "failed",
    generationError?: string | null,
    tx?: DbExecutor,
  ): Promise<void> {
    await (tx ?? db)
      .update(trainingPlans)
      .set({ generationStatus: status, generationError: generationError ?? null })
      .where(eq(trainingPlans.id, planId));
  }

  /**
   * True when the user already has a plan whose AI generation is in flight
   * (`pending` or `generating`). Used to reject duplicate `/plans/generate`
   * requests (W13) with a friendly 409 before any work happens. The airtight
   * half is the DB: `uq_training_plans_user_in_flight` (migration 0091) makes
   * a second concurrent INSERT fail with 23505, which the route maps to the
   * same 409 — so this check is a fast path, not the guarantee.
   */
  async hasInFlightPlanGeneration(userId: string): Promise<boolean> {
    const [row] = await db
      .select({ id: trainingPlans.id })
      .from(trainingPlans)
      .where(
        and(
          eq(trainingPlans.userId, userId),
          inArray(trainingPlans.generationStatus, ["pending", "generating"]),
        ),
      )
      .limit(1);
    return row !== undefined;
  }

  /**
   * Every plan the athlete owns, retired ones included — the plan selector needs
   * them to offer a restore, and the timeline needs them to render history. It is
   * the read paths that ask "what is the athlete training NOW?" that filter, not
   * this one.
   *
   * Ordered live-first then newest-first. Previously unordered, so the selector
   * listed plans in whatever order Postgres happened to return them.
   */
  async listTrainingPlans(userId: string): Promise<TrainingPlan[]> {
    return await db
      .select()
      .from(trainingPlans)
      .where(eq(trainingPlans.userId, userId))
      .orderBy(
        sql`CASE WHEN ${trainingPlans.retiredOn} IS NULL THEN 0 ELSE 1 END`,
        sql`${trainingPlans.startDate} DESC NULLS LAST`,
      );
  }

  readonly getTrainingPlan = getTrainingPlan;

  async renameTrainingPlan(
    planId: string,
    name: string,
    userId: string,
  ): Promise<TrainingPlan | undefined> {
    const [updated] = await db
      .update(trainingPlans)
      .set({ name })
      .where(and(eq(trainingPlans.id, planId), eq(trainingPlans.userId, userId)))
      .returning();
    return updated;
  }

  /** Record the workout engine's memory of a plan (see workoutEngine/adaptation.ts). */
  async updateEngineState(
    planId: string,
    userId: string,
    engineState: PlanEngineState,
    tx?: DbExecutor,
  ): Promise<void> {
    const executor = tx ?? db;
    await executor
      .update(trainingPlans)
      .set({ engineState })
      .where(and(eq(trainingPlans.id, planId), eq(trainingPlans.userId, userId)));
  }

  async updateTrainingPlanGoal(
    planId: string,
    goal: string | null,
    userId: string,
  ): Promise<TrainingPlan | undefined> {
    const [updated] = await db
      .update(trainingPlans)
      .set({ goal })
      .where(and(eq(trainingPlans.id, planId), eq(trainingPlans.userId, userId)))
      .returning();
    return updated;
  }

  /**
   * Archive a plan effective `retiredOn`, or restore it with `null`.
   *
   * The caller is responsible for clamping the date — see the route, which pins
   * it to the athlete's own today so a back-dated retirement can't strand days
   * the sweep already flipped to `missed`: those would keep rendering red on the
   * timeline while the adherence denominator quietly ignored them, and
   * `missed → planned` is forbidden, so there would be no way back.
   */
  async setPlanRetirement(
    planId: string,
    retiredOn: string | null,
    userId: string,
  ): Promise<TrainingPlan | undefined> {
    const [updated] = await db
      .update(trainingPlans)
      .set({ retiredOn })
      .where(and(eq(trainingPlans.id, planId), eq(trainingPlans.userId, userId)))
      .returning();
    return updated;
  }

  /**
   * Retire several plans at once, for the supersede-on-generate flow.
   *
   * `retired_on IS NULL` in the WHERE makes this idempotent and stops it stomping
   * an EARLIER manual retirement with a later date — that would resurrect days the
   * athlete had already written off. Ownership is re-checked in SQL rather than
   * trusted from the caller because the plan ids arrive on a durable queue payload
   * that was validated at the route, possibly by a previous deploy.
   */
  async retirePlans(
    planIds: readonly string[],
    userId: string,
    retiredOn: string,
    tx?: DbExecutor,
  ): Promise<string[]> {
    if (planIds.length === 0) return [];
    const updated = await (tx ?? db)
      .update(trainingPlans)
      .set({ retiredOn })
      .where(
        and(
          inArray(trainingPlans.id, [...planIds]),
          eq(trainingPlans.userId, userId),
          isNull(trainingPlans.retiredOn),
        ),
      )
      .returning({ id: trainingPlans.id });
    return updated.map((row) => row.id);
  }

  /**
   * Live plans whose scheduled window intersects [start, end], excluding one plan
   * by id. Used to refuse a restore that would put two live plans over the same
   * days — the exact state the lifecycle column exists to prevent, which restoring
   * would otherwise recreate by construction.
   */
  async findOverlappingActivePlans(
    userId: string,
    start: string,
    end: string,
    excludePlanId?: string,
  ): Promise<TrainingPlan[]> {
    return await db
      .select()
      .from(trainingPlans)
      .where(
        and(
          eq(trainingPlans.userId, userId),
          isNull(trainingPlans.retiredOn),
          isNotNull(trainingPlans.startDate),
          isNotNull(trainingPlans.endDate),
          lte(trainingPlans.startDate, end),
          gte(trainingPlans.endDate, start),
          ...(excludePlanId ? [ne(trainingPlans.id, excludePlanId)] : []),
        ),
      );
  }

  /**
   * Deletes a plan and every day on it. The whole graph (plan, days, their
   * prescribed sets and structure, and which workout logs pointed at them) is
   * snapshotted into the recycle bin first, in the same transaction, so the
   * delete can be undone. Returns the bin item id, or null when the plan is
   * not the user's.
   */
  async deleteTrainingPlan(planId: string, userId: string): Promise<{ recycleBinItemId: string } | null> {
    return await db.transaction(async (tx) => {
      const recycleBinItemId = await captureTrainingPlan(tx, userId, planId);
      if (!recycleBinItemId) return null;

      await tx.delete(planDays).where(eq(planDays.planId, planId));
      const result = await tx.delete(trainingPlans).where(eq(trainingPlans.id, planId));
      return result.rowCount !== null && result.rowCount > 0 ? { recycleBinItemId } : null;
    });
  }

  async createPlanDays(days: InsertPlanDay[], tx?: DbExecutor): Promise<PlanDay[]> {
    if (days.length === 0) return [];
    const executor = tx ?? db;
    return await executor.insert(planDays).values(days).returning();
  }

  readonly getPlanWeeklyDensity = getPlanWeeklyDensity;

  /** Class-method wrapper for the standalone syncPlanDayStatusFromWorkouts (S6). */
  syncPlanDayStatusFromWorkouts(planDayId: string, userId: string, tx?: DbExecutor): Promise<void> {
    return syncPlanDayStatusFromWorkouts(planDayId, userId, tx);
  }

  async updatePlanDay(
    dayId: string,
    updates: UpdatePlanDay,
    userId: string,
    tx?: DbExecutor,
  ): Promise<PlanDay | undefined> {
    const executor = tx ?? db;
    const day = await this.getPlanDay(dayId, userId, executor);
    if (!day) return undefined;

    // A new date carries its week and weekday with it (planSlotForMove).
    const slot = await planSlotForMove(executor, day.planId, updates.scheduledDate);
    const [updatedDay] = await executor
      .update(planDays)
      .set({ ...updates, ...slot })
      .where(eq(planDays.id, dayId))
      .returning();
    return updatedDay;
  }

  /**
   * The plan's still-planned days from `fromDate` on, soonest first, with their
   * prescribed sets — what the workout engine adapts after a logged session.
   */
  async getPlanDaysForAdaptation(
    planId: string,
    fromDate: string,
  ): Promise<Array<PlanDay & { sets: ExerciseSet[] }>> {
    const days = await db
      .select()
      .from(planDays)
      .where(
        and(
          eq(planDays.planId, planId),
          eq(planDays.status, "planned"),
          isNotNull(planDays.scheduledDate),
          gte(planDays.scheduledDate, fromDate),
        ),
      )
      .orderBy(asc(planDays.scheduledDate));
    if (days.length === 0) return [];
    const sets = await db
      .select()
      .from(exerciseSets)
      .where(
        inArray(
          exerciseSets.planDayId,
          days.map((day) => day.id),
        ),
      )
      .orderBy(asc(exerciseSets.sortOrder));
    const byDay = new Map<string, ExerciseSet[]>();
    for (const set of sets) {
      if (!set.planDayId) continue;
      const list = byDay.get(set.planDayId) ?? [];
      list.push(set);
      byDay.set(set.planDayId, list);
    }
    return days.map((day) => ({ ...day, sets: byDay.get(day.id) ?? [] }));
  }

  /**
   * Change prescribed sets of one plan day in place: loads the engine moved,
   * notes whose paces it moved. Scoped to the day, so a set id from anywhere
   * else is a no-op; the caller checks the day belongs to the athlete first.
   */
  async updatePlanDaySets(
    planDayId: string,
    updates: ReadonlyArray<{
      readonly setId: string;
      readonly weight?: number;
      readonly weightUnit?: string;
      readonly notes?: string;
    }>,
    tx?: DbExecutor,
  ): Promise<void> {
    const executor = tx ?? db;
    await inSequence(updates, async ({ setId, ...fields }) => {
      if (Object.keys(fields).length === 0) return;
      await executor
        .update(exerciseSets)
        .set({ ...fields, version: sql`${exerciseSets.version} + 1` })
        .where(and(eq(exerciseSets.id, setId), eq(exerciseSets.planDayId, planDayId)));
    });
  }

  /**
   * Write a missed-session recovery decision (services/missedRecovery): the
   * day's new date, status and recovery columns, plus — for a shortened
   * session — the prescribed sets it drops or scales down.
   *
   * One transaction, with the plan-day row locked and `guard` re-checked under
   * the lock: the decision was made against a preview, and a log, a sync or a
   * second tab landing in between (the day completed, already moved, let go)
   * must turn into a conflict rather than be overwritten. Set edits are scoped
   * to this day's own rows, so an id from anywhere else is a no-op.
   */
  async applyPlanDayRecovery(
    dayId: string,
    userId: string,
    write: PlanDayRecoveryWrite,
  ): Promise<PlanDayRecoveryOutcome> {
    return await db.transaction(async (tx): Promise<PlanDayRecoveryOutcome> => {
      const [current] = await tx
        .select({
          planId: planDays.planId,
          status: planDays.status,
          scheduledDate: planDays.scheduledDate,
          recovery: planDays.recovery,
        })
        .from(planDays)
        .innerJoin(trainingPlans, eq(planDays.planId, trainingPlans.id))
        .where(and(eq(planDays.id, dayId), eq(trainingPlans.userId, userId)))
        .for("update", { of: planDays });
      if (!current) return { outcome: "not_found" };

      const { guard } = write;
      const unchanged =
        guard.statuses.includes(current.status ?? "planned") &&
        (current.scheduledDate ?? null) === guard.scheduledDate &&
        (current.recovery ?? null) === guard.recovery;
      if (!unchanged) return { outcome: "conflict" };

      if (write.deleteSetIds && write.deleteSetIds.length > 0) {
        await tx
          .delete(exerciseSets)
          .where(and(eq(exerciseSets.planDayId, dayId), inArray(exerciseSets.id, [...write.deleteSetIds])));
      }
      await inSequence(write.setUpdates ?? [], async ({ id, ...fields }) => {
        if (Object.keys(fields).length === 0) return;
        await tx
          .update(exerciseSets)
          .set({ ...fields, version: sql`${exerciseSets.version} + 1` })
          .where(and(eq(exerciseSets.id, id), eq(exerciseSets.planDayId, dayId)));
      });
      if (write.insertSets && write.insertSets.length > 0) {
        await tx
          .insert(exerciseSets)
          .values(write.insertSets.map((set) => ({ ...set, planDayId: dayId, workoutLogId: null })))
          // Already back (restored twice): the row that is there stays.
          .onConflictDoNothing({ target: exerciseSets.id });
      }

      const slot = await planSlotForMove(tx, current.planId, write.update.scheduledDate);
      const [day] = await tx
        .update(planDays)
        .set({ ...write.update, ...slot })
        .where(eq(planDays.id, dayId))
        .returning();
      return day ? { outcome: "applied", day } : { outcome: "not_found" };
    });
  }

  async getPlanDay(
    dayId: string,
    userId: string,
    tx?: DbExecutor,
  ): Promise<PlanDay | undefined> {
    const executor = tx ?? db;
    // Uses the relational query API: fetch the plan day and filter via its
    // parent plan's owner in-memory. Equivalent to an inner join with an auth
    // guard on training_plans.user_id.
    const day = await executor.query.planDays.findFirst({
      where: eq(planDays.id, dayId),
      with: {
        plan: {
          columns: { userId: true },
        },
      },
    });
    if (!day || day.plan?.userId !== userId) return undefined;
    // Strip the joined relation before returning to preserve the original shape.
    const { plan: _plan, ...planDay } = day;
    return planDay;
  }

  // ⚡ Bolt Performance Optimization: batched sibling of getPlanDay(), for
  // callers that resolve several plan days at once (e.g. enrichProposedChanges
  // enriching every day an AI plan-adjustment proposal touches). A single
  // inner join against training_plans expresses ownership directly instead of
  // one getPlanDay() round trip per id, dropping N sequential reads to 1.
  async getPlanDaysByIds(dayIds: string[], userId: string): Promise<PlanDay[]> {
    if (dayIds.length === 0) return [];
    const rows = await db
      .select({ day: planDays })
      .from(planDays)
      .innerJoin(trainingPlans, eq(planDays.planId, trainingPlans.id))
      .where(and(inArray(planDays.id, dayIds), eq(trainingPlans.userId, userId)));
    return rows.map((r) => r.day);
  }

  // Uses no instance state, so it is a module function bound here:
  // storage.plans.lockPlanDaysWithSets() and its mocks still work.
  readonly lockPlanDaysWithSets = lockPlanDaysWithSets;

  /**
   * Deletes one plan day, snapshotting it (with its prescribed sets and the
   * logs that pointed at it) into the recycle bin first. The capture doubles
   * as the ownership check: it only finds days on the user's own plans.
   * Returns the bin item id, or null when the day is not theirs.
   */
  async deletePlanDay(dayId: string, userId: string): Promise<{ recycleBinItemId: string } | null> {
    return await db.transaction(async (tx) => {
      const captured = await capturePlanDays(tx, userId, [dayId]);
      const recycleBinItemId = captured.get(dayId);
      if (!recycleBinItemId) return null;

      const result = await tx.delete(planDays).where(eq(planDays.id, dayId));
      return result.rowCount !== null && result.rowCount > 0 ? { recycleBinItemId } : null;
    });
  }

  /**
   * Lays a plan's days onto the calendar. Week 1 is the Monday-anchored week
   * that contains `startDate`, so every day keeps its weekday, but no session
   * is placed before `startDate`: a day that would land earlier is left
   * unscheduled (null date, off the timeline) rather than back-dated. Starting
   * a plan on a Wednesday used to put its Monday and Tuesday sessions in the
   * past, where they read as missed before the athlete had done anything
   * (onboarding audit C3).
   *
   * A day the athlete has already acted on (completed, skipped, or with a
   * logged workout) always keeps a date. The timeline only reads scheduled
   * days, so unscheduling one would hide the athlete's own history.
   *
   * The plan's own start date stays week 1's Monday, which keeps week-number
   * math (computeCurrentWeek, the plan phase) aligned with the days'
   * weekNumber/dayName.
   */
  async schedulePlan(
    planId: string,
    startDate: string,
    userId: string,
    tx?: Tx,
  ): Promise<"scheduled" | "not_found" | "nothing_after_start"> {
    const plan = await this.getTrainingPlan(planId, userId, tx);
    if (!plan) return "not_found";

    const dayNameToOffset: Record<string, number> = {
      monday: 0,
      tuesday: 1,
      wednesday: 2,
      thursday: 3,
      friday: 4,
      saturday: 5,
      sunday: 6,
    };
    const normalizeDayName = (raw: string | null | undefined): string =>
      (raw ?? "").trim().toLowerCase();

    // Pure calendar math: the previous form parsed the ISO date as UTC midnight
    // and then walked it with local-time accessors (getDay/setDate), so the
    // whole schedule shifted by a day whenever the server process ran in a
    // non-UTC zone. addDaysToISODate never leaves date-only space.
    const weekOneMonday = planWeekOneMonday(startDate);

    if (plan.days.length === 0) return "scheduled";

    const minWeek = lowestWeekNumber(plan.days);

    // Whether a rescheduled day lands in the future is judged on the athlete's
    // calendar, like every other "today" in this class.
    const today = await resolveUserToday(userId, tx);
    const loggedDayIds = await getPlanDayIdsWithWorkouts(
      plan.days.map((day) => day.id),
      tx,
    );

    const dateUpdates: { id: string; scheduledDate: string; resetStatus: boolean }[] = [];
    const unscheduleIds: string[] = [];
    for (const day of plan.days) {
      const normalizedWeek = (day.weekNumber || 1) - minWeek + 1;
      const weekOffset = (normalizedWeek - 1) * 7;
      const normalized = normalizeDayName(day.dayName);
      const dayOffset = normalized in dayNameToOffset ? dayNameToOffset[normalized] : 0;
      if (!(normalized in dayNameToOffset)) {
        logger.warn(
          { dayId: day.id, rawDayName: day.dayName, planId },
          "Unrecognized plan-day dayName; scheduling as Monday",
        );
      }
      const dateStr = addDaysToISODate(weekOneMonday, weekOffset + dayOffset);
      if (dateStr < startDate && !isActedOn(day, loggedDayIds)) {
        unscheduleIds.push(day.id);
        continue;
      }
      dateUpdates.push({
        id: day.id,
        scheduledDate: dateStr,
        resetStatus: needsStatusReset(day, dateStr, today),
      });
    }

    // Only possible for a one-week plan whose every session falls before the
    // start: refuse rather than leave the plan with nothing on the calendar.
    if (dateUpdates.length === 0) return "nothing_after_start";

    const nextDates = new Map<string, string | null>([
      ...dateUpdates.map(({ id, scheduledDate }): [string, string] => [id, scheduledDate]),
      ...unscheduleIds.map((id): [string, null] => [id, null]),
    ]);
    const undoClearIds = staleRecoveryUndoIds(plan.days, nextDates);

    // Derive the plan-level end date from the scheduled days
    const scheduledDates = dateUpdates.map((u) => u.scheduledDate);
    // ⚡ Bolt Performance Optimization:
    // Replaced localeCompare with standard string comparison for YYYY-MM-DD dates.
    // localeCompare introduces significant unnecessary overhead when sorting large arrays.
    scheduledDates.sort((a, b) => {
      if (a < b) return -1;
      if (a > b) return 1;
      return 0;
    });
    const planStartDate = weekOneMonday;
    const planEndDate = scheduledDates.at(-1) ?? scheduledDates[0];

    // Inside the caller's transaction when it passes one: plan generation
    // lays a new plan onto the calendar in the transaction that publishes it,
    // so a plan that fails to publish is left with nothing dated (D46,
    // CODEBASE_ANALYSIS_2026-10-03).
    const writeSchedule = async (writeTx: DbExecutor) => {
      // Secure batch update using idiomatic Drizzle query builder and a CASE statement
      const caseChunks = [];
      caseChunks.push(sql`CASE ${planDays.id} `);
      for (const u of dateUpdates) {
        caseChunks.push(sql`WHEN ${u.id} THEN ${u.scheduledDate}::date `);
      }
      caseChunks.push(sql`END`);

      const caseSql = sql.join(caseChunks, sql``);
      const updateIds = dateUpdates.map((u) => u.id);

      // Perform a single batch update
      await writeTx
        .update(planDays)
        .set({ scheduledDate: caseSql })
        .where(inArray(planDays.id, updateIds));

      if (unscheduleIds.length > 0) {
        await writeTx
          .update(planDays)
          .set({ scheduledDate: null })
          .where(inArray(planDays.id, unscheduleIds));
      }

      const resetUpdateIds = dateUpdates.filter((u) => u.resetStatus).map((u) => u.id);
      if (resetUpdateIds.length > 0) {
        await writeTx
          .update(planDays)
          .set({ status: "planned" })
          .where(inArray(planDays.id, resetUpdateIds));
      }

      await clearRecoveryUndo(writeTx, undoClearIds);

      // Update plan-level start/end dates
      await writeTx
        .update(trainingPlans)
        .set({ startDate: planStartDate, endDate: planEndDate })
        .where(eq(trainingPlans.id, planId));
    };
    if (tx) {
      await writeSchedule(tx);
    } else {
      await db.transaction(writeSchedule);
    }
    return "scheduled";
  }

  async findMatchingPlanDay(planId: string, date: string): Promise<PlanDay | undefined> {
    const [match] = await db
      .select()
      .from(planDays)
      .where(
        and(
          eq(planDays.planId, planId),
          eq(planDays.scheduledDate, date),
          eq(planDays.status, "planned"),
        ),
      )
      .limit(1);

    return match;
  }

  /**
   * Plan days scheduled on `dates` that a device recording could complete
   * (stravaReconciler): status planned or missed — skipped is the athlete's
   * decision and completed already has its log — with no workout log pointing
   * at them, inside their plan's lifetime. Ownership via the parent plan. One
   * query for the whole sync batch.
   */
  async listOpenPlanDaysForDates(userId: string, dates: readonly string[]): Promise<PlanDay[]> {
    if (dates.length === 0) return [];
    const rows = await db
      .select({ day: planDays })
      .from(planDays)
      .innerJoin(trainingPlans, eq(planDays.planId, trainingPlans.id))
      .where(
        and(
          eq(trainingPlans.userId, userId),
          inArray(planDays.scheduledDate, [...dates]),
          inArray(planDays.status, ["planned", "missed"]),
          planDayWithinPlanLifetime(),
          notExists(
            db.select({ one: sql`1` }).from(workoutLogs).where(eq(workoutLogs.planDayId, planDays.id)),
          ),
        ),
      )
      .orderBy(asc(planDays.scheduledDate), asc(planDays.id));
    return rows.map((row) => row.day);
  }

  async getActivePlan(userId: string): Promise<TrainingPlan | undefined> {
    // Which plan is active "today" is a question about the athlete's calendar:
    // a UTC date makes a plan starting tomorrow go live during tonight, and
    // drops a plan that ends today an evening early.
    return this.getPlanForDate(userId, await resolveUserToday(userId));
  }


  async getPlanForDate(userId: string, date: string): Promise<TrainingPlan | undefined> {
    // Single query with priority-based ordering:
    //   0 = plan covering the date, 1 = most recently ended, 2 = next upcoming
    const [plan] = await db
      .select()
      .from(trainingPlans)
      .where(
        and(
          eq(trainingPlans.userId, userId),
          isNotNull(trainingPlans.startDate),
          isNotNull(trainingPlans.endDate),
          // Only a plan that finished generating. A generation that failed
          // after laying its days out used to leave a dated plan that started
          // last and so won every overlap (D46, CODEBASE_ANALYSIS_2026-10-03);
          // generation now dates a plan only as it publishes it, and this
          // keeps any such plan already stored out of the answer.
          eq(trainingPlans.generationStatus, "ready"),
          // A retired plan still answers for the stretch it actually ran, and is
          // invisible from its cutoff onward. Scoped here rather than at each call
          // site because this method is the single choke point every consumer of
          // "the active plan" goes through — AI coaching context, nutrition phase,
          // the weekly-goal hint, and resolveActivePlanLinks, which attributes
          // newly logged workouts and marks plan days completed.
          planLiveForDate(date),
        ),
      )
      .orderBy(
        sql`CASE
          WHEN ${trainingPlans.startDate} <= ${date} AND ${trainingPlans.endDate} >= ${date} THEN 0
          WHEN ${trainingPlans.endDate} < ${date} THEN 1
          WHEN ${trainingPlans.startDate} > ${date} THEN 2
        END`,
        sql`CASE WHEN ${trainingPlans.startDate} > ${date} THEN ${trainingPlans.startDate} END ASC NULLS LAST`,
        // Most recently STARTED block wins an overlap, with end date only as a
        // final tiebreak. It used to be end-date-first, which resolved an overlap
        // by longevity: an athlete who started a short 4-week block while a
        // 12-week plan still had 6 weeks to run kept getting the old plan back,
        // because it happened to finish later. Retirement is opt-in and can't
        // help here — every plan predating this column has retired_on NULL, and
        // imports, sample plans and /schedule can still create overlaps without
        // ever going through the supersede flow. Ordering by start date fixes
        // that whole population with no backfill.
        sql`${trainingPlans.startDate} DESC`,
        sql`${trainingPlans.endDate} DESC`,
      )
      .limit(1);

    return plan;
  }

  /**
   * Flip past planned days to `missed`. Judged against each athlete's OWN
   * calendar date: a single UTC comparison persisted `missed` onto the day a
   * California athlete was still training, and unlike the timeline's render-time
   * status this is a WRITE — it only unwinds if the athlete later logs against
   * that plan day with an explicit planDayId.
   *
   * Grouped by stored timezone, one statement per zone (sweepMissedPlanDaysInZone).
   * Runs at boot and on every hourly email tick, but a zone's verdicts only
   * change when its local date does, so a zone is swept only when its date has
   * moved on since this instance last swept it: in practice the first tick
   * after each local midnight, rather than every zone on every tick. PF16
   * (CODEBASE_ANALYSIS_2026-10-03) Each replica keeps its own record, so a
   * zone may be swept once per replica per day; the UPDATE is idempotent, so
   * that only costs a repeat. A day that turns `planned` in the past later
   * the same day (a plan scheduled from a past start) is swept at the zone's
   * next midnight; the timeline already shows it missed meanwhile.
   *
   * Days inside a declared absence are left alone. An athlete who has written
   * "injured, 12–19 Aug" on their timeline has already accounted for that week;
   * writing `missed` across it is the app telling them they failed at something
   * they told us about first. Because those days keep their `planned` status,
   * the decision stays reversible — delete the annotation and the next sweep
   * marks them missed as it always would have.
   */
  async markMissedPlanDays(): Promise<number> {
    const zones = await db.selectDistinct({ tz: users.userTimezone }).from(users);
    const now = new Date();
    const due = zones
      .map(({ tz }) => ({ tz, today: getLocalDateStrSafe(now, tz) }))
      .filter(({ tz, today }) => this.sweptZoneDates.get(tz) !== today);

    const marked = await inSequence(due, async ({ tz, today }) => {
      const count = await sweepMissedPlanDaysInZone(tz, today);
      this.sweptZoneDates.set(tz, today);
      return count;
    });
    // Zones nobody is in any more are dropped, so the record stays as long as
    // the zone list. Deleting the entry being visited is safe mid-iteration.
    const live = new Set(zones.map(({ tz }) => tz));
    for (const tz of this.sweptZoneDates.keys()) {
      if (!live.has(tz)) this.sweptZoneDates.delete(tz);
    }
    return marked.reduce((total, count) => total + count, 0);
  }

  /**
   * Fail plans left in `pending`/`generating` past `olderThanMs` (S2). The
   * pg-boss plan-generation job is NO_RETRY and isn't resumed after a crash, so
   * a worker that dies mid-job strands the plan in a perpetual loading state the
   * user can't escape. `executePlanGeneration`'s catch always flips to `failed`,
   * so the only way a row stays in flight is a crash — this sweep cleans those
   * up on startup and from the stalePlanGenerations cron (D20,
   * CODEBASE_ANALYSIS_2026-10-03). The threshold must comfortably exceed real
   * generation time so a genuinely in-flight job on another instance is never failed.
   */
  async failStalePlanGenerations(olderThanMs: number): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanMs);
    const result = await db
      .update(trainingPlans)
      .set({
        generationStatus: "failed",
        generationError:
          "Plan generation was interrupted (likely a server restart). Please try again.",
      })
      .where(
        and(
          inArray(trainingPlans.generationStatus, ["pending", "generating"]),
          lt(trainingPlans.generationStartedAt, cutoff),
        ),
      )
      .returning({ id: trainingPlans.id });
    return result.length;
  }
}

/**
 * Returns how many sessions the plan schedules per week, on average. Used
 * to sanity-check a user's weeklyGoal against their plan density (S4) —
 * a 2-day plan + goal of 7 will show 0% completion unless the user logs
 * extra ad-hoc workouts, so the UI surfaces a gentle warning.
 *
 * Rest days are not sessions. AI-generated plans write a row for every day
 * of the week, rest days included, so counting rows reported 7 a week for
 * every such plan and the hint never fired for a normal goal. A day counts
 * unless isRestLikePlanDay (the test the session brief uses) reads it as
 * rest. C41 (CODEBASE_ANALYSIS_2026-10-03)
 *
 * The average is returned as a REAL number, not rounded up. It used to be
 * `Math.ceil`, which suppressed the very warning this exists to raise: a plan
 * of 10 days over 4 weeks schedules 2.5 per week, reported 3, so a goal of 3
 * compared 3 > 3 and stayed silent — while the athlete sat at 2.5/3 and
 * watched their completion rate cap out at 83% with no explanation (audit
 * L13). Rounding up is only ever safe for a floor, and this value is a
 * ceiling on what the plan can deliver.
 *
 * Two decimal places, because the raw quotient is a float: 10/3 stored as
 * 3.3333333333333335 would make an exactly-matched goal read as exceeding
 * the plan on representation alone.
 */
async function getPlanWeeklyDensity(planId: string): Promise<number | undefined> {
  // Start FROM training_plans + LEFT JOIN plan_days so a plan with zero
  // days still returns a row (count = 0, density = 0) instead of the
  // "plan not found" shape. Codex flagged this: a user who deletes every
  // plan_day on an active plan would otherwise look like "no active plan"
  // and the weeklyGoalExceedsPlan hint would silently go false. Grouped by
  // wording, so a plan's identical rest rows come back as one counted row.
  const rows = await db
    .select({
      focus: planDays.focus,
      mainWorkout: planDays.mainWorkout,
      dayCount: sql<number>`cast(count(${planDays.id}) as int)`,
      totalWeeks: trainingPlans.totalWeeks,
    })
    .from(trainingPlans)
    .leftJoin(planDays, eq(planDays.planId, trainingPlans.id))
    .where(eq(trainingPlans.id, planId))
    .groupBy(trainingPlans.totalWeeks, planDays.focus, planDays.mainWorkout);

  // totalWeeks is nullable on the schema; bail if the plan never had one set.
  const totalWeeks = rows.at(0)?.totalWeeks ?? 0;
  if (totalWeeks <= 0) return undefined;
  const sessionCount = rows
    .filter((row) => !isRestLikePlanDay(row.focus ?? "", row.mainWorkout ?? ""))
    .reduce((sum, row) => sum + row.dayCount, 0);
  return Math.round((sessionCount / totalWeeks) * 100) / 100;
}

async function getTrainingPlan(
  planId: string,
  userId: string,
  tx?: DbExecutor,
): Promise<TrainingPlanWithDays | undefined> {
  const executor = tx ?? db;
  const [plan] = await executor
    .select()
    .from(trainingPlans)
    .where(and(eq(trainingPlans.id, planId), eq(trainingPlans.userId, userId)));

  if (!plan) return undefined;

  const days = await executor.select().from(planDays).where(eq(planDays.planId, planId));

  // Case-insensitive day ordering matches the tolerant lookup used in
  // schedulePlan(), so legacy rows with non-title-case dayName values
  // (e.g. "monday" from older imports) still sort Mon→Sun instead of
  // falling back to insertion order.
  const dayOrder = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  const dayIndex = (name: string) => dayOrder.indexOf((name ?? "").trim().toLowerCase());
  days.sort((a, b) => {
    if (a.weekNumber !== b.weekNumber) return a.weekNumber - b.weekNumber;
    const aIndex = dayIndex(a.dayName);
    const bIndex = dayIndex(b.dayName);
    if (aIndex === -1 && bIndex === -1) return 0;
    if (aIndex === -1) return 1;
    if (bIndex === -1) return -1;
    return aIndex - bIndex;
  });

  return { ...plan, days };
}

/** The athlete's own calendar date, degrading to UTC for an unusable zone. */
async function resolveUserToday(userId: string, tx?: DbExecutor): Promise<string> {
  const user = await (tx ?? db).query.users.findFirst({
    where: eq(users.id, userId),
    columns: { userTimezone: true },
  });
  return getLocalDateStrSafe(new Date(), user?.userTimezone);
}
