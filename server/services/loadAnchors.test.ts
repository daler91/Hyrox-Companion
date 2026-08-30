import { describe, expect, it } from "vitest";

import type { LoggedExerciseSetWithDate } from "../storage/shared";
import { buildLoadAnchors, describeLoadAnchorLines } from "./loadAnchors";

let nextId = 0;
function set(overrides: Partial<LoggedExerciseSetWithDate>): LoggedExerciseSetWithDate {
  return {
    id: `s${nextId++}`,
    workoutLogId: "w1",
    planDayId: null,
    exerciseName: "back_squat",
    customLabel: null,
    setNumber: 1,
    reps: 5,
    weight: 100,
    distance: null,
    time: null,
    rpe: null,
    notes: null,
    weightUnit: "kg",
    distanceUnit: null,
    plannedReps: null,
    plannedWeight: null,
    plannedDistance: null,
    plannedTime: null,
    date: "2026-06-01",
    ...overrides,
  } as LoggedExerciseSetWithDate;
}

describe("buildLoadAnchors", () => {
  it("anchors on the day's TOP set, so warm-ups do not drag the number", () => {
    // 60/100/140 in one session is a 2.3x spread — the same spread that forced
    // the unit-switch detector onto daily aggregation. The working weight is
    // the top of it.
    const anchors = buildLoadAnchors(
      [
        set({ date: "2026-06-01", weight: 60 }),
        set({ date: "2026-06-01", weight: 100 }),
        set({ date: "2026-06-01", weight: 140 }),
        set({ date: "2026-06-08", weight: 60 }),
        set({ date: "2026-06-08", weight: 140 }),
      ],
      "kg",
    );

    expect(anchors).toEqual([{ exercise: "back_squat", weight: 140, sessions: 2 }]);
  });

  it("takes the MEDIAN across days, so one heavy-single day does not become the anchor", () => {
    const anchors = buildLoadAnchors(
      [
        set({ date: "2026-06-01", weight: 100 }),
        set({ date: "2026-06-08", weight: 102.5 }),
        set({ date: "2026-06-15", weight: 140 }), // tested a heavy single
      ],
      "kg",
    );

    expect(anchors[0].weight).toBe(102.5);
  });

  it("needs at least two sessions — one is a data-entry error away from a bad anchor", () => {
    expect(buildLoadAnchors([set({ date: "2026-06-01" })], "kg")).toEqual([]);
  });

  it("keys custom exercises by their label, so two customs are not merged (audit H4)", () => {
    const anchors = buildLoadAnchors(
      [
        set({ date: "2026-06-01", exerciseName: "custom", customLabel: "Sled Push", weight: 80 }),
        set({ date: "2026-06-08", exerciseName: "custom", customLabel: "Sled Push", weight: 80 }),
        set({ date: "2026-06-01", exerciseName: "custom", customLabel: "Yoke Carry", weight: 120 }),
        set({ date: "2026-06-08", exerciseName: "custom", customLabel: "Yoke Carry", weight: 120 }),
      ],
      "kg",
    );

    expect(anchors.map((a) => a.exercise).sort((a, b) => a.localeCompare(b))).toEqual([
      "custom:Sled Push",
      "custom:Yoke Carry",
    ]);
  });

  it("reads each row through its own unit stamp (audit L4)", () => {
    // A 220 lb row and a 100 kg row are the same lift. For a kg athlete both
    // must land at ~100, not read 220 as kilograms.
    const anchors = buildLoadAnchors(
      [
        set({ date: "2026-06-01", weight: 220, weightUnit: "lbs" }),
        set({ date: "2026-06-08", weight: 100, weightUnit: "kg" }),
      ],
      "kg",
    );

    expect(anchors[0].weight).toBeCloseTo(100, 0);
  });

  it("falls back to the display unit for a legacy unstamped row", () => {
    // The storedWeightToKg contract: stamp first, athlete's preference for the
    // NULL tail. An unstamped 100 for a kg athlete is 100 kg.
    const anchors = buildLoadAnchors(
      [
        set({ date: "2026-06-01", weight: 100, weightUnit: null }),
        set({ date: "2026-06-08", weight: 100, weightUnit: null }),
      ],
      "kg",
    );

    expect(anchors[0].weight).toBe(100);
  });

  it("ignores rows that are not strength-shaped", () => {
    const anchors = buildLoadAnchors(
      [
        set({ date: "2026-06-01", weight: null }),
        set({ date: "2026-06-08", weight: 0 }),
        set({ date: "2026-06-15", weight: 100, reps: null }),
        set({ date: "2026-06-22", weight: 100, reps: 0 }),
      ],
      "kg",
    );

    expect(anchors).toEqual([]);
  });

  it("caps the table and leads with the most-practised lifts", () => {
    const sets: LoggedExerciseSetWithDate[] = [];
    for (let e = 0; e < 12; e++) {
      // Exercise e trains e+2 sessions, so higher-numbered lifts are
      // better-practised and must win the cap.
      for (let d = 0; d < e + 2; d++) {
        sets.push(set({ exerciseName: `lift_${e}`, date: `2026-06-${String(d + 1).padStart(2, "0")}` }));
      }
    }

    const anchors = buildLoadAnchors(sets, "kg");

    expect(anchors).toHaveLength(8);
    expect(anchors[0].exercise).toBe("lift_11");
    expect(anchors.map((a) => a.exercise)).not.toContain("lift_0");
  });

  it("rounds to the display grid of the unit it reports in", () => {
    // Medians of real logs land between plates; a kg anchor rounds to the
    // half, an lbs anchor to the whole — the same grid stored weights use.
    const kgAnchors = buildLoadAnchors(
      [set({ date: "2026-06-01", weight: 100 }), set({ date: "2026-06-08", weight: 102.6 })],
      "kg",
    );
    expect(kgAnchors[0].weight).toBe(101.5);

    const lbAnchors = buildLoadAnchors(
      [
        set({ date: "2026-06-01", weight: 225, weightUnit: "lbs" }),
        set({ date: "2026-06-08", weight: 230.4, weightUnit: "lbs" }),
      ],
      "lbs",
    );
    expect(lbAnchors[0].weight).toBe(228);
  });
});

describe("describeLoadAnchorLines", () => {
  it("emits nothing for an athlete with no anchors", () => {
    // A new athlete's prompt must be exactly what it was before anchors
    // existed — absence of history is not a prompt block.
    expect(describeLoadAnchorLines([], "kg")).toEqual([]);
  });

  it("states the table and the relative ramp rule", () => {
    const lines = describeLoadAnchorLines(
      [{ exercise: "back_squat", weight: 100, sessions: 6 }],
      "kg",
    ).join("\n");

    expect(lines).toContain("- back_squat: 100 kg (6 sessions)");
    // The rule each parallel call can evaluate ALONE — relative to the shared
    // anchors, never to another chunk's output it cannot see.
    expect(lines).toContain("anchor × 1.025^(k-1)");
    expect(lines).toContain("never above anchor × 1.05^(k-1)");
  });
});
