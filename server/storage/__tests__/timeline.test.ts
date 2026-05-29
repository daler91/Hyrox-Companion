import { exerciseSets, workoutLogs } from "@shared/schema";
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

// A chainable, awaitable query stub. workoutLogs queries return linked vs
// standalone rows (standalone is the one that calls `.$dynamic()`); exercise_set
// queries return [] (we never need prescribed sets in these tests).
function selectStub() {
  let table: unknown;
  let dynamic = false;
  const chain = {
    from(t: unknown) {
      table = t;
      return chain;
    },
    where: () => chain,
    orderBy: () => chain,
    $dynamic: () => {
      dynamic = true;
      return chain;
    },
    limit: () => chain,
    then(onFulfilled: (rows: unknown[]) => unknown, onRejected?: (e: unknown) => unknown) {
      let rows: unknown[] = [];
      if (table === workoutLogs) rows = dynamic ? standaloneRows : linkedRows;
      else if (table === exerciseSets) rows = [];
      return Promise.resolve(rows).then(onFulfilled, onRejected);
    },
  };
  return chain;
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
