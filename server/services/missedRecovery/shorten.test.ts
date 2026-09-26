import { describe, expect, it } from "vitest";

import { planShortenedPrescription, type ShortenableSet } from "./shorten";

function set(id: string, overrides: Partial<ShortenableSet> = {}): ShortenableSet {
  return {
    id,
    exerciseName: "back_squat",
    customLabel: null,
    blockId: null,
    setNumber: 1,
    sortOrder: 0,
    reps: null,
    plannedReps: null,
    distance: null,
    plannedDistance: null,
    time: null,
    plannedTime: null,
    distanceUnit: null,
    ...overrides,
  };
}

const KM = { blockCount: 0, distanceUnit: "km" } as const;

describe("planShortenedPrescription", () => {
  it("drops the last sets of an exercise with several", () => {
    const intervals = [1, 2, 3, 4, 5].map((n) =>
      set(`i${n}`, { exerciseName: "interval_run", setNumber: n, plannedDistance: 1000 }),
    );
    const plan = planShortenedPrescription(intervals, KM);

    expect(plan.deleteSetIds).toEqual(["i4", "i5"]);
    expect(plan.setUpdates).toEqual([]);
    expect(plan.changes).toEqual([{ label: "Intervals", from: "5 sets", to: "3 sets" }]);
    expect(plan.remainingSets.map((s) => s.id)).toEqual(["i1", "i2", "i3"]);
    expect(plan.notes).toEqual([]);
    expect(plan.needsInstruction).toBe(false);
  });

  it("keeps at least one set, and orders by set number rather than row order", () => {
    const squats = [set("b", { setNumber: 2, plannedReps: 5 }), set("a", { setNumber: 1, plannedReps: 5 })];
    const plan = planShortenedPrescription(squats, KM);
    expect(plan.deleteSetIds).toEqual(["b"]);
    expect(plan.changes).toEqual([{ label: "Back Squat", from: "2 sets", to: "1 set" }]);
  });

  it("scales a single continuous effort, keeping its pace", () => {
    const run = set("run", { exerciseName: "long_run", plannedDistance: 10000, plannedTime: 60 });
    const plan = planShortenedPrescription([run], KM);

    expect(plan.deleteSetIds).toEqual([]);
    expect(plan.setUpdates).toEqual([{ id: "run", plannedDistance: 6000, plannedTime: 36 }]);
    expect(plan.changes).toEqual([{ label: "Long Run", from: "10 km", to: "6 km" }]);
    expect(plan.remainingSets[0]).toMatchObject({ plannedDistance: 6000, plannedTime: 36 });
  });

  it("rounds a scaled distance in feet to tenths of a mile for a miles athlete", () => {
    const run = set("run", { exerciseName: "easy_run", distance: 26400, distanceUnit: "ft" }); // 5 mi
    const plan = planShortenedPrescription([run], { blockCount: 0, distanceUnit: "miles" });
    expect(plan.setUpdates).toEqual([{ id: "run", distance: 15840 }]); // 3 mi
    expect(plan.changes).toEqual([{ label: "Easy Run", from: "5 miles", to: "3 miles" }]);
  });

  it("scales a timed effort and high-rep station work, but not a heavy single", () => {
    const plan = planShortenedPrescription(
      [
        set("row", { exerciseName: "rowing", plannedTime: 20 }),
        set("wb", { exerciseName: "wall_balls", plannedReps: 100 }),
        set("dl", { exerciseName: "deadlift", plannedReps: 3 }),
        set("custom", { exerciseName: "custom", customLabel: "Sandbag carry", plannedDistance: 500 }),
      ],
      KM,
    );
    expect(plan.setUpdates).toEqual([
      { id: "row", plannedTime: 12 },
      { id: "wb", plannedReps: 60 },
      { id: "custom", plannedDistance: 300 },
    ]);
    expect(plan.changes).toEqual([
      { label: "Rowing", from: "20 min", to: "12 min" },
      { label: "Wall Balls", from: "100 reps", to: "60 reps" },
      { label: "Sandbag carry", from: "500 m", to: "300 m" },
    ]);
    expect(plan.remainingSets.find((s) => s.id === "dl")).toMatchObject({ plannedReps: 3 });
  });

  it("scales whichever of the planned and logged values a legacy row carries", () => {
    const plan = planShortenedPrescription([set("run", { exerciseName: "easy_run", distance: 8000 })], KM);
    expect(plan.setUpdates).toEqual([{ id: "run", distance: 4800 }]);
  });

  it("leaves timed blocks alone and says so", () => {
    const blockSets = [1, 2, 3].map((n) => set(`e${n}`, { blockId: "emom", setNumber: n, plannedReps: 10 }));
    const plan = planShortenedPrescription(blockSets, { blockCount: 1, distanceUnit: "km" });
    expect(plan.deleteSetIds).toEqual([]);
    expect(plan.setUpdates).toEqual([]);
    expect(plan.remainingSets).toHaveLength(3);
    expect(plan.notes).toEqual([
      {
        code: "blocks_not_trimmed",
        tone: "info",
        message: "Timed blocks stay as written — stop after about 60% of the rounds.",
      },
    ]);
    expect(plan.needsInstruction).toBe(true);
  });

  it("falls back to an instruction when there is no exercise table", () => {
    const plan = planShortenedPrescription([], KM);
    expect(plan.notes.map((note) => note.code)).toEqual(["not_trimmable"]);
    expect(plan.needsInstruction).toBe(true);
  });
});
