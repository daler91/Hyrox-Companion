import { describe, expect, it } from "vitest";

import { lintWorkoutStructure } from "./structureLint";
import type { ParsedExercise, StructureBlockInput } from "./types";

// ---------------------------------------------------------------------------
// Fixture builders
//
// lintWorkoutStructure is a pure function over already-typed structures, so we
// construct plain objects (the same approach as types.structure.test.ts) and
// drive every branch directly rather than going through Zod parsing.
// ---------------------------------------------------------------------------

type StructureStep = StructureBlockInput["steps"][number];

const CODE = {
  ambiguousReps: "AMBIGUOUS_REPS_SCOPE",
  incompatibleFormat: "INCOMPATIBLE_FORMAT_PARAMS",
  missingTarget: "MISSING_REQUIRED_TARGET_BY_FORMAT",
  restConflict: "REST_SCOPE_CONFLICT",
  missingStepTarget: "MISSING_STEP_TARGET",
  missingBlockId: "MISSING_BLOCK_ID",
  missingLink: "MISSING_LINKED_EXERCISE_ROW",
} as const;

function makeStep(overrides: Partial<StructureStep> = {}): StructureStep {
  return { stepNumber: 1, stepType: "work", ...overrides };
}

function makeBlock(overrides: Partial<StructureBlockInput> = {}): StructureBlockInput {
  return {
    sectionType: "main",
    formatType: "steady",
    steps: [],
    ...overrides,
  };
}

function makeExercise(overrides: Partial<ParsedExercise> = {}): ParsedExercise {
  return {
    exerciseName: "Wall Balls",
    category: "conditioning",
    sets: [],
    ...overrides,
  };
}

function codesOf(result: { issues: Array<{ code: string }> }): string[] {
  return result.issues.map((issue) => issue.code);
}

// A complex block that yields exactly one schema error (missing AMRAP cap)
// regardless of whether exercises are supplied: it carries an id (so it never
// trips MISSING_BLOCK_ID) and has no steps (so it never trips MISSING_LINK).
function amrapMissingCapBlock(): StructureBlockInput {
  return makeBlock({ id: "amrap-1", formatType: "amrap", steps: [] });
}

// A for_time block that yields exactly one info (a step with no target). A
// duration cap keeps blockFormatIssues silent so only the step-target info fires.
function forTimeUntargetedBlock(): StructureBlockInput {
  return makeBlock({
    formatType: "for_time",
    durationSeconds: 600,
    steps: [makeStep({ stepNumber: 1, targets: undefined })],
  });
}

// An exercise that yields exactly one warning (ambiguous rep scope).
function ambiguousRepsExercise(): ParsedExercise {
  return makeExercise({ repMode: "per_side", reps: 30, sets: [{ setNumber: 1, reps: 15 }] });
}

describe("lintWorkoutStructure — empty and nullish inputs", () => {
  it("returns a perfect score with no issues when called with no arguments", () => {
    const result = lintWorkoutStructure();

    expect(result.issues).toEqual([]);
    expect(result.schemaErrors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.infos).toEqual([]);
    expect(result.structureCompletenessScore).toBe(100);
  });

  it.each([
    ["null, null", null, null],
    ["undefined, undefined", undefined, undefined],
    ["empty arrays", [], []],
  ])("treats %s as an empty, perfectly-scored structure", (_label, blocks, exercises) => {
    const result = lintWorkoutStructure(blocks, exercises);

    expect(result.issues).toEqual([]);
    expect(result.structureCompletenessScore).toBe(100);
  });

  it("scores a structurally valid block + exercise at 100", () => {
    const result = lintWorkoutStructure([makeBlock()], [makeExercise()]);

    expect(result.issues).toEqual([]);
    expect(result.structureCompletenessScore).toBe(100);
  });
});

describe("exerciseIssues — AMBIGUOUS_REPS_SCOPE", () => {
  it("warns when a per_side exercise carries both top-level reps and per-set reps", () => {
    const exercise = makeExercise({
      exerciseName: "Bulgarian Split Squat",
      repMode: "per_side",
      reps: 20,
      sets: [{ setNumber: 1, reps: 10 }],
    });

    const result = lintWorkoutStructure([], [exercise]);

    expect(result.warnings).toHaveLength(1);
    const [warning] = result.warnings;
    expect(warning.code).toBe(CODE.ambiguousReps);
    expect(warning.severity).toBe("warning");
    expect(warning.message).toContain("Bulgarian Split Squat");
    expect(warning.message).toContain("per_side");
    expect(warning.fixGuidance.length).toBeGreaterThan(0);
  });

  it.each([
    [
      "repMode is total",
      makeExercise({ repMode: "total", reps: 20, sets: [{ setNumber: 1, reps: 10 }] }),
    ],
    ["repMode is undefined", makeExercise({ reps: 20, sets: [{ setNumber: 1, reps: 10 }] })],
    [
      "top-level reps are absent",
      makeExercise({ repMode: "per_side", sets: [{ setNumber: 1, reps: 10 }] }),
    ],
    [
      "no per-set reps exist",
      makeExercise({ repMode: "per_side", reps: 20, sets: [{ setNumber: 1 }] }),
    ],
    ["sets array is empty", makeExercise({ repMode: "per_side", reps: 20, sets: [] })],
  ])("does not warn when %s", (_label, exercise) => {
    const result = lintWorkoutStructure([], [exercise]);

    expect(codesOf(result)).not.toContain(CODE.ambiguousReps);
  });

  it("does not throw and does not warn when sets is undefined", () => {
    const exercise = makeExercise({ repMode: "per_side", reps: 20 });
    // ParsedExercise.sets is typed as required, but guard against runtime undefined.
    (exercise as { sets?: unknown }).sets = undefined;

    const result = lintWorkoutStructure([], [exercise]);

    expect(codesOf(result)).not.toContain(CODE.ambiguousReps);
  });

  it("treats a top-level reps value of 0 as present (still ambiguous)", () => {
    const exercise = makeExercise({
      repMode: "per_side",
      reps: 0,
      sets: [{ setNumber: 1, reps: 10 }],
    });

    const result = lintWorkoutStructure([], [exercise]);

    expect(codesOf(result)).toContain(CODE.ambiguousReps);
  });

  it("emits one warning per offending exercise", () => {
    const result = lintWorkoutStructure([], [ambiguousRepsExercise(), ambiguousRepsExercise()]);

    expect(result.warnings).toHaveLength(2);
  });
});

describe("blockFormatIssues — AMRAP", () => {
  it("errors when an AMRAP block defines fixed rounds", () => {
    const block = makeBlock({ formatType: "amrap", rounds: 3, timeCapMinutes: 12 });

    const result = lintWorkoutStructure([block]);

    expect(codesOf(result)).toContain(CODE.incompatibleFormat);
    expect(codesOf(result)).not.toContain(CODE.missingTarget);
  });

  it("errors when an AMRAP block has neither a time cap nor a duration", () => {
    const result = lintWorkoutStructure([makeBlock({ formatType: "amrap" })]);

    expect(codesOf(result)).toEqual([CODE.missingTarget]);
  });

  it.each([
    ["timeCapMinutes", { timeCapMinutes: 12 }],
    ["durationMinutes", { durationMinutes: 12 }],
    ["durationSeconds", { durationSeconds: 720 }],
  ])("accepts an AMRAP block capped by %s", (_label, cap) => {
    const result = lintWorkoutStructure([makeBlock({ formatType: "amrap", ...cap })]);

    expect(codesOf(result)).not.toContain(CODE.missingTarget);
  });

  it("emits both incompatible-format and missing-target errors for AMRAP with rounds and no cap", () => {
    const result = lintWorkoutStructure([makeBlock({ formatType: "amrap", rounds: 3 })]);

    expect(codesOf(result)).toEqual([CODE.incompatibleFormat, CODE.missingTarget]);
  });

  it("lowercases formatType before matching (AMRAP === amrap)", () => {
    const result = lintWorkoutStructure([
      makeBlock({ formatType: "AMRAP" as StructureBlockInput["formatType"] }),
    ]);

    expect(codesOf(result)).toContain(CODE.missingTarget);
  });
});

describe("blockFormatIssues — ROUNDS", () => {
  it("errors when a rounds block has no round count", () => {
    const result = lintWorkoutStructure([makeBlock({ formatType: "rounds" })]);

    expect(codesOf(result)).toEqual([CODE.missingTarget]);
  });

  it.each([
    ["roundCount", { roundCount: 5 }],
    ["legacy rounds", { rounds: 5 }],
  ])("accepts a rounds block with %s", (_label, count) => {
    const result = lintWorkoutStructure([makeBlock({ formatType: "rounds", ...count })]);

    expect(codesOf(result)).not.toContain(CODE.missingTarget);
  });
});

describe("blockFormatIssues — FOR_TIME", () => {
  it("errors when a for_time block has neither durationSeconds nor a time cap", () => {
    const result = lintWorkoutStructure([makeBlock({ formatType: "for_time" })]);

    expect(codesOf(result)).toEqual([CODE.missingTarget]);
  });

  it.each([
    ["durationSeconds", { durationSeconds: 600 }],
    ["timeCapMinutes", { timeCapMinutes: 10 }],
  ])("accepts a for_time block bounded by %s", (_label, cap) => {
    const result = lintWorkoutStructure([makeBlock({ formatType: "for_time", ...cap })]);

    expect(codesOf(result)).not.toContain(CODE.missingTarget);
  });
});

describe("blockFormatIssues — INTERVAL", () => {
  it("errors when neither the primary nor the alias work/rest pair is complete", () => {
    const result = lintWorkoutStructure([makeBlock({ formatType: "interval" })]);

    expect(codesOf(result)).toEqual([CODE.missingTarget]);
  });

  it("accepts the primary workSeconds/restSeconds pair", () => {
    const result = lintWorkoutStructure([
      makeBlock({ formatType: "interval", workSeconds: 40, restSeconds: 20 }),
    ]);

    expect(codesOf(result)).not.toContain(CODE.missingTarget);
  });

  it("accepts the alias workIntervalSec/restIntervalSec pair", () => {
    const result = lintWorkoutStructure([
      makeBlock({ formatType: "interval", workIntervalSec: 40, restIntervalSec: 20 }),
    ]);

    expect(codesOf(result)).not.toContain(CODE.missingTarget);
  });

  it("errors when only one half of the primary pair is provided", () => {
    const result = lintWorkoutStructure([makeBlock({ formatType: "interval", workSeconds: 40 })]);

    expect(codesOf(result)).toContain(CODE.missingTarget);
  });

  it("errors when a primary value is mixed with an alias value (pairs checked independently)", () => {
    const result = lintWorkoutStructure([
      makeBlock({ formatType: "interval", workSeconds: 40, restIntervalSec: 20 }),
    ]);

    expect(codesOf(result)).toContain(CODE.missingTarget);
  });
});

describe("blockFormatIssues — formats without target constraints", () => {
  it.each(["steady", "quality", "emom"])(
    "emits no format errors for a bare %s block",
    (formatType) => {
      const result = lintWorkoutStructure([
        makeBlock({ formatType: formatType as StructureBlockInput["formatType"] }),
      ]);

      expect(result.schemaErrors).toEqual([]);
    },
  );
});

describe("restScopeIssues — REST_SCOPE_CONFLICT", () => {
  it("warns when a block has both restSeconds and an explicit rest step (stepType)", () => {
    const block = makeBlock({ restSeconds: 60, steps: [makeStep({ stepType: "rest" })] });

    const result = lintWorkoutStructure([block]);

    expect(codesOf(result)).toEqual([CODE.restConflict]);
  });

  it("recognises a rest step declared via stepRole", () => {
    const block = makeBlock({ restSeconds: 60, steps: [makeStep({ stepRole: "rest" })] });

    const result = lintWorkoutStructure([block]);

    expect(codesOf(result)).toContain(CODE.restConflict);
  });

  it("is case-insensitive about the rest role", () => {
    const block = makeBlock({
      restSeconds: 60,
      steps: [makeStep({ stepType: "REST" as StructureStep["stepType"] })],
    });

    const result = lintWorkoutStructure([block]);

    expect(codesOf(result)).toContain(CODE.restConflict);
  });

  it("does not warn when restSeconds is absent", () => {
    const block = makeBlock({ steps: [makeStep({ stepType: "rest" })] });

    const result = lintWorkoutStructure([block]);

    expect(codesOf(result)).not.toContain(CODE.restConflict);
  });

  it("does not warn when there is no rest step", () => {
    const block = makeBlock({ restSeconds: 60, steps: [makeStep({ stepType: "work" })] });

    const result = lintWorkoutStructure([block]);

    expect(codesOf(result)).not.toContain(CODE.restConflict);
  });

  it("treats restSeconds of 0 as set (still a conflict)", () => {
    const block = makeBlock({ restSeconds: 0, steps: [makeStep({ stepType: "rest" })] });

    const result = lintWorkoutStructure([block]);

    expect(codesOf(result)).toContain(CODE.restConflict);
  });

  it("lets stepRole override stepType when deciding rest (work role hides rest type)", () => {
    const block = makeBlock({
      restSeconds: 60,
      steps: [makeStep({ stepRole: "work", stepType: "rest" })],
    });

    const result = lintWorkoutStructure([block]);

    expect(codesOf(result)).not.toContain(CODE.restConflict);
  });
});

describe("stepTargetIssues — MISSING_STEP_TARGET", () => {
  it("emits an info for a for_time step with no targets, referencing the step number", () => {
    const block = makeBlock({
      formatType: "for_time",
      durationSeconds: 600,
      steps: [makeStep({ stepNumber: 7, targets: undefined })],
    });

    const result = lintWorkoutStructure([block]);

    expect(result.infos).toHaveLength(1);
    expect(result.infos[0].code).toBe(CODE.missingStepTarget);
    expect(result.infos[0].message).toContain("7");
  });

  it.each([
    ["reps", { reps: 12 }],
    ["targetReps alias", { targetReps: 12 }],
    ["distance", { distance: 100 }],
    ["targetDistance alias", { targetDistance: 100 }],
    ["time", { time: 45 }],
    ["targetTime alias", { targetTime: 45 }],
  ])("does not flag a for_time step that has a %s target", (_label, targets) => {
    const block = makeBlock({
      formatType: "for_time",
      durationSeconds: 600,
      steps: [makeStep({ targets })],
    });

    const result = lintWorkoutStructure([block]);

    expect(codesOf(result)).not.toContain(CODE.missingStepTarget);
  });

  it.each([
    ["weight", { weight: 50 }],
    ["targetWeight alias", { targetWeight: 50 }],
  ])(
    "still flags a for_time step whose only target is %s (weight is not counted)",
    (_label, targets) => {
      const block = makeBlock({
        formatType: "for_time",
        durationSeconds: 600,
        steps: [makeStep({ targets })],
      });

      const result = lintWorkoutStructure([block]);

      expect(codesOf(result)).toContain(CODE.missingStepTarget);
    },
  );

  it.each([
    ["empty targets object", {}],
    ["null targets", null],
  ])("treats %s as missing", (_label, targets) => {
    const block = makeBlock({
      formatType: "for_time",
      durationSeconds: 600,
      steps: [makeStep({ targets: targets as StructureStep["targets"] })],
    });

    const result = lintWorkoutStructure([block]);

    expect(codesOf(result)).toContain(CODE.missingStepTarget);
  });

  it("emits one info per untargeted step", () => {
    const block = makeBlock({
      formatType: "for_time",
      durationSeconds: 600,
      steps: [makeStep({ stepNumber: 1 }), makeStep({ stepNumber: 2 })],
    });

    const result = lintWorkoutStructure([block]);

    expect(result.infos).toHaveLength(2);
  });

  it("never runs the step-target check for non-for_time formats", () => {
    const block = makeBlock({
      formatType: "steady",
      steps: [makeStep({ stepNumber: 1, targets: undefined })],
    });

    const result = lintWorkoutStructure([block]);

    expect(codesOf(result)).not.toContain(CODE.missingStepTarget);
  });
});

describe("blockLinkIssues — complex block linking", () => {
  const complexBlock = (overrides: Partial<StructureBlockInput> = {}): StructureBlockInput =>
    makeBlock({
      id: "block-1",
      formatType: "emom",
      durationMinutes: 10,
      steps: [makeStep({ stepNumber: 1, minuteIndex: 1 })],
      ...overrides,
    });

  it("performs no link checks when there are no exercises", () => {
    const result = lintWorkoutStructure([complexBlock({ id: undefined })]);

    expect(result.schemaErrors).toEqual([]);
  });

  it("errors with MISSING_BLOCK_ID for an id-less complex block and skips per-step checks", () => {
    const result = lintWorkoutStructure(
      [complexBlock({ id: undefined })],
      [makeExercise({ sets: [{ setNumber: 1 }] })],
    );

    const errorCodes = result.schemaErrors.map((issue) => issue.code);
    expect(errorCodes).toEqual([CODE.missingBlockId]);
    expect(errorCodes).not.toContain(CODE.missingLink);
  });

  it("errors with MISSING_LINKED_EXERCISE_ROW for an unlinked work step", () => {
    const result = lintWorkoutStructure(
      [complexBlock({ formatType: "rounds", roundCount: 3, steps: [makeStep({ stepNumber: 1 })] })],
      [makeExercise({ sets: [{ setNumber: 1, distance: 50 }] })],
    );

    expect(result.schemaErrors).toContainEqual(
      expect.objectContaining({
        code: CODE.missingLink,
        message: "ROUNDS step 1 must be linked to an exercise row.",
      }),
    );
  });

  it("accepts a work step when a matching exercise-set link exists", () => {
    const result = lintWorkoutStructure(
      [complexBlock()],
      [makeExercise({ sets: [{ setNumber: 1, blockId: "block-1", stepNumber: 1 }] })],
    );

    expect(result.schemaErrors).toEqual([]);
  });

  it.each([
    ["rest stepType", makeStep({ stepNumber: 1, minuteIndex: 1, stepType: "rest" })],
    ["rest stepRole", makeStep({ stepNumber: 1, minuteIndex: 1, stepRole: "rest" })],
    ["transition stepType", makeStep({ stepNumber: 1, minuteIndex: 1, stepType: "transition" })],
  ])("does not require a link for a %s step", (_label, step) => {
    const result = lintWorkoutStructure(
      [complexBlock({ steps: [step] })],
      [makeExercise({ sets: [{ setNumber: 1 }] })],
    );

    expect(result.schemaErrors.map((issue) => issue.code)).not.toContain(CODE.missingLink);
  });

  it("requires a link for a step that defaults to the work role", () => {
    const stepWithoutRole = makeStep({ stepNumber: 1, minuteIndex: 1 });
    (stepWithoutRole as { stepType?: unknown }).stepType = undefined;

    const result = lintWorkoutStructure(
      [complexBlock({ steps: [stepWithoutRole] })],
      [makeExercise({ sets: [{ setNumber: 1 }] })],
    );

    expect(result.schemaErrors.map((issue) => issue.code)).toContain(CODE.missingLink);
  });

  it.each([
    ["a mismatched stepNumber", { setNumber: 1, blockId: "block-1", stepNumber: 2 }],
    ["a mismatched blockId", { setNumber: 1, blockId: "other-block", stepNumber: 1 }],
    [
      "a null stepNumber",
      { setNumber: 1, blockId: "block-1", stepNumber: null as unknown as number },
    ],
    ["a missing blockId", { setNumber: 1, stepNumber: 1 }],
  ])("treats a set with %s as not linked", (_label, set) => {
    const result = lintWorkoutStructure([complexBlock()], [makeExercise({ sets: [set] })]);

    expect(result.schemaErrors.map((issue) => issue.code)).toContain(CODE.missingLink);
  });

  it.each(["for_time", "interval", "steady"])(
    "performs no link checks for the non-complex %s format",
    (formatType) => {
      const block = makeBlock({
        id: "b",
        formatType: formatType as StructureBlockInput["formatType"],
        // Provide caps so blockFormatIssues stays silent and we isolate linking.
        durationSeconds: 600,
        timeCapMinutes: 10,
        workSeconds: 40,
        restSeconds: 20,
        steps: [makeStep({ stepNumber: 1 })],
      });

      const result = lintWorkoutStructure([block], [makeExercise({ sets: [{ setNumber: 1 }] })]);

      expect(result.schemaErrors.map((issue) => issue.code)).not.toContain(CODE.missingLink);
    },
  );
});

describe("buildLintResult — structureCompletenessScore", () => {
  it("subtracts 3 points for a single info", () => {
    const result = lintWorkoutStructure([forTimeUntargetedBlock()]);

    expect(result.infos).toHaveLength(1);
    expect(result.structureCompletenessScore).toBe(97);
  });

  it("subtracts 10 points for a single warning", () => {
    const result = lintWorkoutStructure([], [ambiguousRepsExercise()]);

    expect(result.warnings).toHaveLength(1);
    expect(result.structureCompletenessScore).toBe(90);
  });

  it("subtracts 30 points for a single error", () => {
    const result = lintWorkoutStructure([amrapMissingCapBlock()]);

    expect(result.schemaErrors).toHaveLength(1);
    expect(result.structureCompletenessScore).toBe(70);
  });

  it("combines penalties across severities (1 error + 1 warning + 1 info = -43)", () => {
    const result = lintWorkoutStructure(
      [amrapMissingCapBlock(), forTimeUntargetedBlock()],
      [ambiguousRepsExercise()],
    );

    expect(result.schemaErrors).toHaveLength(1);
    expect(result.warnings).toHaveLength(1);
    expect(result.infos).toHaveLength(1);
    expect(result.issues).toHaveLength(3);
    expect(result.structureCompletenessScore).toBe(57);
  });

  it("clamps the score to 0 when penalties exceed 100", () => {
    const result = lintWorkoutStructure([
      amrapMissingCapBlock(),
      amrapMissingCapBlock(),
      amrapMissingCapBlock(),
      amrapMissingCapBlock(),
    ]);

    expect(result.schemaErrors).toHaveLength(4);
    expect(result.structureCompletenessScore).toBe(0);
  });

  it("partitions issues into schemaErrors, warnings and infos consistently", () => {
    const result = lintWorkoutStructure(
      [amrapMissingCapBlock(), forTimeUntargetedBlock()],
      [ambiguousRepsExercise()],
    );

    const partitioned = [...result.schemaErrors, ...result.warnings, ...result.infos];
    expect(partitioned).toHaveLength(result.issues.length);
    expect(result.schemaErrors.every((issue) => issue.severity === "error")).toBe(true);
    expect(result.warnings.every((issue) => issue.severity === "warning")).toBe(true);
    expect(result.infos.every((issue) => issue.severity === "info")).toBe(true);
  });
});
