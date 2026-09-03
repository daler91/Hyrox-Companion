import { timelineAnnotations, workoutLogs } from "@shared/schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "../../db";
import { TimelineStorage } from "../timeline";

vi.mock("../../db", () => ({
  db: {
    query: {
      trainingPlans: { findMany: vi.fn() },
      planDays: { findMany: vi.fn() },
      // Timeline reads resolve the athlete's own "today" from their stored
      // timezone; default to UTC so the pre-existing suites keep the exact
      // behaviour they were written against.
      users: { findFirst: vi.fn() },
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
let absenceRows: unknown[] = [];

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
    if (table === timelineAnnotations) return absenceRows;
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

/**
 * Shared per-test reset: clears mocks and fixture rows, wires the db stubs, and
 * returns a fresh TimelineStorage. Each suite passes just the plan rows and
 * timezone it cares about; `timezone: null` leaves users.findFirst unmocked for
 * suites that set it per test.
 */
function setupTimelineStorage(
  options: {
    plans?: { id: string; name: string; raceDate: string | null }[];
    emptyPlanDays?: boolean;
    timezone?: string | null;
  } = {},
): TimelineStorage {
  vi.clearAllMocks();
  linkedRows = [];
  standaloneRows = [];
  absenceRows = [];
  const storage = new TimelineStorage(workoutStorage as never);
  vi.mocked(db.query.trainingPlans.findMany).mockResolvedValue((options.plans ?? []) as never);
  if (options.emptyPlanDays) {
    vi.mocked(db.query.planDays.findMany).mockResolvedValue([] as never);
  }
  vi.mocked(db.select).mockImplementation(() => selectStub() as never);
  if (options.timezone !== null) {
    vi.mocked(db.query.users.findFirst).mockResolvedValue({
      userTimezone: options.timezone ?? "UTC",
    } as never);
  }
  return storage;
}

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
    storage = setupTimelineStorage({ plans: [{ id: "plan-1", name: "Plan", raceDate: RACE }] });
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
      logRow("log-1", {
        planDayId: "d-race",
        date: RACE,
        focus: "Race effort",
        mainWorkout: "Raced the HYROX and logged it",
        duration: 70,
        rpe: 9,
      }),
    ];

    const entries = await storage.getTimeline("user-1");
    const raceEntry = entries.find((e) => e.date === RACE)!;

    expect(raceEntry.type).toBe("logged");
    expect(raceEntry.focus).toBe("Race effort"); // the athlete's logged workout, not "Race Day"
  });
});

/** A workout-log row as the mocked select chains resolve it (standalone by default). */
function logRow(id: string, overrides: Record<string, unknown> = {}) {
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
    storage = setupTimelineStorage({
      plans: [
        { id: "plan-1", name: "Plan One", raceDate: null },
        { id: "plan-2", name: "Plan Two", raceDate: null },
      ],
      emptyPlanDays: true,
    });
  });

  it("tags a standalone workout that carries its own planId with the plan name", async () => {
    standaloneRows = [logRow("x", { planId: "plan-1" })];

    const entries = await storage.getTimeline("user-1");
    const entry = entries.find((e) => e.id === "log-x")!;

    expect(entry.planId).toBe("plan-1");
    expect(entry.planName).toBe("Plan One");
  });

  it("leaves a truly unattached workout (no planId) untagged", async () => {
    standaloneRows = [logRow("y", { planId: null })];

    const entries = await storage.getTimeline("user-1");
    const entry = entries.find((e) => e.id === "log-y")!;

    expect(entry.planId).toBeNull();
    expect(entry.planName).toBeNull();
  });

  it("forwards the selected plan filter to the standalone query, and omits it for All Plans", async () => {
    const spy = vi.spyOn(storage, "fetchStandaloneWorkouts");

    // Filtering by a specific plan must thread that planId into the standalone
    // fetch so other-plan workouts can be excluded (the bug: it never was).
    await storage.getTimeline("user-1", "plan-2");
    expect(spy).toHaveBeenLastCalledWith("user-1", "plan-2", undefined, undefined);

    // All Plans (no planId) leaves the standalone fetch unscoped.
    await storage.getTimeline("user-1");
    expect(spy).toHaveBeenLastCalledWith("user-1", undefined, undefined, undefined);
  });
});

describe("TimelineStorage windowed hydration", () => {
  let storage: TimelineStorage;

  beforeEach(() => {
    storage = setupTimelineStorage({ emptyPlanDays: true });
  });

  it("hydrates exercise sets/structures ONLY for the windowed page", async () => {
    // Five standalone workouts, newest first once sorted; a limit-2 window must
    // hydrate exactly the two returned entries, not the whole merged set (the
    // regression: attachExerciseSets ran on the full 3x-over-fetched merge).
    standaloneRows = ["2026-06-05", "2026-06-04", "2026-06-03", "2026-06-02", "2026-06-01"].map(
      (date, i) => logRow(`w${i}`, { date }),
    );

    const entries = await storage.getTimeline("user-1", undefined, 2, 0);

    expect(entries.map((e) => e.id)).toEqual(["log-w0", "log-w1"]);
    expect(workoutStorage.getExerciseSetsByWorkoutLogs).toHaveBeenCalledTimes(1);
    expect(workoutStorage.getExerciseSetsByWorkoutLogs).toHaveBeenCalledWith(["w0", "w1"]);
    expect(workoutStorage.getWorkoutStructuresByWorkoutLogs).toHaveBeenCalledWith(["w0", "w1"]);
  });

  it("hydrates everything when no window is requested (export/email path)", async () => {
    standaloneRows = ["2026-06-05", "2026-06-04", "2026-06-03"].map((date, i) =>
      logRow(`w${i}`, { date }),
    );

    const entries = await storage.getTimeline("user-1");

    expect(entries).toHaveLength(3);
    expect(workoutStorage.getExerciseSetsByWorkoutLogs).toHaveBeenCalledWith(["w0", "w1", "w2"]);
  });
});

describe("TimelineStorage athlete-local today", () => {
  let storage: TimelineStorage;

  beforeEach(() => {
    storage = setupTimelineStorage({
      plans: [{ id: "plan-1", name: "Plan", raceDate: null }],
      timezone: null, // each test mocks users.findFirst itself
    });
    // 2026-07-21T01:00Z is still 2026-07-20 18:00 in Los Angeles: the athlete's
    // evening, before their session's day is over.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-21T01:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does NOT mark today's plan day missed for an athlete west of UTC", async () => {
    vi.mocked(db.query.users.findFirst).mockResolvedValue({
      userTimezone: "America/Los_Angeles",
    } as never);
    vi.mocked(db.query.planDays.findMany).mockResolvedValue([
      planDay("d-today", "2026-07-20"),
    ] as never);

    const entries = await storage.getTimeline("user-1");

    // Under the old UTC-derived today ("2026-07-21") this asserted "missed".
    expect(entries.find((e) => e.date === "2026-07-20")!.status).toBe("planned");
  });

  it("still marks a genuinely past plan day missed", async () => {
    vi.mocked(db.query.users.findFirst).mockResolvedValue({
      userTimezone: "America/Los_Angeles",
    } as never);
    vi.mocked(db.query.planDays.findMany).mockResolvedValue([
      planDay("d-past", "2026-07-19"),
    ] as never);

    const entries = await storage.getTimeline("user-1");

    expect(entries.find((e) => e.date === "2026-07-19")!.status).toBe("missed");
  });

  it("falls back to UTC when the stored timezone is unusable", async () => {
    vi.mocked(db.query.users.findFirst).mockResolvedValue({
      userTimezone: "Mars/Olympus_Mons",
    } as never);
    vi.mocked(db.query.planDays.findMany).mockResolvedValue([
      planDay("d-today", "2026-07-20"),
    ] as never);

    // UTC today is 2026-07-21, so the day reads missed — the pre-fix behaviour,
    // which is the correct degradation. The read must not throw.
    const entries = await storage.getTimeline("user-1");
    expect(entries.find((e) => e.date === "2026-07-20")!.status).toBe("missed");
  });
});

describe("TimelineStorage declared absences", () => {
  let storage: TimelineStorage;

  beforeEach(() => {
    storage = setupTimelineStorage({ plans: [{ id: "plan-1", name: "Plan", raceDate: null }] });
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-21T12:00:00Z")); // today = 2026-07-21 UTC
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const injuryWeek = [{ startDate: "2026-07-13", endDate: "2026-07-19" }];

  it("does not read a past day inside a declared absence as missed", async () => {
    absenceRows = injuryWeek;
    vi.mocked(db.query.planDays.findMany).mockResolvedValue([
      planDay("d-hurt", "2026-07-15"),
    ] as never);

    const [entry] = await storage.getTimeline("user-1");

    expect(entry.status).toBe("planned");
    expect(entry.excused).toBe(true);
  });

  it("un-reads a day the sweep already stamped missed before the annotation existed", async () => {
    // The realistic order of events: the athlete gets hurt, the nightly sweep
    // writes `missed` all week, and only afterwards do they log the injury.
    absenceRows = injuryWeek;
    vi.mocked(db.query.planDays.findMany).mockResolvedValue([
      planDay("d-hurt", "2026-07-15", { status: "missed" }),
    ] as never);

    const [entry] = await storage.getTimeline("user-1");

    expect(entry.status).toBe("planned");
    expect(entry.excused).toBe(true);
  });

  it("still marks a past day OUTSIDE the absence as missed", async () => {
    absenceRows = injuryWeek;
    vi.mocked(db.query.planDays.findMany).mockResolvedValue([
      planDay("d-before", "2026-07-12"),
      planDay("d-after", "2026-07-20"),
    ] as never);

    const entries = await storage.getTimeline("user-1");
    const byDate = (d: string) => entries.find((e) => e.date === d)!;

    // The boundaries are inclusive, so the days either side of the range are
    // genuinely outside it and stay missed.
    expect(byDate("2026-07-12").status).toBe("missed");
    expect(byDate("2026-07-12").excused).toBeUndefined();
    expect(byDate("2026-07-20").status).toBe("missed");
  });

  it("covers the first and last day of the range", async () => {
    absenceRows = injuryWeek;
    vi.mocked(db.query.planDays.findMany).mockResolvedValue([
      planDay("d-first", "2026-07-13"),
      planDay("d-last", "2026-07-19"),
    ] as never);

    const entries = await storage.getTimeline("user-1");

    expect(entries.every((e) => e.excused === true)).toBe(true);
  });

  it("leaves a completed or explicitly skipped day showing what the athlete did", async () => {
    absenceRows = injuryWeek;
    vi.mocked(db.query.planDays.findMany).mockResolvedValue([
      planDay("d-trained", "2026-07-15", { status: "completed" }),
      planDay("d-skipped", "2026-07-16", { status: "skipped" }),
    ] as never);

    const entries = await storage.getTimeline("user-1");
    const byDate = (d: string) => entries.find((e) => e.date === d)!;

    // Training through an injury week is still training, and an explicit skip
    // is a decision they made — neither gets overwritten with "not counted".
    expect(byDate("2026-07-15").status).toBe("completed");
    expect(byDate("2026-07-15").excused).toBeUndefined();
    expect(byDate("2026-07-16").status).toBe("skipped");
    expect(byDate("2026-07-16").excused).toBeUndefined();
  });

  it("does not mark a FUTURE day inside a booked absence as excused", async () => {
    // Travel booked for next week. Nothing has been missed yet, so the day is
    // simply still planned — there is nothing to forgive.
    absenceRows = [{ startDate: "2026-07-27", endDate: "2026-07-31" }];
    vi.mocked(db.query.planDays.findMany).mockResolvedValue([
      planDay("d-away", "2026-07-28"),
    ] as never);

    const [entry] = await storage.getTimeline("user-1");

    expect(entry.status).toBe("planned");
    expect(entry.excused).toBeUndefined();
  });

  it("leaves every day alone for an athlete with no annotations", async () => {
    absenceRows = [];
    vi.mocked(db.query.planDays.findMany).mockResolvedValue([
      planDay("d-past", "2026-07-15"),
    ] as never);

    const [entry] = await storage.getTimeline("user-1");

    expect(entry.status).toBe("missed");
    expect(entry.excused).toBeUndefined();
  });

  it("threads the volunteered skip reason onto the entry, and omits it otherwise", async () => {
    vi.mocked(db.query.planDays.findMany).mockResolvedValue([
      planDay("d-skip", "2026-07-15", { status: "skipped", skipReason: "injured" }),
      planDay("d-plain", "2026-07-16", { status: "skipped" }),
    ] as never);

    const entries = await storage.getTimeline("user-1");
    const byDate = (d: string) => entries.find((e) => e.date === d)!;

    // This is what collectRecentSkips reads to tell the coach WHY.
    expect(byDate("2026-07-15").skipReason).toBe("injured");
    expect(byDate("2026-07-16").skipReason).toBeUndefined();
  });
});
