import { describe, expect, it } from 'vitest';

import { lintWorkoutStructure } from './structureLint';
import { structureBlockSchema } from './types';

function expectStructureBlock(input: unknown, success: boolean) {
  expect(structureBlockSchema.safeParse(input).success).toBe(success);
}

function emomBlock(steps: unknown[], durationMinutes = 8) {
  return {
    sectionType: 'main',
    formatType: 'emom',
    durationMinutes,
    steps,
  };
}

type EmomRejectCase = [string, unknown[], number];

describe('structureBlockSchema EMOM semantics', () => {
  it('accepts EMOM with unique minute indices and rest steps', () => {
    expectStructureBlock(
      emomBlock([
        { stepNumber: 1, minuteIndex: 1, stepType: 'work', exerciseName: 'Burpee Broad Jump', targets: { targetReps: 6 } },
        { stepNumber: 2, minuteIndex: 2, stepType: 'work', exerciseName: 'Sandbag Lunges', targets: { targetReps: 12 } },
        { stepNumber: 3, minuteIndex: 3, stepType: 'work', exerciseName: 'Wall Balls', targets: { targetReps: 15 } },
        { stepNumber: 4, minuteIndex: 4, stepType: 'rest' },
      ], 16),
      true,
    );
  });

  const emomRejectCases: EmomRejectCase[] = [
    [
      'duplicate minute index',
      [
        { stepNumber: 1, minuteIndex: 1, stepType: 'work', exerciseName: 'Row' },
        { stepNumber: 2, minuteIndex: 1, stepType: 'rest' },
      ],
      10,
    ],
    ['steps without minute index', [{ stepNumber: 1, stepType: 'work', exerciseName: 'Row' }], 10],
    ['rest step with targets', [{ stepNumber: 1, minuteIndex: 1, stepType: 'rest', targets: { targetReps: 10 } }], 8],
    ['rest step with alias targets', [{ stepNumber: 1, minuteIndex: 1, stepType: 'rest', targets: { reps: 10 } }], 8],
    ['rest step with whitespace-only labels', [{ stepNumber: 1, minuteIndex: 1, stepType: 'rest', customLabel: '   ' }], 8],
  ];

  it.each(emomRejectCases)('rejects EMOM %s', (_caseName, steps, durationMinutes) => {
    expectStructureBlock(emomBlock(steps, durationMinutes), false);
  });

  it('preserves legacy timing and ordering fields for backward compatibility', () => {
    const parsed = structureBlockSchema.safeParse({
      sectionType: 'main',
      formatType: 'steady',
      durationSeconds: 900,
      rounds: 3,
      workSeconds: 45,
      restSeconds: 15,
      sortOrder: 2,
      steps: [
        { stepNumber: 1, stepType: 'work', exerciseName: 'Row', category: 'conditioning', stepRole: 'steady' },
      ],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.durationSeconds).toBe(900);
      expect(parsed.data.sortOrder).toBe(2);
      expect(parsed.data.steps[0].category).toBe('conditioning');
      expect(parsed.data.steps[0].stepRole).toBe('steady');
    }
  });

  it('accepts AMRAP blocks with a time cap and score', () => {
    const parsed = structureBlockSchema.safeParse({
      sectionType: 'main',
      formatType: 'amrap',
      timeCapMinutes: 12,
      score: { type: 'amrap', rounds: 4, reps: 12 },
      steps: [
        { stepNumber: 1, stepType: 'work', exerciseName: 'Burpee Broad Jump', targets: { targetReps: 8 } },
        { stepNumber: 2, stepType: 'work', exerciseName: 'Wall Balls', targets: { targetReps: 12 } },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects AMRAP blocks without a time cap or duration', () => {
    const parsed = structureBlockSchema.safeParse({
      sectionType: 'main',
      formatType: 'amrap',
      steps: [{ stepNumber: 1, stepType: 'work', exerciseName: 'Row' }],
    });
    expect(parsed.success).toBe(false);
  });

  it('accepts transition steps without movement rows', () => {
    const parsed = structureBlockSchema.safeParse({
      sectionType: 'main',
      formatType: 'rounds',
      roundCount: 3,
      steps: [
        { stepNumber: 1, stepType: 'work', exerciseName: 'Sled Push' },
        { stepNumber: 2, stepType: 'transition', targets: { instructions: 'Change stations', durationSeconds: 30 } },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it('accepts rounds blocks with completed-round score data', () => {
    const parsed = structureBlockSchema.safeParse({
      sectionType: 'main',
      formatType: 'rounds',
      roundCount: 5,
      score: { type: 'rounds', completedRounds: 5, elapsedSeconds: 930 },
      steps: [{ stepNumber: 1, stepType: 'work', exerciseName: 'Sandbag Lunges', targets: { targetReps: 20 } }],
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects rounds blocks without a round count', () => {
    const parsed = structureBlockSchema.safeParse({
      sectionType: 'main',
      formatType: 'rounds',
      steps: [{ stepNumber: 1, stepType: 'work', exerciseName: 'Sandbag Lunges' }],
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects mismatched block score types', () => {
    const parsed = structureBlockSchema.safeParse({
      sectionType: 'main',
      formatType: 'amrap',
      timeCapMinutes: 10,
      score: { type: 'rounds', completedRounds: 3 },
      steps: [{ stepNumber: 1, stepType: 'work', exerciseName: 'Row' }],
    });
    expect(parsed.success).toBe(false);
  });
});

describe('lintWorkoutStructure block links', () => {
  it('accepts complex work steps when a matching exercise row link exists', () => {
    const lint = lintWorkoutStructure(
      [{
        id: 'block-emom',
        sectionType: 'main',
        formatType: 'emom',
        durationMinutes: 10,
        steps: [{ stepNumber: 1, minuteIndex: 1, stepType: 'work', exerciseName: 'Unassigned exercise' }],
      }],
      [{
        exerciseName: 'wall_balls',
        category: 'conditioning',
        sets: [{ setNumber: 1, reps: 12, blockId: 'block-emom', stepNumber: 1, intervalMinute: 1 }],
      }],
    );

    expect(lint.schemaErrors).toEqual([]);
  });

  it('rejects complex work steps without a matching exercise row link', () => {
    const lint = lintWorkoutStructure(
      [{
        id: 'block-rounds',
        sectionType: 'main',
        formatType: 'rounds',
        roundCount: 3,
        steps: [{ stepNumber: 1, stepType: 'work', exerciseName: 'Unassigned exercise' }],
      }],
      [{
        exerciseName: 'sled_push',
        category: 'conditioning',
        sets: [{ setNumber: 1, distance: 50 }],
      }],
    );

    expect(lint.schemaErrors).toContainEqual(expect.objectContaining({
      code: 'MISSING_LINKED_EXERCISE_ROW',
      message: 'ROUNDS step 1 must be linked to an exercise row.',
    }));
  });

  it('does not require exercise row links for steps marked rest by stepRole', () => {
    const lint = lintWorkoutStructure(
      [{
        id: 'block-emom',
        sectionType: 'main',
        formatType: 'emom',
        durationMinutes: 10,
        steps: [
          { stepNumber: 1, minuteIndex: 1, stepRole: 'rest' },
          { stepNumber: 2, minuteIndex: 2, stepType: 'work', exerciseName: 'Unassigned exercise' },
        ],
      }],
      [{
        exerciseName: 'wall_balls',
        category: 'conditioning',
        sets: [{ setNumber: 1, blockId: 'block-emom', stepNumber: 2 }],
      }],
    );

    expect(lint.schemaErrors).toEqual([]);
  });
});
