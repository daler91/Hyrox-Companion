import { describe, expect, it } from "vitest";

import { configToStructureBlock, structureBlockToConfig } from "./configToStructureBlocks";
import type { WorkoutStructureConfig } from "./types";

describe("configToStructureBlock", () => {
  it("maps an EMOM config with steps to a structure block", () => {
    const config: WorkoutStructureConfig = {
      section: "main",
      blockType: "emom",
      emomDurationMinutes: 12,
      emomAlternating: false,
      steps: [
        { id: "a", type: "work", exercise: "Burpee Broad Jump", target: "10 reps" },
        { id: "b", type: "work", exercise: "Wall Balls", target: "12 reps" },
      ],
    };

    const block = configToStructureBlock(config, { sequenceOrder: 0, sortOrder: 0 });

    expect(block).toMatchObject({
      sectionType: "main",
      formatType: "emom",
      durationMinutes: 12,
      sequenceOrder: 0,
      sortOrder: 0,
    });
    expect(block.steps).toHaveLength(2);
    expect(block.steps[0]).toMatchObject({
      stepNumber: 1,
      stepType: "work",
      exerciseName: "Burpee Broad Jump",
      minuteIndex: 1,
    });
    expect(block.steps[1]).toMatchObject({ stepNumber: 2, minuteIndex: 2 });
  });

  it("falls back to fallbackExerciseName for work steps without an exercise", () => {
    const config: WorkoutStructureConfig = {
      section: "main",
      blockType: "emom",
      emomDurationMinutes: 5,
      emomAlternating: false,
      steps: [{ id: "a", type: "work" }],
    };

    const block = configToStructureBlock(config, { fallbackExerciseName: "Sandbag Lunges" });

    expect(block.steps[0].exerciseName).toBe("Sandbag Lunges");
  });

  it("omits exerciseName on rest steps", () => {
    const config: WorkoutStructureConfig = {
      section: "main",
      blockType: "emom",
      emomDurationMinutes: 4,
      emomAlternating: false,
      steps: [
        { id: "a", type: "work", exercise: "Row" },
        { id: "b", type: "rest" },
      ],
    };

    const block = configToStructureBlock(config);

    expect(block.steps[0].exerciseName).toBe("Row");
    expect(block.steps[1].exerciseName).toBeUndefined();
  });

  it("defaults durationMinutes to step count for EMOM when not provided", () => {
    const config: WorkoutStructureConfig = {
      section: "main",
      blockType: "emom",
      emomAlternating: false,
      steps: [
        { id: "a", type: "work", exercise: "A" },
        { id: "b", type: "work", exercise: "B" },
        { id: "c", type: "work", exercise: "C" },
      ],
    };

    const block = configToStructureBlock(config);

    expect(block.durationMinutes).toBe(3);
  });

  it("does not set minuteIndex for non-EMOM blocks", () => {
    const config: WorkoutStructureConfig = {
      section: "main",
      blockType: "amrap",
      steps: [{ id: "a", type: "work", exercise: "Pull-ups" }],
    };

    const block = configToStructureBlock(config);

    expect(block.steps[0].minuteIndex).toBeUndefined();
    expect(block.durationMinutes).toBeUndefined();
  });
});

describe("structureBlockToConfig", () => {
  it("round-trips an EMOM block back into editor config", () => {
    const original: WorkoutStructureConfig = {
      section: "main",
      blockType: "emom",
      emomDurationMinutes: 8,
      emomAlternating: false,
      steps: [
        { id: "a", type: "work", exercise: "Box Jumps" },
        { id: "b", type: "work", exercise: "Push-ups" },
      ],
    };

    const block = configToStructureBlock(original);
    const restored = structureBlockToConfig(block);

    expect(restored.section).toBe("main");
    expect(restored.blockType).toBe("emom");
    expect(restored.emomDurationMinutes).toBe(8);
    expect(restored.steps).toHaveLength(2);
    expect(restored.steps[0]).toMatchObject({ type: "work", exercise: "Box Jumps" });
    expect(restored.steps[1]).toMatchObject({ type: "work", exercise: "Push-ups" });
  });

  it("coerces 'activation' section to 'warmup'", () => {
    const restored = structureBlockToConfig({
      sectionType: "activation",
      formatType: "steady",
      steps: [{ stepNumber: 1, stepType: "work", exerciseName: "Cossack Squat" }],
    });

    expect(restored.section).toBe("warmup");
  });

  it("coerces 'quality' format to 'steady'", () => {
    const restored = structureBlockToConfig({
      sectionType: "main",
      formatType: "quality",
      steps: [{ stepNumber: 1, stepType: "work", exerciseName: "Pistol Squat" }],
    });

    expect(restored.blockType).toBe("steady");
  });
});
