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

  it("falls back to a set-count heuristic when blocks carry no timing", () => {
    const e = estimatePlannedSession({
      exerciseSets: [
        { plannedReps: 10 },
        { plannedReps: 10 },
        { plannedReps: 10 },
        { plannedReps: 10 },
      ],
    });
    expect(e.source).toBe("sets");
    expect(e.durationMin).toBe(12); // 4 × 3
    expect(e.rpe).toBeNull(); // no block format to infer from
  });

  it("prefers planned set time over the count heuristic when larger", () => {
    const e = estimatePlannedSession({ exerciseSets: [{ plannedTime: 1800 }] });
    expect(e.durationMin).toBe(30);
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
});
