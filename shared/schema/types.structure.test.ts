import { describe, expect, it } from 'vitest';
import { structureBlockSchema } from './types';

describe('structureBlockSchema EMOM semantics', () => {
  it('accepts EMOM with unique minute indices and rest steps', () => {
    const parsed = structureBlockSchema.safeParse({
      sectionType: 'main',
      formatType: 'emom',
      durationMinutes: 16,
      steps: [
        { stepNumber: 1, minuteIndex: 1, stepType: 'work', exerciseName: 'Burpee Broad Jump', targets: { targetReps: 6 } },
        { stepNumber: 2, minuteIndex: 2, stepType: 'work', exerciseName: 'Sandbag Lunges', targets: { targetReps: 12 } },
        { stepNumber: 3, minuteIndex: 3, stepType: 'work', exerciseName: 'Wall Balls', targets: { targetReps: 15 } },
        { stepNumber: 4, minuteIndex: 4, stepType: 'rest' },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects duplicate minute index in EMOM', () => {
    const parsed = structureBlockSchema.safeParse({
      sectionType: 'main',
      formatType: 'emom',
      durationMinutes: 10,
      steps: [
        { stepNumber: 1, minuteIndex: 1, stepType: 'work', exerciseName: 'Row' },
        { stepNumber: 2, minuteIndex: 1, stepType: 'rest' },
      ],
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects EMOM steps without minute index', () => {
    const parsed = structureBlockSchema.safeParse({
      sectionType: 'main',
      formatType: 'emom',
      durationMinutes: 10,
      steps: [
        { stepNumber: 1, stepType: 'work', exerciseName: 'Row' },
      ],
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects rest step with targets', () => {
    const parsed = structureBlockSchema.safeParse({
      sectionType: 'main',
      formatType: 'emom',
      durationMinutes: 8,
      steps: [
        { stepNumber: 1, minuteIndex: 1, stepType: 'rest', targets: { targetReps: 10 } },
      ],
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects rest step with alias targets', () => {
    const parsed = structureBlockSchema.safeParse({
      sectionType: 'main',
      formatType: 'emom',
      durationMinutes: 8,
      steps: [
        { stepNumber: 1, minuteIndex: 1, stepType: 'rest', targets: { reps: 10 } },
      ],
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects rest step with whitespace-only labels', () => {
    const parsed = structureBlockSchema.safeParse({
      sectionType: 'main',
      formatType: 'emom',
      durationMinutes: 8,
      steps: [
        { stepNumber: 1, minuteIndex: 1, stepType: 'rest', customLabel: '   ' },
      ],
    });
    expect(parsed.success).toBe(false);
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
});
