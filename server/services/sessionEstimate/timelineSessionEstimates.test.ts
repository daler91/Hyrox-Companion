import { estimatePlannedSession } from "@shared/plannedSessionEstimate";
import type { TimelineEntry } from "@shared/schema";
import { afterEach, describe, expect, it, vi } from "vitest";

import { storage } from "../../storage";
import { getRunPaceRatio } from "./runPace";
import { withSessionEstimates } from "./timelineSessionEstimates";

vi.mock("../../storage", () => ({
  storage: { users: { getUser: vi.fn() } },
}));
vi.mock("./runPace", () => ({ getRunPaceRatio: vi.fn() }));

const getUser = vi.mocked(storage.users.getUser);
const runPace = vi.mocked(getRunPaceRatio);

// 9 km easy: an estimate from the run's distance, so the athlete's pace and units count.
const sets = [{ exerciseName: "recovery_run", plannedDistance: 9000 }] as never;

function entry(overrides: Partial<TimelineEntry>): TimelineEntry {
  return {
    id: "plan-d1",
    date: "2026-11-20",
    type: "planned",
    status: "planned",
    focus: "Easy run",
    mainWorkout: "5 km easy",
    accessory: null,
    notes: null,
    planDayId: "d1",
    exerciseSets: sets,
    structureBlocks: [],
    ...overrides,
  };
}

afterEach(() => vi.clearAllMocks());

describe("withSessionEstimates", () => {
  it("estimates each upcoming planned day at the athlete's run pace", async () => {
    getUser.mockResolvedValue({ distanceUnit: "km" } as never);
    runPace.mockResolvedValue(1.2);

    const [planned] = await withSessionEstimates("u1", [entry({})]);

    const expected = estimatePlannedSession({ exerciseSets: sets, structureBlocks: [], distanceUnit: "km", runPaceRatio: 1.2 });
    expect(planned.sessionEstimate).toEqual(expected);
    // Slower than generic: the personalised estimate is longer than the generic one.
    const generic = estimatePlannedSession({ exerciseSets: sets, structureBlocks: [], distanceUnit: "km" });
    expect(expected.durationMin).toBeGreaterThan(generic.durationMin ?? Number.MAX_VALUE);
    expect(getUser).toHaveBeenCalledWith("u1");
    expect(runPace).toHaveBeenCalledWith("u1");
  });

  it("reads a distance with no unit stamp in the athlete's units", async () => {
    getUser.mockResolvedValue({ distanceUnit: "miles" } as never);
    runPace.mockResolvedValue(1);

    const [planned] = await withSessionEstimates("u1", [entry({})]);

    const inMiles = estimatePlannedSession({ exerciseSets: sets, structureBlocks: [], distanceUnit: "miles", runPaceRatio: 1 });
    expect(planned.sessionEstimate).toEqual(inMiles);
    expect(inMiles).not.toEqual(estimatePlannedSession({ exerciseSets: sets, structureBlocks: [], distanceUnit: "km", runPaceRatio: 1 }));
  });

  it("leaves logged, missed and unplanned entries alone", async () => {
    getUser.mockResolvedValue(undefined);
    runPace.mockResolvedValue(1);
    const others = [
      entry({ id: "log-w1", type: "logged", status: "completed", workoutLogId: "w1" }),
      entry({ id: "plan-d2", status: "missed", planDayId: "d2" }),
      entry({ id: "log-w2", type: "logged", status: "completed", planDayId: undefined }),
    ];

    const [first, second, third, upcoming] = await withSessionEstimates("u1", [...others, entry({ id: "plan-d3", planDayId: "d3" })]);

    expect([first, second, third].map((e) => e.sessionEstimate)).toEqual([undefined, undefined, undefined]);
    // No saved unit: a distance set reads as km.
    expect(upcoming.sessionEstimate).toEqual(estimatePlannedSession({ exerciseSets: sets, structureBlocks: [], distanceUnit: "km", runPaceRatio: 1 }));
  });

  it("reads nothing when no entry is an upcoming planned day", async () => {
    const logged = [entry({ id: "log-w1", type: "logged", status: "completed" })];

    expect(await withSessionEstimates("u1", logged)).toBe(logged);
    expect(getUser).not.toHaveBeenCalled();
    expect(runPace).not.toHaveBeenCalled();
  });

  it("still estimates when the athlete's preferences can't be read", async () => {
    getUser.mockRejectedValue(new Error("db down"));
    runPace.mockResolvedValue(1);

    const [planned] = await withSessionEstimates("u1", [entry({})]);

    expect(planned.sessionEstimate?.durationMin).not.toBeNull();
  });
});
