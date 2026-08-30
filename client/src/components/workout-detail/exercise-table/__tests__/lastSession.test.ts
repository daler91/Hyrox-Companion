import type { ExerciseSet } from "@shared/schema";
import { describe, expect, it } from "vitest";

import { buildUseLastPatches, pickLastSession, pickRecentSessions, summariseLastSession } from "../lastSession";
import { makeLoggedSet as set } from "./exerciseSetFixture";

const SQUAT = { exerciseName: "back_squat", category: "strength", weightUnit: "kg" } as const;

describe("pickLastSession", () => {
  it("returns the most recent session's sets, in set order", () => {
    const session = pickLastSession([
      set({ id: "a", date: "2026-06-10", setNumber: 2 }),
      set({ id: "b", date: "2026-06-10", setNumber: 1 }),
      set({ id: "c", date: "2026-06-01" }),
    ]);

    expect(session?.date).toBe("2026-06-10");
    expect(session?.sets.map((s) => s.id)).toEqual(["b", "a"]);
  });

  it("excludes the workout being viewed from its own history", () => {
    // Opening a completed session would otherwise quote its own numbers back.
    const session = pickLastSession(
      [
        set({ id: "today", date: "2026-06-10", workoutLogId: "w-current" }),
        set({ id: "before", date: "2026-06-03", workoutLogId: "w-old" }),
      ],
      "w-current",
    );

    expect(session?.date).toBe("2026-06-03");
    expect(session?.sets.map((s) => s.id)).toEqual(["before"]);
  });

  it("returns null when the only session is the one being viewed", () => {
    expect(
      pickLastSession([set({ date: "2026-06-10", workoutLogId: "w-current" })], "w-current"),
    ).toBeNull();
  });

  it("returns ONE session when the athlete trained twice that day (audit M13)", () => {
    // Selecting on the date alone merged both logs, so "Last time" read as 4x5
    // instead of 2x5 — and "Next" then progressed from the doubled volume.
    const session = pickLastSession([
      set({ id: "am1", date: "2026-06-10", workoutLogId: "w-am", timeOfDayMin: 420, setNumber: 1 }),
      set({ id: "am2", date: "2026-06-10", workoutLogId: "w-am", timeOfDayMin: 420, setNumber: 2 }),
      set({ id: "pm1", date: "2026-06-10", workoutLogId: "w-pm", timeOfDayMin: 1080, setNumber: 1 }),
      set({ id: "pm2", date: "2026-06-10", workoutLogId: "w-pm", timeOfDayMin: 1080, setNumber: 2 }),
    ]);

    expect(session?.sets).toHaveLength(2);
    expect(session?.sets.map((s) => s.id)).toEqual(["pm1", "pm2"]);
  });

  it("prefers the later time of day, whatever order the rows arrive in", () => {
    const session = pickLastSession([
      set({ id: "pm1", date: "2026-06-10", workoutLogId: "w-pm", timeOfDayMin: 1080 }),
      set({ id: "am1", date: "2026-06-10", workoutLogId: "w-am", timeOfDayMin: 420 }),
    ]);

    expect(session?.sets.map((s) => s.id)).toEqual(["pm1"]);
  });

  it("still returns a single session when neither log recorded a time", () => {
    // Which one is a coin-toss without a time, but picking one is right either
    // way — merging two never was.
    const session = pickLastSession([
      set({ id: "a", date: "2026-06-10", workoutLogId: "w-1", timeOfDayMin: null }),
      set({ id: "b", date: "2026-06-10", workoutLogId: "w-2", timeOfDayMin: null }),
    ]);

    expect(session?.sets).toHaveLength(1);
  });

  it("prefers a log that recorded a time over one that did not", () => {
    const session = pickLastSession([
      set({ id: "timed", date: "2026-06-10", workoutLogId: "w-timed", timeOfDayMin: 600 }),
      set({ id: "untimed", date: "2026-06-10", workoutLogId: "w-untimed", timeOfDayMin: null }),
    ]);

    expect(session?.sets.map((s) => s.id)).toEqual(["timed"]);
  });

  it("excludes the viewed workout before choosing the day's session", () => {
    // The exclusion has to happen first: otherwise the workout being edited can
    // win the same-day tie-break and then be filtered to nothing.
    const session = pickLastSession(
      [
        set({ id: "earlier", date: "2026-06-10", workoutLogId: "w-am", timeOfDayMin: 420 }),
        set({ id: "current", date: "2026-06-10", workoutLogId: "w-now", timeOfDayMin: 1080 }),
      ],
      "w-now",
    );

    expect(session?.sets.map((s) => s.id)).toEqual(["earlier"]);
  });

  it("returns null for an empty history", () => {
    expect(pickLastSession([])).toBeNull();
  });
});

describe("summariseLastSession", () => {
  it("reads as the prescription it was", () => {
    const session = {
      date: "2026-06-10",
      sets: [set({ id: "a" }), set({ id: "b" }), set({ id: "c" }), set({ id: "d" })],
    };
    const prescription = summariseLastSession(session, { ...SQUAT, distanceUnit: "km" });

    expect(prescription.visual.map((s) => s.text)).toEqual(["4", "8 reps", "80 kg"]);
    expect(prescription.aria).toBe("4 sets of 8 reps at 80 kg");
  });

  it("says the load varies rather than quoting the first set", () => {
    const session = {
      date: "2026-06-10",
      sets: [set({ id: "a", weight: 80 }), set({ id: "b", weight: 90 })],
    };
    const prescription = summariseLastSession(session, { ...SQUAT, distanceUnit: "km" });

    expect(prescription.aria).toContain("varies");
  });

  it("uses distance as the metric for a run, in the athlete's unit", () => {
    const session = {
      date: "2026-06-10",
      sets: [
        set({
          id: "a",
          exerciseName: "easy_run",
          category: "running",
          reps: null,
          weight: null,
          distance: 5000,
        }),
      ],
    };
    const prescription = summariseLastSession(session, {
      exerciseName: "easy_run",
      category: "running",
      weightUnit: "kg",
      distanceUnit: "km",
    });

    // Workout distances render in metres for km athletes (getWorkoutDistanceDisplay),
    // exactly as the current-sets line above it does.
    expect(prescription.aria).toBe("1 set of 5000 m");
  });
});

describe("buildUseLastPatches", () => {
  const current: ExerciseSet[] = [
    set({ id: "c1", reps: null, weight: null }),
    set({ id: "c2", reps: null, weight: null }),
  ];

  it("fills the current sets from the last session's, pairwise", () => {
    const patches = buildUseLastPatches(current, [
      set({ id: "l1", reps: 8, weight: 80 }),
      set({ id: "l2", reps: 6, weight: 85 }),
    ]);

    expect(patches).toEqual([
      { setId: "c1", patch: { reps: 8, weight: 80 } },
      { setId: "c2", patch: { reps: 6, weight: 85 } },
    ]);
  });

  it("stops at the shorter of the two — it fills, it doesn't add or remove sets", () => {
    const patches = buildUseLastPatches(current, [set({ id: "l1", reps: 8, weight: 80 })]);
    expect(patches.map((p) => p.setId)).toEqual(["c1"]);
  });

  it("skips fields the last session left blank rather than erasing them", () => {
    const patches = buildUseLastPatches(
      [set({ id: "c1" })],
      [set({ id: "l1", reps: 8, weight: null })],
    );
    expect(patches).toEqual([{ setId: "c1", patch: { reps: 8 } }]);
  });

  it("produces nothing when there is nothing to carry over", () => {
    expect(buildUseLastPatches(current, [set({ id: "l1", reps: null, weight: null })])).toEqual([]);
    expect(buildUseLastPatches(current, [])).toEqual([]);
  });
});

describe("pickRecentSessions", () => {
  it("returns sessions newest first, one per workout log", () => {
    const sessions = pickRecentSessions(
      [
        set({ date: "2026-06-01", workoutLogId: "w1", weight: 80 }),
        set({ date: "2026-06-08", workoutLogId: "w2", weight: 85 }),
        set({ date: "2026-06-15", workoutLogId: "w3", weight: 90 }),
      ],
      null,
      2,
    );

    expect(sessions.map((s) => s.date)).toEqual(["2026-06-15", "2026-06-08"]);
    expect(sessions[0].sets[0].weight).toBe(90);
    expect(sessions[1].sets[0].weight).toBe(85);
  });

  it("splits two same-day logs into two sessions, later time first", () => {
    // The single-session pick chose the later log and IGNORED the earlier one
    // (audit M13). Applied repeatedly, the earlier log is not lost — it is the
    // previous session, which is exactly what the missed-twice deload compares
    // against for a twice-a-day athlete.
    const sessions = pickRecentSessions(
      [
        set({ date: "2026-06-15", workoutLogId: "am", timeOfDayMin: 8 * 60, weight: 80 }),
        set({ date: "2026-06-15", workoutLogId: "pm", timeOfDayMin: 18 * 60, weight: 90 }),
      ],
      null,
      2,
    );

    expect(sessions).toHaveLength(2);
    expect(sessions[0].sets[0].weight).toBe(90);
    expect(sessions[1].sets[0].weight).toBe(80);
  });

  it("excludes the current workout log before picking", () => {
    const sessions = pickRecentSessions(
      [
        set({ date: "2026-06-08", workoutLogId: "w-old", weight: 80 }),
        set({ date: "2026-06-15", workoutLogId: "w-current", weight: 90 }),
      ],
      "w-current",
      2,
    );

    expect(sessions).toHaveLength(1);
    expect(sessions[0].sets[0].weight).toBe(80);
  });

  it("stops at the limit and at the end of history", () => {
    const history = [
      set({ date: "2026-06-01", workoutLogId: "w1" }),
      set({ date: "2026-06-08", workoutLogId: "w2" }),
    ];

    expect(pickRecentSessions(history, null, 1)).toHaveLength(1);
    expect(pickRecentSessions(history, null, 5)).toHaveLength(2);
    expect(pickRecentSessions([], null, 2)).toHaveLength(0);
  });

  it("agrees with pickLastSession on the newest session", () => {
    // The single pick is defined as the first of the many; they must never
    // diverge, or "Last time" and the deload's idea of last time would differ.
    const history = [
      set({ date: "2026-06-15", workoutLogId: "am", timeOfDayMin: 8 * 60 }),
      set({ date: "2026-06-15", workoutLogId: "pm", timeOfDayMin: 18 * 60 }),
      set({ date: "2026-06-08", workoutLogId: "w1" }),
    ];

    expect(pickRecentSessions(history, null, 3)[0]).toEqual(pickLastSession(history, null));
  });
});
