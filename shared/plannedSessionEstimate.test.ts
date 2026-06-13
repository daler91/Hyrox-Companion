import { describe, expect, it } from "vitest";

import { estimatePlannedSession } from "./plannedSessionEstimate";

describe("estimatePlannedSession", () => {
  it("returns nulls when there are no blocks or sets", () => {
    expect(estimatePlannedSession({})).toEqual({ durationMin: null, rpe: null, source: "none" });
  });

  it("sums explicit block durations and infers RPE from the hardest main block", () => {
    const e = estimatePlannedSession({
      structureBlocks: [
        { sectionType: "warmup", formatType: "steady", durationMinutes: 10 },
        { sectionType: "main", formatType: "for_time", timeCapMinutes: 20 },
        { sectionType: "cooldown", formatType: "steady", durationSeconds: 300 },
      ],
    });
    expect(e.source).toBe("structure");
    expect(e.durationMin).toBe(35); // 10 + 20 + 5
    expect(e.rpe).toBe(8); // for_time main block
  });

  it("estimates interval/EMOM blocks from rounds × (work + rest)", () => {
    const e = estimatePlannedSession({
      structureBlocks: [
        {
          sectionType: "main",
          formatType: "emom",
          roundCount: 10,
          workSeconds: 40,
          restSeconds: 20,
        },
      ],
    });
    expect(e.durationMin).toBe(10); // 10 × 60s = 600s
    expect(e.rpe).toBe(7);
  });

  it("falls back to a per-set floor when sets carry no time/distance", () => {
    const e = estimatePlannedSession({
      exerciseSets: [
        { plannedReps: 10 },
        { plannedReps: 10 },
        { plannedReps: 10 },
        { plannedReps: 10 },
      ],
    });
    expect(e.source).toBe("sets");
    expect(e.durationMin).toBe(12); // 4 × 3-min floor
    expect(e.rpe).toBeNull(); // unnamed sets → no intensity signal
  });

  it("reads planned set time as minutes", () => {
    // Stored time is minutes app-wide; a 30-min prescribed run is 30 min, not 0.5.
    expect(estimatePlannedSession({ exerciseSets: [{ plannedTime: 30 }] }).durationMin).toBe(30);
    // …and is still clamped to the sane range.
    expect(estimatePlannedSession({ exerciseSets: [{ plannedTime: 200 }] }).durationMin).toBe(180);
  });

  it("clamps the estimate to a sane range", () => {
    const long = estimatePlannedSession({
      structureBlocks: [{ sectionType: "main", formatType: "steady", durationMinutes: 600 }],
    });
    expect(long.durationMin).toBe(180);
    const short = estimatePlannedSession({
      structureBlocks: [{ sectionType: "main", formatType: "amrap", durationSeconds: 120 }],
    });
    expect(short.durationMin).toBe(10);
  });

  it("uses the hardest of any block when there is no main section", () => {
    const e = estimatePlannedSession({
      structureBlocks: [
        { sectionType: "accessory", formatType: "steady", durationMinutes: 15 },
        { sectionType: "accessory", formatType: "amrap", timeCapMinutes: 8 },
      ],
    });
    expect(e.rpe).toBe(8);
  });

  // --- Distance-aware estimation (the 9000 m recovery-run bug and friends) ---

  it("converts a distance-only recovery run to minutes and an easy RPE", () => {
    const e = estimatePlannedSession({
      exerciseSets: [{ exerciseName: "recovery_run", plannedDistance: 9000 }],
    });
    expect(e.source).toBe("sets");
    expect(e.durationMin).toBeGreaterThanOrEqual(50); // ~54 min, not the old 10-min floor
    expect(e.durationMin).toBeLessThanOrEqual(58);
    expect(e.rpe).toBe(2); // recovery run is low intensity
  });

  it("normalizes a human exercise label the same as its canonical key", () => {
    const byLabel = estimatePlannedSession({
      exerciseSets: [{ exerciseName: "Recovery Run", plannedDistance: 9000 }],
    });
    const byKey = estimatePlannedSession({
      exerciseSets: [{ exerciseName: "recovery_run", plannedDistance: 9000 }],
    });
    expect(byLabel).toEqual(byKey);
  });

  it("paces a tempo run faster (and harder) than a recovery run of equal distance", () => {
    const recovery = estimatePlannedSession({
      exerciseSets: [{ exerciseName: "recovery_run", plannedDistance: 5000 }],
    });
    const tempo = estimatePlannedSession({
      exerciseSets: [{ exerciseName: "tempo_run", plannedDistance: 5000 }],
    });
    expect(tempo.durationMin!).toBeLessThan(recovery.durationMin!);
    expect(tempo.rpe).toBe(6);
  });

  it("paces rowing by its own (fast) erg pace, clamped to the minimum", () => {
    const e = estimatePlannedSession({
      exerciseSets: [{ exerciseName: "rowing", plannedDistance: 2000 }],
    });
    expect(e.durationMin).toBe(10); // ~8.3 min → MIN clamp
    expect(e.rpe).toBe(5);
  });

  it("does not pace a bike erg like a run", () => {
    const e = estimatePlannedSession({
      exerciseSets: [{ exerciseName: "bike_erg", plannedDistance: 20000 }],
    });
    expect(e.durationMin).toBe(30); // 20000 m × 0.09 s/m ÷ 60; a run pace would be ~115 min
  });

  it("sums a mixed strength + run session and takes the hardest RPE", () => {
    const e = estimatePlannedSession({
      exerciseSets: [
        { exerciseName: "back_squat", plannedReps: 5 },
        { exerciseName: "easy_run", plannedDistance: 5000 },
      ],
    });
    expect(e.durationMin).toBe(31); // 3-min squat floor + 27.5-min run
    expect(e.rpe).toBe(6); // max(strength 6, easy_run 3)
  });

  it("prefers an explicit prescribed time over the distance estimate", () => {
    const e = estimatePlannedSession({
      exerciseSets: [{ exerciseName: "recovery_run", plannedDistance: 9000, plannedTime: 40 }],
    });
    expect(e.durationMin).toBe(40);
  });

  it("adds a rest uplift for interval-style running split across sets", () => {
    const e = estimatePlannedSession({
      exerciseSets: Array.from({ length: 6 }, () => ({
        exerciseName: "interval_run",
        plannedDistance: 400,
      })),
    });
    expect(e.durationMin).toBe(18); // 6 × (400 m work × 1.8 rest uplift)
    expect(e.rpe).toBe(8);
  });

  it("uses a generic fallback pace/RPE for an unrecognized distance exercise", () => {
    const e = estimatePlannedSession({
      exerciseSets: [{ exerciseName: "moon jog", plannedDistance: 6000 }],
    });
    expect(e.durationMin).toBeGreaterThanOrEqual(30); // ~34.5 min at the fallback pace
    expect(e.durationMin).toBeLessThanOrEqual(40);
    expect(e.rpe).toBe(5);
  });

  it("converts stored feet to meters for miles-unit users", () => {
    const e = estimatePlannedSession({
      exerciseSets: [{ exerciseName: "recovery_run", plannedDistance: 29528 }], // ≈ 9000 m
      distanceUnit: "miles",
    });
    expect(e.durationMin).toBeGreaterThanOrEqual(50);
    expect(e.durationMin).toBeLessThanOrEqual(58);
  });

  it("keeps short carries/sleds on the per-set floor instead of pacing them", () => {
    const e = estimatePlannedSession({
      exerciseSets: [{ exerciseName: "farmers_carry", plannedDistance: 100 }],
    });
    expect(e.durationMin).toBe(10); // floor (3) → MIN clamp, not a sub-minute distance time
  });

  it("ignores a zero or negative distance", () => {
    expect(
      estimatePlannedSession({ exerciseSets: [{ exerciseName: "easy_run", plannedDistance: 0 }] })
        .durationMin,
    ).toBe(10);
    expect(
      estimatePlannedSession({
        exerciseSets: [{ exerciseName: "easy_run", plannedDistance: -500 }],
      }).durationMin,
    ).toBe(10);
  });

  it("lets structure-block timing win over a distance set", () => {
    const e = estimatePlannedSession({
      structureBlocks: [{ sectionType: "main", formatType: "steady", timeCapMinutes: 20 }],
      exerciseSets: [{ exerciseName: "recovery_run", plannedDistance: 9000 }],
    });
    expect(e.source).toBe("structure");
    expect(e.durationMin).toBe(20);
    expect(e.rpe).toBe(5); // block format wins over the set RPE
  });

  it("clamps a very long distance run to the max", () => {
    const e = estimatePlannedSession({
      exerciseSets: [{ exerciseName: "long_run", plannedDistance: 60000 }],
    });
    expect(e.durationMin).toBe(180);
  });

  it("scales running pace by a personalized ratio, grounded to a sane band", () => {
    const generic = estimatePlannedSession({
      exerciseSets: [{ exerciseName: "recovery_run", plannedDistance: 9000 }],
    });
    const faster = estimatePlannedSession({
      exerciseSets: [{ exerciseName: "recovery_run", plannedDistance: 9000 }],
      runPaceRatio: 0.85,
    });
    expect(faster.durationMin!).toBeLessThan(generic.durationMin!);

    // An extreme ratio is clamped, so it never produces an extreme duration.
    const clampedExtreme = estimatePlannedSession({
      exerciseSets: [{ exerciseName: "recovery_run", plannedDistance: 9000 }],
      runPaceRatio: 0.1,
    });
    const atLowerBound = estimatePlannedSession({
      exerciseSets: [{ exerciseName: "recovery_run", plannedDistance: 9000 }],
      runPaceRatio: 0.8,
    });
    expect(clampedExtreme.durationMin).toBe(atLowerBound.durationMin);
  });
});
