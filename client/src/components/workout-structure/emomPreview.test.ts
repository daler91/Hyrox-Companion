import { describe, expect, it } from "vitest";

import { buildEmomPreview } from "./emomPreview";

describe("buildEmomPreview", () => {
  it("rotates the movements one per minute, in order", () => {
    const result = buildEmomPreview({
      section: "main",
      blockType: "emom",
      emomDurationMinutes: 6,
      steps: [
        { id: "1", type: "work", exercise: "Ski" },
        { id: "2", type: "rest" },
      ],
    });

    expect(result.patternLength).toBe(2);
    expect(result.cycleCount).toBe(3);
    expect(result.minutes).toHaveLength(6);
    expect(result.minutes[0]?.step.id).toBe("1");
    expect(result.minutes[1]?.step.type).toBe("rest");
    expect(result.minutes[5]?.cycle).toBe(3);
  });

  it("loops back to the first movement when the block runs longer than the list", () => {
    const result = buildEmomPreview({
      section: "main",
      blockType: "emom",
      emomDurationMinutes: 5,
      steps: [
        { id: "1", type: "work", exercise: "Ski" },
        { id: "2", type: "work", exercise: "Burpee" },
      ],
    });

    expect(result.minutes).toHaveLength(5);
    expect(result.cycleCount).toBe(3);
    expect(result.minutes[4]?.step.id).toBe("1");
  });

  it("stops at the configured length when it is shorter than the movement list", () => {
    const result = buildEmomPreview({
      section: "main",
      blockType: "emom",
      emomDurationMinutes: 2,
      steps: [
        { id: "1", type: "work", exercise: "A" },
        { id: "2", type: "work", exercise: "B" },
        { id: "3", type: "work", exercise: "C" },
      ],
    });

    expect(result.minutes).toHaveLength(2);
    expect(result.cycleCount).toBe(1);
    expect(result.minutes.map((m) => m.step.id)).toEqual(["1", "2"]);
  });

  it("returns an empty schedule for non-EMOM blocks or missing length", () => {
    const notEmom = buildEmomPreview({
      section: "main",
      blockType: "amrap",
      steps: [{ id: "1", type: "work", exercise: "Row" }],
    });
    expect(notEmom.minutes).toHaveLength(0);

    const noDuration = buildEmomPreview({
      section: "main",
      blockType: "emom",
      steps: [{ id: "1", type: "work", exercise: "Row" }],
    });
    expect(noDuration.minutes).toHaveLength(0);
  });
});
