// isExcusedFromMissed lives in the shared leaf module so the weekly review's
// counts apply the identical rule — a day must never read "Not counted" here
// and "Missed" there.
import { type AbsenceRange, isDateExcused, isExcusedFromMissed } from "@shared/absence";
import {
  type ExerciseSet,
  exerciseSets,
  type PlanDay,
  planDays,
  timelineAnnotations,
  type TimelineEntry,
  trainingPlans,
  users,
  type WorkoutLog,
  workoutLogs,
  type WorkoutStatus,
} from "@shared/schema";
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, notInArray, or } from "drizzle-orm";

import { db } from "../db";
import { getLocalDateStrSafe } from "../timezone";
import { deriveRaceDayOverride, type RaceDayOverride } from "./raceDayView";
import { sortAndWindowTimelineEntries } from "./timelineWindow";
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

/**
 * `isExcused` — the day falls inside an absence the athlete declared. It
 * outranks both the stored `missed` and the past-date comparison, and it has to
 * outrank the stored one: an annotation is almost always written *after* the
 * fact, by which point the nightly sweep has already stamped `missed` across
 * the week. Suppressing only the fresh case would fix nothing for the athlete
 * who logs their injury on the way back from the physio.
 *
 * This is a read-time derivation, exactly like the race-day override — the
 * plan_day is never rewritten, so `missed → planned` stays forbidden as a WRITE
 * and deleting the annotation restores the old reading immediately.
 *
 * `completed` and `skipped` still win. If the athlete trained anyway that is
 * real, and an explicit skip is a decision they made themselves.
 */
function calculatePlanDayStatus(
  dayStatus: string | null,
  scheduledDate: string,
  today: string,
  isExcused: boolean,
): WorkoutStatus {
  if (dayStatus === "skipped") return "skipped";
  if (dayStatus === "completed") return "completed";
  if (isExcused) return "planned";
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
  override: RaceDayOverride | null,
  isExcused: boolean,
): TimelineEntry {
  const status = calculatePlanDayStatus(day.status, scheduledDate, today, isExcused);
  return {
    id: `plan-${day.id}`,
    date: scheduledDate,
    type: "planned",
    status: status,
    // Carried separately from `status` so the card can say *why* this past day
    // is not red, instead of showing a bare "Planned" on a date that has been
    // and gone. Omitted rather than sent false so the field stays absent from
    // every ordinary day's payload.
    excused: isExcusedFromMissed(day.status, scheduledDate, today, isExcused) || undefined,
    focus: override ? override.focus : day.focus,
    mainWorkout: override ? override.mainWorkout : day.mainWorkout,
    accessory: override ? override.accessory : day.accessory,
    notes: override ? override.notes : day.notes,
    planDayId: day.id,
    expectedDurationMin: day.expectedDurationMin,
    expectedRpe: day.expectedRpe,
    plannedTimeOfDayMin: day.plannedTimeOfDayMin,
    weekNumber: day.weekNumber,
    dayName: day.dayName,
    planName: row.planName,
    planId: row.planId,
    aiSource: day.aiSource as TimelineEntry["aiSource"],
    // Coach notes describe the original workout; drop them on a derived race/shakeout/recovery day.
    aiRationale: override ? null : day.aiRationale,
    aiNoteUpdatedAt: override ? null : day.aiNoteUpdatedAt,
    aiInputsUsed: override ? null : day.aiInputsUsed,
  };
}

export interface UpcomingPlannedDay {
  planDayId: string;
  date: string;
  focus: string;
  mainWorkout: string;
  accessory: string | null;
  notes: string | null;
  aiSource: TimelineEntry["aiSource"];
  aiRationale: string | null;
  aiNoteUpdatedAt: Date | null;
  aiInputsUsed: PlanDay["aiInputsUsed"];
  /** Athlete-set expected duration/intensity for the session, when saved. */
  expectedDurationMin: number | null;
  expectedRpe: number | null;
  exerciseSets: ExerciseSet[];
  structureBlocks: TimelineEntry["structureBlocks"];
}

// Shape one upcoming planned-day row for the AI coach, applying a race-day
// override when present (which blanks the original workout's exercises/notes).
function toUpcomingPlannedDay(
  row: {
    id: string;
    focus: string | null;
    mainWorkout: string | null;
    accessory: string | null;
    notes: string | null;
    aiSource: string | null;
    aiRationale: string | null;
    aiNoteUpdatedAt: Date | null;
    aiInputsUsed: PlanDay["aiInputsUsed"];
    expectedDurationMin: number | null;
    expectedRpe: number | null;
  },
  scheduledDate: string,
  override: RaceDayOverride | null,
  setsByPlanDayId: Map<string, ExerciseSet[]>,
  blocksByPlanDayId: Map<string, TimelineEntry["structureBlocks"]>,
): UpcomingPlannedDay {
  return {
    planDayId: row.id,
    date: scheduledDate,
    focus: override?.focus ?? row.focus ?? "",
    mainWorkout: override?.mainWorkout ?? row.mainWorkout ?? "",
    accessory: override ? override.accessory : row.accessory,
    notes: override ? override.notes : row.notes,
    aiSource: row.aiSource as TimelineEntry["aiSource"],
    aiRationale: override ? null : row.aiRationale,
    aiNoteUpdatedAt: override ? null : row.aiNoteUpdatedAt,
    aiInputsUsed: override ? null : row.aiInputsUsed,
    // Expected values describe the original prescription; a derived race/
    // shakeout day replaces it, so drop them alongside the exercises.
    expectedDurationMin: override ? null : row.expectedDurationMin,
    expectedRpe: override ? null : row.expectedRpe,
    exerciseSets: override ? [] : (setsByPlanDayId.get(row.id) ?? []),
    structureBlocks: override ? [] : (blocksByPlanDayId.get(row.id) ?? []),
  };
}

// A workout not linked to a scheduled plan day. It may still carry its own
// planId (e.g. logged inside a plan's window but on a date with no scheduled
// day), in which case we surface the plan name so the timeline tags it and the
// plan filter can scope it. planId is the source of truth — the day link is absent.
function createStandaloneWorkoutEntry(
  log: WorkoutLog,
  planNameById: Map<string, string>,
): TimelineEntry {
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
    planId: log.planId ?? null,
    planName: log.planId ? (planNameById.get(log.planId) ?? null) : null,
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

function collectExerciseSetOwnerIds(
  entries: TimelineEntry[],
  suppressedPlanDayIds: ReadonlySet<string>,
): {
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
    // Race/shakeout/recovery days are displayed without their underlying exercises.
    if (entry.planDayId && !suppressedPlanDayIds.has(entry.planDayId)) {
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

function hydrateTimelineStructureBlocks(
  entries: TimelineEntry[],
  blocksByWorkoutId: Map<string, TimelineEntry["structureBlocks"]>,
  blocksByPlanDayId: Map<string, TimelineEntry["structureBlocks"]>,
): void {
  for (const entry of entries) {
    if (entry.workoutLogId) {
      entry.structureBlocks = blocksByWorkoutId.get(entry.workoutLogId) ?? [];
    } else if (entry.planDayId) {
      entry.structureBlocks = blocksByPlanDayId.get(entry.planDayId) ?? [];
    }
  }
}

export class TimelineStorage {
  constructor(private readonly workoutStorage: WorkoutStorage) {}

  private async attachExerciseSets(
    entries: TimelineEntry[],
    suppressedPlanDayIds: ReadonlySet<string> = new Set(),
  ): Promise<void> {
    const { workoutLogIds, planDayIds } = collectExerciseSetOwnerIds(entries, suppressedPlanDayIds);

    if (workoutLogIds.length === 0 && planDayIds.length === 0) return;

    const [allSets, setsByPlanDayId, blocksByWorkoutId, blocksByPlanDayId] = await Promise.all([
      workoutLogIds.length > 0
        ? this.workoutStorage.getExerciseSetsByWorkoutLogs(workoutLogIds)
        : Promise.resolve([]),
      fetchPlanDayExerciseSets(planDayIds),
      this.workoutStorage.getWorkoutStructuresByWorkoutLogs(workoutLogIds),
      this.workoutStorage.getWorkoutStructuresByPlanDays(planDayIds),
    ]);

    hydrateTimelineExerciseSets(entries, groupExerciseSetsByWorkoutLogId(allSets), setsByPlanDayId);
    hydrateTimelineStructureBlocks(entries, blocksByWorkoutId, blocksByPlanDayId);
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
      columns: { id: true, name: true, raceDate: true },
    });
    // W7: build the plan-name map once and return it so getTimeline can reuse it
    // for standalone-workout plan names instead of issuing a second identical
    // trainingPlans query (the old fetchUserPlanNameMap).
    const planNameById = new Map(userPlans.map((p) => [p.id, p.name]));
    if (userPlans.length === 0) return { scheduledDays: [], planNameById };

    const planIds = userPlans.map((p) => p.id);
    const relevantPlanIds = planId && planIds.includes(planId) ? [planId] : planIds;
    if (relevantPlanIds.length === 0) return { scheduledDays: [], planNameById };
    const raceDateById = new Map(userPlans.map((p) => [p.id, p.raceDate]));

    const days = await db.query.planDays.findMany({
      where: and(inArray(planDays.planId, relevantPlanIds), isNotNull(planDays.scheduledDate)),
      orderBy: desc(planDays.scheduledDate),
      ...(sqlLimit === undefined ? {} : { limit: sqlLimit }),
    });

    const scheduledDays = days.map((day) => ({
      planDay: day,
      planName: planNameById.get(day.planId)!,
      planId: day.planId,
      raceDate: raceDateById.get(day.planId) ?? null,
    }));
    return { scheduledDays, planNameById };
  }

  /**
   * The athlete's own calendar date — NOT the server's. "Today" decides whether
   * a scheduled plan day reads as `planned` or `missed`
   * (`calculatePlanDayStatus`), so deriving it in UTC told every athlete west
   * of UTC that today's session was already missed as soon as UTC rolled over:
   * from 17:00 for California, 14:00 for Hawaii, every single day. Mirrors the
   * regime the streak (`routeUtils.ts`) and nutrition logging already use.
   */
  private async resolveUserToday(userId: string): Promise<string> {
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { userTimezone: true },
    });
    return getLocalDateStrSafe(new Date(), user?.userTimezone);
  }

  /**
   * The athlete's declared absences — just the two date columns, since that is
   * all the status derivation needs. Unbounded by date on purpose: an athlete
   * accumulates a handful of these a year, so a range predicate would cost more
   * in query planning than it saves in rows, and the timeline's own window can
   * reach arbitrarily far back.
   */
  private async fetchAbsences(userId: string): Promise<AbsenceRange[]> {
    return db
      .select({
        startDate: timelineAnnotations.startDate,
        endDate: timelineAnnotations.endDate,
      })
      .from(timelineAnnotations)
      .where(eq(timelineAnnotations.userId, userId));
  }

  private computeSqlOverFetch(limit?: number, offset?: number): number | undefined {
    // Keep pagination pressure in SQL first; in-memory slicing only finalizes
    // the merged multi-source ordering. The 3x is correctness headroom for the
    // multi-source merge — deliberately NOT reduced in the hydration-reorder
    // change (hydration now happens after windowing, so over-fetch cost is
    // limited to the slim base rows).
    if (limit === undefined) return undefined;
    return (offset || 0) + limit * 3;
  }

  private sortAndWindowEntries(
    entries: TimelineEntry[],
    limit?: number,
    offset?: number,
  ): TimelineEntry[] {
    return sortAndWindowTimelineEntries(entries, limit, offset);
  }

  private async fetchStandaloneWorkouts(
    userId: string,
    planId?: string,
    sqlLimit?: number,
  ): Promise<WorkoutLog[]> {
    const conditions = [eq(workoutLogs.userId, userId), isNull(workoutLogs.planDayId)];

    // When scoping to a specific plan, hide standalone workouts that belong to a
    // DIFFERENT plan, but keep unattached (no-plan) workouts and this plan's own.
    // With no plan filter (All Plans), all planDayId-null workouts are returned.
    if (planId !== undefined) {
      // or() is only undefined for an empty arg list; with two conditions it is
      // always defined, but narrow explicitly so we never push undefined.
      const planScope = or(isNull(workoutLogs.planId), eq(workoutLogs.planId, planId));
      if (planScope) conditions.push(planScope);
    }

    let query = db
      .select()
      .from(workoutLogs)
      .where(and(...conditions))
      .orderBy(desc(workoutLogs.date))
      .$dynamic();

    if (sqlLimit !== undefined) {
      query = query.limit(sqlLimit);
    }

    return query;
  }

  private buildTimelineEntries(
    scheduledDays: Awaited<ReturnType<TimelineStorage["fetchScheduledDays"]>>["scheduledDays"],
    linkedWorkouts: WorkoutLog[],
    standaloneWorkouts: WorkoutLog[],
    today: string,
    planNameById: Map<string, string>,
    absences: AbsenceRange[],
  ): { entries: TimelineEntry[]; suppressedPlanDayIds: Set<string> } {
    const entries: TimelineEntry[] = [];
    const suppressedPlanDayIds = new Set<string>();

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
        // A logged workout shows what the athlete actually did — never overridden.
        entries.push(
          createLinkedWorkoutEntry(day, linkedLog, { planName: row.planName, planId: row.planId }),
        );
      } else {
        const override = deriveRaceDayOverride(day.scheduledDate, row.raceDate);
        if (override) suppressedPlanDayIds.add(day.id);
        entries.push(
          createPlannedDayEntry(
            day,
            day.scheduledDate,
            { planName: row.planName, planId: row.planId },
            today,
            override,
            isDateExcused(day.scheduledDate, absences),
          ),
        );
      }
    }

    for (const log of standaloneWorkouts) {
      entries.push(createStandaloneWorkoutEntry(log, planNameById));
    }

    return { entries, suppressedPlanDayIds };
  }

  async getTimeline(
    userId: string,
    planId?: string,
    limit?: number,
    offset?: number,
  ): Promise<TimelineEntry[]> {
    const sqlOverFetch = this.computeSqlOverFetch(limit, offset);

    // ⚡ Bolt Performance Optimization: resolveUserToday (reads `users`) and
    // fetchScheduledDays (reads `trainingPlans`/`planDays`) touch unrelated
    // tables and have no data dependency between them — `today` isn't
    // consumed until buildTimelineEntries below, well after this point. This
    // is the primary loader behind every Timeline page load and every AI
    // coach turn (buildAIContext -> getTimeline), so halving these two
    // sequential round-trips into one is a real win on a very hot path.
    //
    // fetchAbsences joins the same wave for the same reason: it reads a third
    // unrelated table and is not consumed until buildTimelineEntries either.
    const [today, { scheduledDays, planNameById }, absences] = await Promise.all([
      this.resolveUserToday(userId),
      this.fetchScheduledDays(userId, planId, sqlOverFetch),
      this.fetchAbsences(userId),
    ]);
    const planDayIds = scheduledDays.map((r) => r.planDay.id);

    // W7: planNameById already came from fetchScheduledDays above, so no second
    // trainingPlans query is needed here for the standalone-workout plan names.
    const [linkedWorkouts, standaloneWorkouts] = await Promise.all([
      planDayIds.length > 0
        ? db
            .select()
            .from(workoutLogs)
            .where(and(eq(workoutLogs.userId, userId), inArray(workoutLogs.planDayId, planDayIds)))
        : Promise.resolve([]),
      this.fetchStandaloneWorkouts(userId, planId, sqlOverFetch),
    ]);

    const { entries, suppressedPlanDayIds } = this.buildTimelineEntries(
      scheduledDays,
      linkedWorkouts,
      standaloneWorkouts,
      today,
      planNameById,
      absences,
    );
    // Window BEFORE hydrating: attachExerciseSets fans out four batch reads keyed
    // by entry ids, so hydrating the full over-fetched merge (offset + 3x limit
    // PER SOURCE — ~3000 entries for the production limit=500 call) did
    // O(over-fetch) hydration for O(limit) returned rows. The reorder is safe:
    // sortAndWindowTimelineEntries sorts by date only (never a hydrated field),
    // and suppressedPlanDayIds is a superset of the window's suppressed ids. The
    // limit === undefined callers (export, email digest) window nothing and keep
    // full hydration.
    const windowed = this.sortAndWindowEntries(entries, limit, offset);
    await this.attachExerciseSets(windowed, suppressedPlanDayIds);
    return windowed;
  }

  /**
   * Fetch only upcoming planned workouts directly from DB with LIMIT.
   * Avoids loading the full timeline for AI suggestions.
   */
  async getUpcomingPlannedDays(userId: string, limit: number): Promise<UpcomingPlannedDay[]> {
    const today = await this.resolveUserToday(userId);
    // Relational query: resolve user's plans first, then pull matching days
    // filtered by plan IDs. Same pattern as fetchScheduledDays.
    const userPlans = await db.query.trainingPlans.findMany({
      where: eq(trainingPlans.userId, userId),
      columns: { id: true, raceDate: true },
    });
    if (userPlans.length === 0) return [];
    const userPlanIds = userPlans.map((p) => p.id);
    const raceDateById = new Map(userPlans.map((p) => [p.id, p.raceDate]));

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
        planId: true,
        scheduledDate: true,
        focus: true,
        mainWorkout: true,
        accessory: true,
        notes: true,
        aiSource: true,
        aiRationale: true,
        aiNoteUpdatedAt: true,
        aiInputsUsed: true,
        expectedDurationMin: true,
        expectedRpe: true,
        status: true,
      },
      orderBy: asc(planDays.scheduledDate),
      limit,
    });

    const planDayIds = rows.map((r) => r.id);
    const [setsByPlanDayId, blocksByPlanDayId] = await Promise.all([
      fetchPlanDayExerciseSets(planDayIds),
      this.workoutStorage.getWorkoutStructuresByPlanDays(planDayIds),
    ]);

    const upcoming: UpcomingPlannedDay[] = [];
    for (const r of rows) {
      if (r.scheduledDate === null) continue;
      // Same race-day derivation as the timeline, so the coach sees the race day
      // and its light shakeout/recovery context instead of the raw workout.
      const override = deriveRaceDayOverride(r.scheduledDate, raceDateById.get(r.planId));
      upcoming.push(
        toUpcomingPlannedDay(r, r.scheduledDate, override, setsByPlanDayId, blocksByPlanDayId),
      );
    }

    return upcoming;
  }
}
