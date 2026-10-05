import type { StructureBlockInput } from "@shared/schema";
import { describe, expect, it } from "vitest";

import type { StructuredExercise } from "@/lib/structuredExercise";
import { makeExerciseSet } from "@/test/factories/exerciseSetFactory";

import {
  applySetRelinks,
  emomPatternLength,
  relinkDraftExercise,
  relinksForSets,
  revertSetRelinks,
  type SetRelink,
  type StepLinkMove,
} from "./stepLinks";

// "Min 1 Wall balls" removed from [Wall balls, Burpees, Row] in an EMOM: the
// pattern shrinks from 3 minutes to 2.
const SHRINKS = { fromPatternLength: 3, toPatternLength: 2 } as const;
const removeFirst: StepLinkMove[] = [
  {
    blockId: "block-emom",
    fromStepNumber: 1,
    toStepNumber: null,
    fromMinuteIndex: 1,
    toMinuteIndex: null,
    ...SHRINKS,
  },
  {
    blockId: "block-emom",
    fromStepNumber: 2,
    toStepNumber: 1,
    fromMinuteIndex: 2,
    toMinuteIndex: 1,
    ...SHRINKS,
  },
  {
    blockId: "block-emom",
    fromStepNumber: 3,
    toStepNumber: 2,
    fromMinuteIndex: 3,
    toMinuteIndex: 2,
    ...SHRINKS,
  },
];
// "Min 3 Row" removed instead: Wall balls and Burpees keep their steps and
// minutes, but the pattern still shrinks under their later cycles.
const removeLast: StepLinkMove[] = [
  {
    blockId: "block-emom",
    fromStepNumber: 1,
    toStepNumber: 1,
    fromMinuteIndex: 1,
    toMinuteIndex: 1,
    ...SHRINKS,
  },
  {
    blockId: "block-emom",
    fromStepNumber: 2,
    toStepNumber: 2,
    fromMinuteIndex: 2,
    toMinuteIndex: 2,
    ...SHRINKS,
  },
  {
    blockId: "block-emom",
    fromStepNumber: 3,
    toStepNumber: null,
    fromMinuteIndex: 3,
    toMinuteIndex: null,
    ...SHRINKS,
  },
];

function cycleRows(id: string, stepNumber: number, patternLength: number) {
  return [1, 2, 3].map((cycle) =>
    makeExerciseSet({
      id: `${id}-cycle-${String(cycle)}`,
      blockId: "block-emom",
      stepNumber,
      intervalMinute: stepNumber + patternLength * (cycle - 1),
      cycleNumber: cycle,
    }),
  );
}
const FROM = (stepNumber: number) => ({ fromBlockId: "block-emom", fromStepNumber: stepNumber });

describe("relinksForSets (CL15)", () => {
  it("moves every row with its step and unlinks the removed step's rows", () => {
    const sets = [
      makeExerciseSet({ id: "wall-1", blockId: "block-emom", stepNumber: 1, intervalMinute: 1 }),
      makeExerciseSet({ id: "burpee-1", blockId: "block-emom", stepNumber: 2, intervalMinute: 2 }),
      makeExerciseSet({ id: "row-1", blockId: "block-emom", stepNumber: 3, intervalMinute: 3 }),
      makeExerciseSet({ id: "loose", blockId: null, stepNumber: null }),
      makeExerciseSet({ id: "other-block", blockId: "block-amrap", stepNumber: 2 }),
    ];

    expect(relinksForSets(sets, removeFirst)).toEqual([
      { setId: "wall-1", ...FROM(1), blockId: null, stepNumber: null },
      { setId: "burpee-1", ...FROM(2), blockId: "block-emom", stepNumber: 1, intervalMinute: 1 },
      { setId: "row-1", ...FROM(3), blockId: "block-emom", stepNumber: 2, intervalMinute: 2 },
    ]);
  });

  it("keeps a row's cycle and puts it that many new patterns after its step's new minute", () => {
    // A 3-step pattern across 9 minutes: Row's rows sit at minutes 3, 6 and 9.
    // Row becomes the second of two steps, so its cycles sit at 2, 4 and 6.
    const relinks = relinksForSets(cycleRows("row", 3, 3), removeFirst);

    expect(relinks.map((relink) => relink.intervalMinute)).toEqual([2, 4, 6]);
    // Not sent, so the server keeps each row's own cycle.
    expect(relinks.every((relink) => relink.cycleNumber === undefined)).toBe(true);
  });

  it("moves a later cycle's row when the pattern shrinks under a step that stayed put (CL15)", () => {
    // Wall balls at minutes 1, 4, 7 of a 3-step EMOM; with Row removed the
    // pattern is 2 minutes long, so its cycles sit at 1, 3 and 5.
    const relinks = relinksForSets(cycleRows("wall", 1, 3), removeLast);

    // The first cycle's row is already where it belongs, so it is not sent.
    expect(relinks).toEqual([
      {
        setId: "wall-cycle-2",
        ...FROM(1),
        blockId: "block-emom",
        stepNumber: 1,
        intervalMinute: 3,
      },
      {
        setId: "wall-cycle-3",
        ...FROM(1),
        blockId: "block-emom",
        stepNumber: 1,
        intervalMinute: 5,
      },
    ]);
  });

  it("spreads later cycles out when a step is added and the pattern grows", () => {
    const grows: StepLinkMove[] = [
      {
        blockId: "block-emom",
        fromStepNumber: 2,
        toStepNumber: 2,
        fromMinuteIndex: 2,
        toMinuteIndex: 2,
        fromPatternLength: 2,
        toPatternLength: 3,
      },
    ];

    expect(
      relinksForSets(cycleRows("burpee", 2, 2), grows).map((relink) => relink.intervalMinute),
    ).toEqual([5, 8]);
  });

  it("shifts by the step's own move when the pattern's length is not known", () => {
    const sets = cycleRows("row", 3, 3);
    const withoutLength: StepLinkMove[] = [
      {
        blockId: "block-emom",
        fromStepNumber: 3,
        toStepNumber: 2,
        fromMinuteIndex: 3,
        toMinuteIndex: 2,
      },
    ];

    expect(relinksForSets(sets, withoutLength).map((relink) => relink.intervalMinute)).toEqual([
      2, 5, 8,
    ]);
  });

  it("leaves a row's minute alone outside an EMOM", () => {
    const sets = [
      makeExerciseSet({
        id: "row-1",
        blockId: "block-rounds",
        stepNumber: 2,
        intervalMinute: null,
      }),
    ];

    expect(
      relinksForSets(sets, [
        {
          blockId: "block-rounds",
          fromStepNumber: 2,
          toStepNumber: 1,
          fromMinuteIndex: null,
          toMinuteIndex: null,
        },
      ]),
    ).toEqual([
      {
        setId: "row-1",
        fromBlockId: "block-rounds",
        fromStepNumber: 2,
        blockId: "block-rounds",
        stepNumber: 1,
        intervalMinute: null,
      },
    ]);
  });

  it("relinks nothing when no step moved", () => {
    const sets = [makeExerciseSet({ id: "burpee-1", blockId: "block-emom", stepNumber: 1 })];

    expect(relinksForSets(sets, [])).toEqual([]);
  });
});

describe("emomPatternLength (CL15)", () => {
  const emom = (minutes: (number | null)[]): StructureBlockInput => ({
    sectionType: "main",
    formatType: "emom",
    steps: minutes.map((minuteIndex, idx) => ({
      stepNumber: idx + 1,
      minuteIndex,
      stepType: "work" as const,
      exerciseName: "row",
    })),
  });

  it("is one minute per step, or up to the last minute a step holds", () => {
    expect(emomPatternLength(emom([1, 2, 3]))).toBe(3);
    expect(emomPatternLength(emom([2, 4, 6]))).toBe(6);
    expect(emomPatternLength(emom([null, null]))).toBe(2);
  });

  it("is null outside an EMOM", () => {
    expect(emomPatternLength({ ...emom([1, 2]), formatType: "amrap" })).toBeNull();
  });
});

describe("applySetRelinks / revertSetRelinks (CL15)", () => {
  const sets = [
    makeExerciseSet({
      id: "wall-1",
      blockId: "block-emom",
      stepNumber: 1,
      intervalMinute: 1,
      stepRole: "work",
      groupId: "g-1",
    }),
    makeExerciseSet({
      id: "row-1",
      blockId: "block-emom",
      stepNumber: 3,
      intervalMinute: 6,
      cycleNumber: 2,
    }),
  ];
  const relinks: SetRelink[] = [
    { setId: "wall-1", ...FROM(1), blockId: null, stepNumber: null },
    { setId: "row-1", ...FROM(3), blockId: "block-emom", stepNumber: 2, intervalMinute: 5 },
  ];

  it("moves the rows as the server will, keeping the cycle and clearing an unlinked row", () => {
    const [wall, row] = applySetRelinks(sets, relinks);

    expect(wall).toMatchObject({
      blockId: null,
      stepNumber: null,
      intervalMinute: null,
      cycleNumber: null,
      stepRole: null,
      groupId: null,
    });
    expect(row).toMatchObject({
      blockId: "block-emom",
      stepNumber: 2,
      intervalMinute: 5,
      cycleNumber: 2,
    });
  });

  it("leaves a row a newer write already moved off the link the relink names", () => {
    const moved = [{ ...sets[1], stepNumber: 1 }];

    expect(applySetRelinks(moved, relinks)).toEqual(moved);
  });

  it("puts back only the rows the failed save moved", () => {
    const applied = applySetRelinks(sets, relinks);
    // A set edit to Row's reps landed while the save was out; another write
    // moved the wall-ball row on.
    const meanwhile = [
      { ...applied[0], stepNumber: 4, blockId: "block-emom" },
      { ...applied[1], reps: 12 },
    ];

    const [wall, row] = revertSetRelinks(meanwhile, relinks, sets);

    expect(wall).toMatchObject({ blockId: "block-emom", stepNumber: 4 });
    expect(row).toMatchObject({
      blockId: "block-emom",
      stepNumber: 3,
      intervalMinute: 6,
      cycleNumber: 2,
      reps: 12,
    });
  });
});

describe("relinkDraftExercise (CL15)", () => {
  const rowDraft: StructuredExercise = {
    exerciseName: "rowing",
    category: "conditioning",
    sets: [
      {
        setNumber: 1,
        distance: 250,
        blockId: "block-emom",
        stepNumber: 3,
        intervalMinute: 3,
        cycleNumber: 1,
        stepRole: "work",
        groupId: "g-1",
      },
      {
        setNumber: 2,
        distance: 250,
        blockId: "block-emom",
        stepNumber: 3,
        intervalMinute: 6,
        cycleNumber: 2,
        stepRole: "work",
        groupId: "g-1",
      },
    ],
  };

  it("moves the draft's sets with their step and keeps their values, cycles and roles", () => {
    const relinked = relinkDraftExercise(rowDraft, removeFirst);

    expect(relinked.sets).toEqual([
      {
        setNumber: 1,
        distance: 250,
        blockId: "block-emom",
        stepNumber: 2,
        intervalMinute: 2,
        cycleNumber: 1,
        stepRole: "work",
        groupId: "g-1",
      },
      {
        setNumber: 2,
        distance: 250,
        blockId: "block-emom",
        stepNumber: 2,
        intervalMinute: 4,
        cycleNumber: 2,
        stepRole: "work",
        groupId: "g-1",
      },
    ]);
  });

  it("moves only the later cycle's set when the pattern shrinks under a step that stayed put", () => {
    const wallDraft: StructuredExercise = {
      exerciseName: "wall_balls",
      category: "functional",
      sets: [
        {
          setNumber: 1,
          reps: 20,
          blockId: "block-emom",
          stepNumber: 1,
          intervalMinute: 1,
          cycleNumber: 1,
        },
        {
          setNumber: 2,
          reps: 20,
          blockId: "block-emom",
          stepNumber: 1,
          intervalMinute: 4,
          cycleNumber: 2,
        },
      ],
    };

    const relinked = relinkDraftExercise(wallDraft, removeLast);

    expect(relinked.sets.at(0)).toBe(wallDraft.sets.at(0));
    expect(relinked.sets.at(1)).toEqual({
      setNumber: 2,
      reps: 20,
      blockId: "block-emom",
      stepNumber: 1,
      intervalMinute: 3,
      cycleNumber: 2,
    });
  });

  it("returns the same exercise when the pattern change leaves every set where it was", () => {
    const firstCycleOnly: StructuredExercise = {
      exerciseName: "wall_balls",
      category: "functional",
      sets: [{ setNumber: 1, reps: 20, blockId: "block-emom", stepNumber: 1, intervalMinute: 1 }],
    };

    expect(relinkDraftExercise(firstCycleOnly, removeLast)).toBe(firstCycleOnly);
  });

  it("unlinks the sets of a removed step", () => {
    const wallDraft: StructuredExercise = {
      exerciseName: "wall_balls",
      category: "functional",
      sets: [
        {
          setNumber: 1,
          reps: 20,
          blockId: "block-emom",
          stepNumber: 1,
          intervalMinute: 1,
          stepRole: "work",
        },
      ],
    };

    expect(relinkDraftExercise(wallDraft, removeFirst).sets).toEqual([
      {
        setNumber: 1,
        reps: 20,
        blockId: null,
        stepNumber: null,
        intervalMinute: null,
        cycleNumber: null,
        stepRole: null,
        groupId: null,
      },
    ]);
  });

  it("returns the same exercise when none of its sets moved", () => {
    const unlinked: StructuredExercise = {
      exerciseName: "back_squat",
      category: "strength",
      sets: [{ setNumber: 1, reps: 5 }],
    };

    expect(relinkDraftExercise(unlinked, removeFirst)).toBe(unlinked);
  });
});
