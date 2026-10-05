import type { StructureBlockInput } from "@shared/schema";
import { describe, expect, it } from "vitest";

import { applyConfigToStructureBlock, configToStructureBlock, structureBlockToConfig } from "./configToStructureBlocks";
import type { WorkoutStructureConfig } from "./types";

describe("configToStructureBlock", () => {
  it("maps an EMOM config with steps to a structure block", () => {
    const config: WorkoutStructureConfig = {
      section: "main",
      blockType: "emom",
      emomDurationMinutes: 12,      steps: [
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
      emomDurationMinutes: 5,      steps: [{ id: "a", type: "work" }],
    };

    const block = configToStructureBlock(config, { fallbackExerciseName: "Sandbag Lunges" });

    expect(block.steps[0].exerciseName).toBe("Sandbag Lunges");
  });

  it("omits exerciseName on rest steps", () => {
    const config: WorkoutStructureConfig = {
      section: "main",
      blockType: "emom",
      emomDurationMinutes: 4,      steps: [
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
      blockType: "emom",      steps: [
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
      emomDurationMinutes: 8,      steps: [
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

describe("applyConfigToStructureBlock (CL14)", () => {
  const stored: StructureBlockInput = {
    id: "block-1",
    sectionType: "activation",
    formatType: "quality",
    instructions: "Hold race pace",
    workSeconds: 40,
    restSeconds: 20,
    sequenceOrder: 2,
    sortOrder: 2,
    steps: [
      {
        stepNumber: 1,
        stepType: "work",
        exerciseName: "wall_balls",
        category: "functional",
        customLabel: "Wall balls 9kg",
        stepRole: "quality",
        intensity: { rpe: 8 },
        tempo: { pattern: "fast" },
        groupId: "g-1",
        targets: { targetReps: 20, targetWeight: 9, instructions: "Unbroken" },
      },
      {
        stepNumber: 2,
        stepType: "work",
        exerciseName: "burpees",
        category: "conditioning",
        stepRole: "work",
        targets: { targetReps: 10, durationSeconds: 30 },
      },
    ],
  };
  const ids = ["s1", "s2"];

  it("returns every stored field when nothing changed", () => {
    const view = structureBlockToConfig(stored, ids);

    expect(applyConfigToStructureBlock(stored, ids, view)).toEqual(stored);
  });

  it("keeps 'quality' and 'activation' instead of the editor's steady / warmup", () => {
    const view = structureBlockToConfig(stored, ids);
    expect(view.blockType).toBe("steady");
    expect(view.section).toBe("warmup");

    const next = applyConfigToStructureBlock(stored, ids, {
      ...view,
      steps: view.steps.map((step) => (step.id === "s2" ? { ...step, durationSeconds: 45 } : step)),
    });

    expect(next.formatType).toBe("quality");
    expect(next.sectionType).toBe("activation");
    expect(next).toMatchObject({ instructions: "Hold race pace", workSeconds: 40, restSeconds: 20, sortOrder: 2 });
  });

  it("writes only the edited duration and keeps the step's other targets and metadata", () => {
    const view = structureBlockToConfig(stored, ids);

    const next = applyConfigToStructureBlock(stored, ids, {
      ...view,
      steps: view.steps.map((step) => (step.id === "s1" ? { ...step, durationSeconds: 45 } : step)),
    });

    expect(next.steps[0]).toEqual({
      ...stored.steps[0],
      targets: { targetReps: 20, targetWeight: 9, instructions: "Unbroken", durationSeconds: 45 },
    });
    expect(next.steps[1]).toEqual(stored.steps[1]);
  });

  it("carries each step's fields with it when steps are reordered", () => {
    const view = structureBlockToConfig(stored, ids);

    const next = applyConfigToStructureBlock(stored, ids, { ...view, steps: [...view.steps].reverse() });

    expect(next.steps[0]).toEqual({ ...stored.steps[1], stepNumber: 1 });
    expect(next.steps[1]).toEqual({ ...stored.steps[0], stepNumber: 2 });
  });

  it("drops the exercise and performance targets when a step becomes a rest", () => {
    const view = structureBlockToConfig(stored, ids);

    const next = applyConfigToStructureBlock(stored, ids, {
      ...view,
      steps: view.steps.map((step) =>
        step.id === "s1" ? { ...step, type: "rest" as const, exercise: undefined } : step,
      ),
    });

    expect(next.steps[0]).toMatchObject({
      stepType: "rest",
      exerciseName: null,
      customLabel: null,
      category: null,
      stepRole: null,
      targets: { instructions: "Unbroken" },
    });
  });

  it("builds a step added in the editor from the editor's view", () => {
    const view = structureBlockToConfig(stored, ids);

    const next = applyConfigToStructureBlock(stored, ids, {
      ...view,
      steps: [...view.steps, { id: "s3", type: "work", exercise: "Unassigned exercise" }],
    });

    expect(next.steps[2]).toEqual({
      stepNumber: 3,
      stepType: "work",
      exerciseName: "Unassigned exercise",
      minuteIndex: undefined,
      targets: undefined,
    });
  });

  it("reuses the step ids it is given", () => {
    expect(structureBlockToConfig(stored, ids).steps.map((step) => step.id)).toEqual(ids);
  });
});

describe("applyConfigToStructureBlock keeps stored EMOM minutes (CL14)", () => {
  // An every-other-minute EMOM: work on minutes 2, 4 and 6.
  const evenMinutes: StructureBlockInput = {
    id: "block-even",
    sectionType: "main",
    formatType: "emom",
    durationMinutes: 6,
    steps: [
      { stepNumber: 1, minuteIndex: 2, stepType: "work", exerciseName: "wall_balls" },
      { stepNumber: 2, minuteIndex: 4, stepType: "work", exerciseName: "burpees" },
      { stepNumber: 3, minuteIndex: 6, stepType: "work", exerciseName: "row" },
    ],
  };
  const oddMinutes: StructureBlockInput = {
    ...evenMinutes,
    id: "block-odd",
    steps: evenMinutes.steps.map((step) => ({ ...step, minuteIndex: (step.minuteIndex ?? 0) - 1 })),
  };
  const ids = ["s1", "s2", "s3"];
  const minutes = (block: StructureBlockInput) => block.steps.map((step) => step.minuteIndex);
  const byMinute = (block: StructureBlockInput) => block.steps.map((step) => [step.exerciseName, step.minuteIndex]);
  const appended = (block: StructureBlockInput) => {
    const view = structureBlockToConfig(block, ids);
    return applyConfigToStructureBlock(block, ids, {
      ...view,
      steps: [...view.steps, { id: "s4", type: "work", exercise: "Unassigned exercise" }],
    });
  };

  it("keeps every step's minute when an edit moves none of them", () => {
    const view = structureBlockToConfig(evenMinutes, ids);

    const next = applyConfigToStructureBlock(evenMinutes, ids, {
      ...view,
      steps: view.steps.map((step) => (step.id === "s2" ? { ...step, durationSeconds: 40 } : step)),
    });

    expect(minutes(next)).toEqual([2, 4, 6]);
  });

  it("keeps 2, 4 and 6 and puts an appended step after the last one", () => {
    expect(minutes(appended(evenMinutes))).toEqual([2, 4, 6, 7]);
  });

  it("never runs an appended step before the step it follows", () => {
    expect(minutes(appended(oddMinutes))).toEqual([1, 3, 5, 6]);
  });

  it("keeps an unmoved step's minute when the steps after it swap", () => {
    const view = structureBlockToConfig(evenMinutes, ids);
    const [wallBalls, burpees, row] = view.steps;

    const next = applyConfigToStructureBlock(evenMinutes, ids, { ...view, steps: [wallBalls, row, burpees] });

    // Each moved step takes the minute of the slot it moved into.
    expect(byMinute(next)).toEqual([["wall_balls", 2], ["row", 4], ["burpees", 6]]);
  });

  it("moves the steps after a removed one through the stored minutes", () => {
    const view = structureBlockToConfig(evenMinutes, ids);

    const next = applyConfigToStructureBlock(evenMinutes, ids, { ...view, steps: view.steps.slice(1) });

    expect(byMinute(next)).toEqual([["burpees", 2], ["row", 4]]);
  });

  it("gives a step moved into another's slot that slot's minute, not one a kept step holds", () => {
    // Ski moves to position 3, whose minute is 4; burpees keeps minute 3.
    const block: StructureBlockInput = {
      ...evenMinutes,
      steps: [
        { stepNumber: 1, minuteIndex: 1, stepType: "work", exerciseName: "wall_balls" },
        { stepNumber: 2, minuteIndex: 3, stepType: "work", exerciseName: "burpees" },
        { stepNumber: 3, minuteIndex: 4, stepType: "work", exerciseName: "row" },
        { stepNumber: 4, minuteIndex: 5, stepType: "work", exerciseName: "ski" },
      ],
    };
    const fourIds = ["s1", "s2", "s3", "s4"];
    const view = structureBlockToConfig(block, fourIds);
    const [wallBalls, burpees, row, ski] = view.steps;

    const next = applyConfigToStructureBlock(block, fourIds, { ...view, steps: [wallBalls, burpees, ski, row] });

    expect(byMinute(next)).toEqual([["wall_balls", 1], ["burpees", 3], ["ski", 4], ["row", 5]]);
  });

  it("numbers every minute by position only when no free minute fits between the kept steps", () => {
    // A stored pattern out of minute order: nothing fits after minute 6 and
    // before minute 2, so the replacement step cannot be placed in order.
    const block: StructureBlockInput = {
      ...evenMinutes,
      steps: [
        { stepNumber: 1, minuteIndex: 6, stepType: "work", exerciseName: "wall_balls" },
        { stepNumber: 2, minuteIndex: 4, stepType: "work", exerciseName: "burpees" },
        { stepNumber: 3, minuteIndex: 2, stepType: "work", exerciseName: "row" },
      ],
    };
    const view = structureBlockToConfig(block, ids);
    const [wallBalls, , row] = view.steps;

    const next = applyConfigToStructureBlock(block, ids, {
      ...view,
      steps: [wallBalls, { id: "s4", type: "work", exercise: "ski" }, row],
    });

    expect(minutes(next)).toEqual([1, 2, 3]);
  });

  it("numbers a block that becomes an EMOM by position", () => {
    const rounds: StructureBlockInput = {
      ...evenMinutes,
      formatType: "rounds",
      roundCount: 3,
      steps: evenMinutes.steps.map((step) => ({ ...step, minuteIndex: null })),
    };
    const view = structureBlockToConfig(rounds, ids);

    const next = applyConfigToStructureBlock(rounds, ids, { ...view, blockType: "emom" });

    expect(minutes(next)).toEqual([1, 2, 3]);
  });
});
