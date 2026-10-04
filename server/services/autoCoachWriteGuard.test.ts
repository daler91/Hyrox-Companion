import { exerciseSets, planDays, trainingPlans } from "@shared/schema";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Tx } from "../db";
import type { UpcomingWorkout } from "../gemini/index";
import { fingerprintStoredPlanDay, lockAutoCoachWriteTargets } from "./autoCoachWriteGuard";
import type { PlanAdaptation } from "./planAdaptationService";

vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

// AI16 (CODEBASE_ANALYSIS_2026-10-03): the coach writes from a snapshot taken
// before its model calls. These pin the write-time check against it.

type Row = Record<string, unknown>;

/**
 * A fake transaction: each `select … for("update")` chain resolves to the
 * rows stored for the table it reads, and every chain and execute is logged in
 * order so lock ordering can be asserted.
 */
function fakeTx(rows: { days?: Row[]; sets?: Row[]; plans?: Row[] }) {
  const log: string[] = [];
  const executed: SQL[] = [];
  const resultFor = new Map<unknown, Row[]>([
    [planDays, rows.days ?? []],
    [exerciseSets, rows.sets ?? []],
    [trainingPlans, rows.plans ?? []],
  ]);
  const names = new Map<unknown, string>([
    [planDays, "plan_days"],
    [exerciseSets, "exercise_sets"],
    [trainingPlans, "training_plans"],
  ]);
  const tx = {
    execute: vi.fn(async (query: SQL) => {
      log.push("execute");
      executed.push(query);
      return { rows: [] };
    }),
    select: vi.fn(() => {
      let table: unknown;
      const chain = {
        from: (from: unknown) => {
          table = from;
          return chain;
        },
        innerJoin: () => chain,
        where: () => chain,
        orderBy: () => chain,
        for: async () => {
          log.push(`lock ${names.get(table)}`);
          return resultFor.get(table) ?? [];
        },
      };
      return chain;
    }),
  };
  return { tx: tx as unknown as Tx, log, executed };
}

function storedDay(overrides: Row = {}): Row {
  return {
    id: "day-1",
    planId: "plan-1",
    scheduledDate: "2026-01-16",
    status: "planned",
    focus: "Lower Strength",
    mainWorkout: "Back squat 5x5",
    accessory: null,
    notes: "Gym closed Friday",
    ...overrides,
  };
}

function storedSet(overrides: Row = {}): Row {
  return {
    id: "set-1",
    planDayId: "day-1",
    exerciseName: "back_squat",
    customLabel: null,
    category: "strength",
    setNumber: 1,
    reps: null,
    weight: null,
    distance: null,
    time: null,
    plannedReps: 5,
    plannedWeight: 100,
    plannedDistance: null,
    plannedTime: null,
    notes: null,
    sortOrder: 0,
    ...overrides,
  };
}

/** The day as the coach's snapshot read it (getUpcomingPlannedDays → mapUpcomingWorkout). */
function snapshotOf(day: Row, sets: Row[]): UpcomingWorkout {
  return {
    id: day.id as string,
    date: day.scheduledDate as string,
    focus: day.focus as string,
    mainWorkout: day.mainWorkout as string,
    accessory: (day.accessory as string | null) || undefined,
    notes: (day.notes as string | null) || undefined,
    ...(sets.length > 0
      ? {
          exerciseDetails: sets.map((set) => ({
            exerciseName: set.exerciseName as string,
            customLabel: set.customLabel as string | null,
            category: set.category as string,
            setNumber: set.setNumber as number,
            reps: (set.reps ?? set.plannedReps) as number | null,
            weight: (set.weight ?? set.plannedWeight) as number | null,
            distance: (set.distance ?? set.plannedDistance) as number | null,
            time: (set.time ?? set.plannedTime) as number | null,
            notes: set.notes as string | null,
            sortOrder: set.sortOrder as number,
          })),
        }
      : {}),
  };
}

const SNAPSHOT = snapshotOf(storedDay(), [storedSet()]);

async function staleDaysFor(live: { days: Row[]; sets: Row[] }, snapshot = SNAPSHOT) {
  const { tx } = fakeTx({
    days: live.days.map((day) => ({ day, raceDate: null })),
    sets: live.sets,
  });
  const stale = await lockAutoCoachWriteTargets(tx, "user-1", {
    days: [snapshot],
    adaptation: null,
  });
  return [...stale.dayIds];
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("lockAutoCoachWriteTargets — upcoming days", () => {
  it("takes the athlete's advisory lock before reading anything", async () => {
    const { tx, log, executed } = fakeTx({
      days: [{ day: storedDay(), raceDate: null }],
      sets: [storedSet()],
    });

    await lockAutoCoachWriteTargets(tx, "user-1", { days: [SNAPSHOT], adaptation: null });

    expect(log).toEqual(["execute", "lock plan_days", "lock exercise_sets"]);
    const query = new PgDialect().sqlToQuery(executed[0]);
    expect(query.sql).toContain("pg_advisory_xact_lock(hashtextextended(");
    expect(query.params).toEqual(["auto-coach:user-1"]);
  });

  it("reports nothing stale when the day is as the snapshot read it", async () => {
    expect(await staleDaysFor({ days: [storedDay()], sets: [storedSet()] })).toEqual([]);
  });

  it.each([
    { name: "its notes were edited", day: { notes: "Dumbbells only" }, set: {} },
    { name: "its main text was edited", day: { mainWorkout: "Front squat 5x5" }, set: {} },
    { name: "a prescribed load was changed", day: {}, set: { plannedWeight: 95 } },
    { name: "an exercise was swapped", day: {}, set: { exerciseName: "walking_lunges" } },
    { name: "it was completed", day: { status: "completed" }, set: {} },
    { name: "it was moved to another date", day: { scheduledDate: "2026-01-19" }, set: {} },
    { name: "it was renamed", day: { focus: "Upper Strength" }, set: {} },
  ])("reports the day stale when $name", async ({ day, set }) => {
    expect(
      await staleDaysFor({ days: [storedDay(day)], sets: [storedSet(set)] }),
    ).toEqual(["day-1"]);
  });

  it("reports the day stale when a set was added", async () => {
    expect(
      await staleDaysFor({
        days: [storedDay()],
        sets: [storedSet(), storedSet({ id: "set-2", setNumber: 2 })],
      }),
    ).toEqual(["day-1"]);
  });

  it("reports the day stale when it is gone (deleted, or not the athlete's)", async () => {
    expect(await staleDaysFor({ days: [], sets: [] })).toEqual(["day-1"]);
  });

  it("reads a race-derived day the way the snapshot did, so it is not mistaken for an edit", async () => {
    // getUpcomingPlannedDays shows the day before the race as a shakeout with
    // no sets, whatever the stored row says.
    const stored = storedDay({ scheduledDate: "2026-01-16" });
    const { tx } = fakeTx({
      days: [{ day: stored, raceDate: "2026-01-17" }],
      sets: [storedSet()],
    });
    const shakeout: UpcomingWorkout = {
      id: "day-1",
      date: "2026-01-16",
      focus: "Shakeout",
      mainWorkout:
        "Pre-race shakeout: 10-15 min easy jog, light mobility, and 3-4 short strides. Keep it very light.",
    };

    const stale = await lockAutoCoachWriteTargets(tx, "user-1", { days: [shakeout], adaptation: null });

    expect([...stale.dayIds]).toEqual([]);
  });
});

describe("lockAutoCoachWriteTargets — plan adaptation", () => {
  const adaptedDay = storedDay({ id: "day-9", scheduledDate: "2026-01-25" });
  const adaptedSets = [storedSet({ id: "set-9", planDayId: "day-9" })];

  function adaptation(engineStateUpdatedAt: string | null): PlanAdaptation {
    return {
      planId: "plan-1",
      result: {
        days: [
          {
            planDayId: "day-9",
            setUpdates: [{ setId: "set-9", weight: 102.5, weightUnit: "kg" }],
            rationale: "Auto-progression.",
            inputsUsed: {},
            changes: [],
          },
        ],
        engineState: { version: 1, runVdot: null, adaptedLogIds: ["log-2"], updatedAt: "t2" },
        adaptedLogIds: ["log-2"],
      },
      baseline: {
        engineStateUpdatedAt,
        dayFingerprints: new Map([
          ["day-9", fingerprintStoredPlanDay(adaptedDay as never, adaptedSets as never)],
        ]),
      },
    };
  }

  async function adaptationStale(live: { engineStateUpdatedAt: string | null; day: Row; sets: Row[] }) {
    const { tx, log } = fakeTx({
      plans: [{ engineState: { updatedAt: live.engineStateUpdatedAt } }],
      days: [{ day: live.day, raceDate: null }],
      sets: live.sets,
    });
    const stale = await lockAutoCoachWriteTargets(tx, "user-1", {
      days: [],
      adaptation: adaptation("t1"),
    });
    return { stale: stale.adaptation, log };
  }

  it("keeps the adaptation when its engine state and days are as it read them", async () => {
    const { stale, log } = await adaptationStale({
      engineStateUpdatedAt: "t1",
      day: adaptedDay,
      sets: adaptedSets,
    });
    expect(stale).toBe(false);
    // Days (then their sets) before the plan row, the order a plan-day status
    // change locks them in, so the two can't deadlock.
    expect(log).toEqual(["execute", "lock plan_days", "lock exercise_sets", "lock training_plans"]);
  });

  it("drops the adaptation when another pass already moved the engine state", async () => {
    // A concurrent pass adapted (and recorded) the same logs first; applying
    // these too would raise the loads twice.
    const { stale } = await adaptationStale({
      engineStateUpdatedAt: "t-other-pass",
      day: adaptedDay,
      sets: adaptedSets,
    });
    expect(stale).toBe(true);
  });

  it("drops the adaptation when one of its days was edited", async () => {
    const { stale } = await adaptationStale({
      engineStateUpdatedAt: "t1",
      day: adaptedDay,
      sets: [storedSet({ id: "set-9", planDayId: "day-9", plannedWeight: 95 })],
    });
    expect(stale).toBe(true);
  });

  it("drops the adaptation when its plan is gone", async () => {
    const { tx } = fakeTx({ plans: [], days: [{ day: adaptedDay, raceDate: null }], sets: adaptedSets });
    const stale = await lockAutoCoachWriteTargets(tx, "user-1", {
      days: [],
      adaptation: adaptation("t1"),
    });
    expect(stale.adaptation).toBe(true);
  });
});
