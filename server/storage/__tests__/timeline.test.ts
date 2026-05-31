import { workoutLogs } from "@shared/schema";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "../../db";
import { TimelineStorage } from "../timeline";

vi.mock("../../db", () => ({
  db: {
    query: {
      trainingPlans: { findMany: vi.fn() },
      planDays: { findMany: vi.fn() },
    },
    select: vi.fn(),
  },
}));

// Avoid loading the real storage barrel (server/storage/index.ts), which eagerly
// constructs every storage class and triggers a circular import when this test
// imports ../timeline directly. Mirrors the pattern in plans.test.ts.
vi.mock("../../storage", () => ({ storage: {} }));

// Rows the mocked `db.select(...)` chains resolve to, set per test.
let linkedRows: unknown[] = [];
let standaloneRows: unknown[] = [];

// A chainable Drizzle-style query stub. Each builder method returns a real
// Promise (augmented with the builder methods), so `await query` uses the
// native Promise `then` rather than a hand-rolled thenable. workoutLogs queries
// resolve to linked vs standalone rows (standalone is the `.$dynamic()` branch);
// everything else (exercise_sets) resolves to [].
interface SelectChain extends Promise<unknown[]> {
  from(table: unknown): SelectChain;
  where(): SelectChain;
  orderBy(): SelectChain;
  $dynamic(): SelectChain;
  limit(): SelectChain;
}

function selectStub(): SelectChain {
  let table: unknown;
  let dynamic = false;
  const resolveRows = (): unknown[] => {
    if (table === workoutLogs) return dynamic ? standaloneRows : linkedRows;
    return []; // exercise_sets and anything else
  };
  const make = (): SelectChain => {
    const methods = {
      from(t: unknown) {
        table = t;
        return make();
      },
      where: () => make(),
      orderBy: () => make(),
      $dynamic: () => {
        dynamic = true;
        return make();
      },
      limit: () => make(),
    };
    // Promise.resolve().then(resolveRows) defers row resolution to a microtask,
    // by which point the synchronous builder chain has set table/dynamic.
    return Object.assign(Promise.resolve().then(resolveRows), methods);
  };
  return make();
}

const workoutStorage = {
  getExerciseSetsByWorkoutLogs: vi.fn().mockResolvedValue([]),
  getWorkoutStructuresByWorkoutLogs: vi.fn().mockResolvedValue(new Map()),
  getWorkoutStructuresByPlanDays: vi.fn().mockResolvedValue(new Map()),
};

function planDay(id: string, scheduledDate: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    planId: "plan-1",
    weekNumber: 1,
    dayName: "Monday",
    focus: "Strength",
    mainWorkout: "Back squat 3x5",
    accessory: null,
    notes: null,
    scheduledDate,
    status: "planned",
    aiSource: "generated",
    aiRationale: null,
    aiNoteUpdatedAt: null,
    aiInputsUsed: null,
    ...overrides,
  };
}

const RACE = "2026-07-11";

describe("TimelineStorage race-day derivation", () => {
  let storage: TimelineStorage;

  beforeEach(() => {
    vi.clearAllMocks();
    linkedRows = [];
    standaloneRows = [];
    storage = new TimelineStorage(workoutStorage as never);
    vi.mocked(db.query.trainingPlans.findMany).mockResolvedValue([
      { id: "plan-1", name: "Plan", raceDate: RACE },
    ] as never);
    vi.mocked(db.select).mockImplementation(() => selectStub() as never);
  });

  it("derives Race Day / Shakeout / Recovery for planned days and leaves normal days alone", async () => {
    vi.mocked(db.query.planDays.findMany).mockResolvedValue([
      planDay("d-normal", "2026-07-01", { focus: "Easy Run" }),
      planDay("d-shakeout", "2026-07-10", { focus: "Intervals" }),
      planDay("d-race", RACE, { focus: "Upper Strength" }),
      planDay("d-recovery", "2026-07-12", { focus: "Tempo" }),
    ] as never);

    const entries = await storage.getTimeline("user-1");
    const byDate = (d: string) => entries.find((e) => e.date === d)!;

    expect(byDate(RACE).focus).toBe("Race Day");
    expect(byDate(RACE).exerciseSets ?? []).toHaveLength(0); // underlying exercises suppressed
    expect(byDate("2026-07-10").focus).toBe("Shakeout");
    expect(byDate("2026-07-12").focus).toBe("Recovery");
    expect(byDate("2026-07-01").focus).toBe("Easy Run"); // untouched
  });

  it("does NOT override a LOGGED workout that falls on the race date", async () => {
    vi.mocked(db.query.planDays.findMany).mockResolvedValue([planDay("d-race", RACE)] as never);
    linkedRows = [
      {
        id: "log-1",
        planDayId: "d-race",
        date: RACE,
        focus: "Race effort",
        mainWorkout: "Raced the HYROX and logged it",
        accessory: null,
        notes: null,
        duration: 70,
        rpe: 9,
        source: "manual",
        calories: null,
        distanceMeters: null,
        elevationGain: null,
        avgHeartrate: null,
        maxHeartrate: null,
        avgSpeed: null,
        maxSpeed: null,
        avgCadence: null,
        avgWatts: null,
        sufferScore: null,
        plannedSetCount: null,
        actualSetCount: null,
        matchedSetCount: null,
        addedSetCount: null,
        removedSetCount: null,
        compliancePct: null,
      },
    ];

    const entries = await storage.getTimeline("user-1");
    const raceEntry = entries.find((e) => e.date === RACE)!;

    expect(raceEntry.type).toBe("logged");
    expect(raceEntry.focus).toBe("Race effort"); // the athlete's logged workout, not "Race Day"
  });
});

function standaloneLog(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    planId: null,
    planDayId: null,
    date: "2026-06-01",
    focus: "Easy Run",
    mainWorkout: "30 min Z2",
    accessory: null,
    notes: null,
    duration: 30,
    rpe: 5,
    source: "manual",
    calories: null,
    distanceMeters: null,
    elevationGain: null,
    avgHeartrate: null,
    maxHeartrate: null,
    avgSpeed: null,
    maxSpeed: null,
    avgCadence: null,
    avgWatts: null,
    sufferScore: null,
    plannedSetCount: null,
    actualSetCount: null,
    matchedSetCount: null,
    addedSetCount: null,
    removedSetCount: null,
    compliancePct: null,
    ...overrides,
  };
}

describe("TimelineStorage standalone workout plan association", () => {
  let storage: TimelineStorage;

  beforeEach(() => {
    vi.clearAllMocks();
    linkedRows = [];
    standaloneRows = [];
    storage = new TimelineStorage(workoutStorage as never);
    vi.mocked(db.query.trainingPlans.findMany).mockResolvedValue([
      { id: "plan-1", name: "Plan One", raceDate: null },
      { id: "plan-2", name: "Plan Two", raceDate: null },
    ] as never);
    vi.mocked(db.query.planDays.findMany).mockResolvedValue([] as never);
    vi.mocked(db.select).mockImplementation(() => selectStub() as never);
  });

  it("tags a standalone workout that carries its own planId with the plan name", async () => {
    standaloneRows = [standaloneLog("x", { planId: "plan-1" })];

    const entries = await storage.getTimeline("user-1");
    const entry = entries.find((e) => e.id === "log-x")!;

    expect(entry.planId).toBe("plan-1");
    expect(entry.planName).toBe("Plan One");
  });

  it("leaves a truly unattached workout (no planId) untagged", async () => {
    standaloneRows = [standaloneLog("y", { planId: null })];

    const entries = await storage.getTimeline("user-1");
    const entry = entries.find((e) => e.id === "log-y")!;

    expect(entry.planId).toBeNull();
    expect(entry.planName).toBeNull();
  });

  it("forwards the selected plan filter to the standalone query, and omits it for All Plans", async () => {
    const spy = vi.spyOn(
      storage,
      "fetchStandaloneWorkouts",
    );

    // Filtering by a specific plan must thread that planId into the standalone
    // fetch so other-plan workouts can be excluded (the bug: it never was).
    await storage.getTimeline("user-1", "plan-2");
    expect(spy).toHaveBeenLastCalledWith("user-1", "plan-2", undefined);

    // All Plans (no planId) leaves the standalone fetch unscoped.
    await storage.getTimeline("user-1");
    expect(spy).toHaveBeenLastCalledWith("user-1", undefined, undefined);
  });
});
