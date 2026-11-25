import type { PlanEngineState } from "@shared/schema";
import { describe, expect, it } from "vitest";

import {
  type AdaptablePlanDay,
  type AdaptablePlanSet,
  type AdaptationInput,
  adaptPlan,
  describeMissHolds,
  type MissedPlanSession,
  previewMissHolds,
  standingMissHolds,
} from "./adaptation";
import { input, log } from "./adaptation.testFixtures";
import { rewriteRunDistance } from "./adaptationWorking";

// Today is Wednesday 14 October 2026 (the fixtures' date): Sunday's long run
// was missed, and the next three Sundays build past it.
const MISSED_ON = "2026-10-11";

function longRunDay(
  id: string,
  date: string,
  km: number,
  row: Partial<AdaptablePlanSet> = {},
): AdaptablePlanDay {
  return {
    id,
    date,
    weekNumber: 6,
    mainWorkout: `${km} km easy @ 6:05-6:42/km`,
    accessory: null,
    notes: null,
    aiInputsUsed: null,
    sets: [{ id: `${id}-run`, exerciseName: "long_run", distance: km * 1000, distanceUnit: "m", ...row }],
  };
}

const NEXT = [
  longRunDay("r1", "2026-10-18", 10),
  longRunDay("r2", "2026-10-25", 10.5),
  longRunDay("r3", "2026-11-01", 11.5),
];

function missedRun(overrides: Partial<MissedPlanSession> & { km?: number } = {}): MissedPlanSession {
  const { km = 9, ...rest } = overrides;
  return {
    planDayId: "m",
    date: MISSED_ON,
    weekNumber: 5,
    kind: "missed",
    sets: longRunDay("m", MISSED_ON, km).sets,
    ...rest,
  };
}

function runInput(overrides: Partial<AdaptationInput> = {}): AdaptationInput {
  return input({ logs: [], sets: [], upcoming: NEXT, missed: [missedRun()], ...overrides });
}

function distances(result: ReturnType<typeof adaptPlan>, dayId: string) {
  return result.days.find((day) => day.planDayId === dayId)?.setUpdates.map((update) => update.distance);
}

/** The upcoming days as a pass left them. */
function after(result: ReturnType<typeof adaptPlan>, days = NEXT): AdaptablePlanDay[] {
  return days.map((day) => {
    const adapted = result.days.find((entry) => entry.planDayId === day.id);
    if (!adapted) return day;
    const byId = new Map(adapted.setUpdates.map((update) => [update.setId, update.distance]));
    return {
      ...day,
      mainWorkout: adapted.mainWorkout ?? day.mainWorkout,
      sets: day.sets.map((set) => ({ ...set, distance: byId.get(set.id) ?? set.distance })),
    };
  });
}

function withState(engineState: PlanEngineState): AdaptationInput["plan"] {
  return { startDate: "2026-09-14", totalWeeks: 12, engineState };
}

/** A logged run of `km` on `date`, as a device import records one. */
function runLog(id: string, date: string, km: number) {
  return log(id, date, { focus: "Run", distanceMeters: km * 1000, duration: km * 6 });
}

describe("adaptPlan — a missed long run", () => {
  it("repeats the missed distance instead of building past it, then builds from there", () => {
    const result = adaptPlan(runInput());

    // 9 km again, then the plan's own 8% a week to the half kilometre:
    // 9.72 → 9.5, 10.5 → 10.5. One step behind 10, 10.5 and 11.5.
    expect(distances(result, "r1")).toEqual([9000]);
    expect(distances(result, "r2")).toEqual([9500]);
    expect(distances(result, "r3")).toEqual([10500]);

    const first = result.days.find((day) => day.planDayId === "r1");
    expect(first?.mainWorkout).toBe("9 km easy @ 6:05-6:42/km");
    expect(first?.rationale).toBe(
      "Auto-progression: You missed Sunday's Long Run (9 km), so it repeats that distance rather than jumping ahead.",
    );
    expect(first?.changes).toEqual([{ exercise: "long_run", kind: "hold", from: 10, to: 9, unit: "km" }]);
    // What the card's always-visible line reads from.
    expect(first?.inputsUsed.missedSessionHold).toEqual({
      kind: "missed",
      date: MISSED_ON,
      changes: [{ exercise: "long_run", kind: "hold", from: 10, to: 9, unit: "km" }],
    });
    expect(result.days.find((day) => day.planDayId === "r2")?.rationale).toBe(
      "Auto-progression: Long Run keeps building from the repeated distance.",
    );

    expect(result.engineState.adaptedMisses).toEqual([`m|${MISSED_ON}`]);
    expect(result.engineState.missHolds).toEqual([
      {
        planDayId: "m",
        missedOn: MISSED_ON,
        exercise: "long_run",
        unit: "m",
        sets: [
          { setId: "r1-run", from: 10000, to: 9000 },
          { setId: "r2-run", from: 10500, to: 9500 },
          { setId: "r3-run", from: 11500, to: 10500 },
        ],
      },
    ]);
  });

  it("counts the miss once", () => {
    const first = adaptPlan(runInput());
    const again = adaptPlan(runInput({ plan: withState(first.engineState), upcoming: after(first) }));
    expect(again.days).toEqual([]);

    // A distance the athlete puts back is theirs.
    const edited = adaptPlan(runInput({ plan: withState(first.engineState) }));
    expect(edited.days).toEqual([]);
  });

  it("looks again at a miss whose next long run is past what a pass reads", () => {
    // Skipped in advance, near the far edge of the three weeks a pass reads
    // (to 4 November): the long run after it is a week further out.
    const skipped = missedRun({ date: "2026-11-01", kind: "skipped" });
    const beyond = [longRunDay("far", "2026-11-08", 10)];

    const first = adaptPlan(runInput({ missed: [skipped], upcoming: beyond }));
    expect(first.days).toEqual([]);
    // Left uncounted, so the next pass asks again.
    expect(first.engineState.adaptedMisses).toEqual([]);

    const later = adaptPlan(
      runInput({
        today: "2026-10-21",
        plan: withState(first.engineState),
        missed: [skipped],
        upcoming: beyond,
      }),
    );
    expect(distances(later, "far")).toEqual([9000]);
    expect(later.engineState.adaptedMisses).toEqual(["m|2026-11-01"]);
  });

  it("holds nothing when the plan repeats the distance itself", () => {
    const result = adaptPlan(runInput({ upcoming: [longRunDay("same", "2026-10-18", 9), ...NEXT.slice(1)] }));
    expect(result.days).toEqual([]);
  });

  it("passes over a shorter week and holds the next long run that builds past the miss", () => {
    // A deload week's 7 km, then back to building.
    const result = adaptPlan(
      runInput({ upcoming: [longRunDay("deload", "2026-10-18", 7), longRunDay("r2", "2026-10-25", 10)] }),
    );
    expect(distances(result, "deload")).toBeUndefined();
    expect(distances(result, "r2")).toEqual([9000]);
  });

  it("leaves alone a long run far beyond the missed one", () => {
    // 12 km is a third longer than 9: not this miss's next step.
    const result = adaptPlan(runInput({ upcoming: [longRunDay("far", "2026-10-18", 12)] }));
    expect(result.days).toEqual([]);
  });

  it("holds nothing when the athlete ran long anyway", () => {
    const result = adaptPlan(
      runInput({ logs: [runLog("did", "2026-10-12", 8.5)], plan: withState(state(["did"])) }),
    );
    expect(result.days).toEqual([]);

    // A short run since is not the long run.
    const short = adaptPlan(
      runInput({ logs: [runLog("easy", "2026-10-12", 5)], plan: withState(state(["easy"])) }),
    );
    expect(distances(short, "r1")).toEqual([9000]);
  });

  it("holds nothing for a session missed in a deload week, or a long run with no distance", () => {
    // Week 4 of 12 is a deload: no step of the progression was lost.
    expect(adaptPlan(runInput({ missed: [missedRun({ weekNumber: 4 })] })).days).toEqual([]);

    const byTime = [{ id: "m-run", exerciseName: "long_run", notes: "90 min easy" }];
    expect(adaptPlan(runInput({ missed: [missedRun({ sets: byTime })] })).days).toEqual([]);
  });

  it("says skipped for a skip, and never calls a declared absence a miss", () => {
    const skipped = adaptPlan(runInput({ missed: [missedRun({ kind: "skipped" })] }));
    expect(skipped.days[0]?.rationale).toContain("You skipped Sunday's Long Run (9 km)");

    const excused = adaptPlan(runInput({ missed: [missedRun({ kind: "excused" })] }));
    expect(excused.days[0]?.rationale).toContain("Sunday's Long Run (9 km) didn't happen");
    expect(excused.days[0]?.rationale).not.toMatch(/missed/i);
  });

  it("works in miles, on rows stored in feet", () => {
    const miles = (id: string, date: string, mi: number): AdaptablePlanDay => ({
      ...longRunDay(id, date, 0),
      mainWorkout: `${mi} mi easy @ 9:45-10:45/mi`,
      sets: [{ id: `${id}-run`, exerciseName: "long_run", distance: mi * 5280, distanceUnit: "ft" }],
    });
    const result = adaptPlan(
      runInput({
        distanceUnit: "miles",
        missed: [missedRun({ sets: miles("m", MISSED_ON, 6).sets })],
        upcoming: [miles("r1", "2026-10-18", 6.5)],
      }),
    );

    expect(distances(result, "r1")).toEqual([31680]);
    const day = result.days.find((entry) => entry.planDayId === "r1");
    expect(day?.mainWorkout).toBe("6 mi easy @ 9:45-10:45/mi");
    expect(day?.changes).toEqual([{ exercise: "long_run", kind: "hold", from: 6.5, to: 6, unit: "mi" }]);
    expect(day?.rationale).toContain("Sunday's Long Run (6 mi)");
  });

  it("writes the column the row keeps its distance in", () => {
    const parsed = longRunDay("r1", "2026-10-18", 10, { distance: null, plannedDistance: 10000 });
    const result = adaptPlan(runInput({ upcoming: [parsed] }));

    expect(result.days[0]?.setUpdates).toEqual([{ setId: "r1-run", plannedDistance: 9000 }]);
  });

  it("changes the rows but not text it cannot place the distance in", () => {
    const twice = { ...longRunDay("r1", "2026-10-18", 10), mainWorkout: "10 km easy, or 10 km on the trails" };
    const unstated = { ...longRunDay("r2", "2026-10-25", 10.5), mainWorkout: "Long easy run, conversational" };
    const result = adaptPlan(runInput({ upcoming: [twice, unstated] }));

    expect(distances(result, "r1")).toEqual([9000]);
    expect(result.days.find((day) => day.planDayId === "r1")?.mainWorkout).toBeUndefined();
    expect(distances(result, "r2")).toEqual([9500]);
    expect(result.days.find((day) => day.planDayId === "r2")?.mainWorkout).toBeUndefined();
  });

  it("gives the distance back when the missed long run returns ahead of the held one", () => {
    const first = adaptPlan(runInput());
    const result = adaptPlan(
      runInput({
        plan: withState(first.engineState),
        upcoming: after(first),
        missed: [],
        // Folded into this Friday, before next Sunday's long run.
        returnedPlanDays: new Map([["m", "2026-10-16"]]),
      }),
    );

    expect(distances(result, "r1")).toEqual([10000]);
    expect(distances(result, "r3")).toEqual([11500]);
    const day = result.days.find((entry) => entry.planDayId === "r1");
    expect(day?.mainWorkout).toBe("10 km easy @ 6:05-6:42/km");
    expect(day?.rationale).toBe(
      "Auto-progression: Sunday's session is no longer missed, so Long Run returns to its planned distance.",
    );
    expect(day?.changes).toEqual([{ exercise: "long_run", kind: "raise", from: 9, to: 10, unit: "km" }]);
    expect(day?.inputsUsed.missedSessionHold).toBeUndefined();
    expect(result.engineState.missHolds).toEqual([]);
  });

  it("gives it back when the athlete runs long anyway before the held run comes up", () => {
    const first = adaptPlan(runInput());
    const result = adaptPlan(
      runInput({
        plan: withState({ ...first.engineState, adaptedLogIds: ["did"] }),
        upcoming: after(first),
        logs: [runLog("did", "2026-10-13", 9)],
      }),
    );

    expect(distances(result, "r1")).toEqual([10000]);
    expect(result.days.find((day) => day.planDayId === "r1")?.rationale).toBe(
      "Auto-progression: You have run long since Sunday's session, so it returns to its planned distance.",
    );
    expect(result.engineState.missHolds).toEqual([]);
  });

  it("lets the distances stand once the held long run has been done", () => {
    const first = adaptPlan(runInput());
    // Next Sunday's 9 km is logged: the plan has moved on from the hold.
    const result = adaptPlan(
      runInput({
        today: "2026-10-19",
        plan: withState({ ...first.engineState, adaptedLogIds: ["held"] }),
        upcoming: after(first).slice(1),
        logs: [runLog("held", "2026-10-18", 9)],
      }),
    );

    expect(result.days).toEqual([]);
    expect(result.engineState.missHolds).toEqual([]);
  });

  it("does not build past a later missed long run when the earlier one's hold is taken back", () => {
    // Two Sundays missed, read in one pass: only the earlier has anything to hold.
    const earlier = missedRun({ planDayId: "m1", date: "2026-10-04", km: 9 });
    const later = missedRun({ planDayId: "m2", date: MISSED_ON, km: 9.5 });
    const first = adaptPlan(runInput({ missed: [earlier, later] }));
    expect(first.engineState.missHolds?.map((hold) => hold.planDayId)).toEqual(["m1"]);
    expect(distances(first, "r1")).toEqual([9000]);

    const result = adaptPlan(
      runInput({
        plan: withState(first.engineState),
        upcoming: after(first),
        missed: [later],
        returnedPlanDays: new Map([["m1", "2026-10-16"]]),
      }),
    );

    // Back up from 9 km, but to the 9.5 km still not run — not to the plan's 10.
    expect(distances(result, "r1")).toEqual([9500]);
    expect(result.engineState.missHolds?.map((hold) => hold.planDayId)).toEqual(["m2"]);
  });

  it("restores only the rows that still read what the hold wrote", () => {
    const first = adaptPlan(runInput());
    const held = after(first);
    const edited = held.map((day) =>
      day.id === "r2" ? { ...day, sets: day.sets.map((set) => ({ ...set, distance: 8000 })) } : day,
    );
    const result = adaptPlan(
      runInput({
        plan: withState(first.engineState),
        upcoming: edited,
        missed: [],
        returnedPlanDays: new Map([["m", "2026-10-16"]]),
      }),
    );

    expect(distances(result, "r1")).toEqual([10000]);
    expect(distances(result, "r2")).toBeUndefined();
  });
});

describe("a missed long run — saying what it changes", () => {
  it("describes the hold as a distance, in the athlete's unit", () => {
    const holds = previewMissHolds(runInput(), missedRun());

    expect(describeMissHolds(holds, NEXT, "km")).toEqual([
      { exercise: "Long Run", date: "2026-10-18", scheme: "", from: 10, to: 9, unit: "km" },
    ]);
    expect(describeMissHolds(holds, NEXT, "miles")).toEqual([
      { exercise: "Long Run", date: "2026-10-18", scheme: "", from: 6.2, to: 5.6, unit: "mi" },
    ]);
  });

  it("reports only what still stands of a recorded hold", () => {
    const first = adaptPlan(runInput());
    const recorded = first.engineState.missHolds ?? [];

    const standing = standingMissHolds(runInput({ upcoming: after(first) }), recorded);
    expect(standing.at(0)?.sets).toHaveLength(3);

    // The athlete has put every distance back.
    const none = standingMissHolds(runInput(), recorded);
    expect(none.at(0)?.sets).toEqual([]);
    expect(describeMissHolds(none, NEXT)).toEqual([]);
  });
});

describe("rewriteRunDistance", () => {
  it("changes the one distance the text states", () => {
    expect(rewriteRunDistance("10 km easy @ 6:05-6:42/km", 10, 9, "km")).toBe("9 km easy @ 6:05-6:42/km");
    expect(rewriteRunDistance("Long run: 14.5km easy", 14.5, 13.5, "km")).toBe("Long run: 13.5km easy");
    expect(rewriteRunDistance("6.5 mi easy", 6.5, 6, "mi")).toBe("6 mi easy");
  });

  it("leaves a different number that only contains the distance alone", () => {
    // 9.5 inside 19.5, 10 as minutes, and "km" that is the start of another word.
    expect(rewriteRunDistance("19.5 km easy", 9.5, 9, "km")).toBe("19.5 km easy");
    expect(rewriteRunDistance("10 min easy then steady", 10, 9, "km")).toBe("10 min easy then steady");
    expect(rewriteRunDistance("10 kmh on the treadmill", 10, 9, "km")).toBe("10 kmh on the treadmill");
  });

  it("leaves the text alone when the distance is stated more than once", () => {
    const text = "10 km easy, last 10 km of the route";
    expect(rewriteRunDistance(text, 10, 9, "km")).toBe(text);
  });
});

function state(adaptedLogIds: string[]): PlanEngineState {
  return { version: 1, runVdot: null, adaptedLogIds, updatedAt: "t0" };
}
