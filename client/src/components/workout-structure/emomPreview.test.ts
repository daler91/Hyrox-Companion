import { describe, expect, it } from "vitest";

import { buildEmomPreview } from "./emomPreview";

describe("buildEmomPreview", () => {
  it("computes pattern length and cycle count for alternating patterns", () => {
    const result = buildEmomPreview({
      section: "main",
      blockType: "emom",
      emomDurationMinutes: 6,
      emomAlternating: true,
      steps: [
        { id: "1", type: "work", exercise: "Ski" },
        { id: "2", type: "rest" },
      ],
    });

    expect(result.error).toBeUndefined();
    expect(result.patternLength).toBe(2);
    expect(result.cycleCount).toBe(3);
    expect(result.minutes).toHaveLength(6);
    expect(result.minutes[1]?.step.type).toBe("rest");
    expect(result.minutes[5]?.cycle).toBe(3);
  });


  it("treats non-alternating EMOM as a one-minute repeating pattern", () => {
    const result = buildEmomPreview({
      section: "main",
      blockType: "emom",
      emomDurationMinutes: 6,
      emomAlternating: false,
      steps: [
        { id: "1", type: "work", exercise: "Ski" },
        { id: "2", type: "rest" },
        { id: "3", type: "work", exercise: "Burpee" },
      ],
    });

    expect(result.error).toBeUndefined();
    expect(result.patternLength).toBe(3);
    expect(result.cycleCount).toBe(6);
    expect(result.minutes[0]?.cycle).toBe(1);
    expect(result.minutes[5]?.cycle).toBe(6);
    expect(result.minutes.every((m) => m.step.id === "1")).toBe(true);
  });

  it("returns a clear error when alternating duration is not divisible by pattern", () => {
    const result = buildEmomPreview({
      section: "main",
      blockType: "emom",
      emomDurationMinutes: 5,
      emomAlternating: true,
      steps: [
        { id: "1", type: "work" },
        { id: "2", type: "rest" },
      ],
    });

    expect(result.minutes).toHaveLength(0);
    expect(result.error).toContain("must be divisible by pattern length");
  });
});
