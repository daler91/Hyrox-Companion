import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import React from 'react';
import { describe, expect,it } from 'vitest';

import type { StructuredExercise } from '@/components/ExerciseInput';

import { exerciseToPayload,generateSummary, getBlockExerciseName, makeBlockId, mergeParsedWithEdits, useWorkoutEditor } from '../useWorkoutEditor';

// useWorkoutEditor internally calls useMutation (for the AI parse path),
// which needs a QueryClientProvider around any renderHook call.
function createQueryWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

describe('generateSummary', () => {
  it('should handle exercises with no sets', () => {
    const exercises: StructuredExercise[] = [
      {
        exerciseName: 'skierg',
        category: 'functional',
        sets: []
      }
    ];

    expect(generateSummary(exercises, 'kg', 'km')).toBe('SkiErg: completed');
  });

  it('should format single set with reps', () => {
    const exercises: StructuredExercise[] = [
      {
        exerciseName: 'wall_balls',
        category: 'functional',
        sets: [
          { setNumber: 1, reps: 15 }
        ]
      }
    ];

    expect(generateSummary(exercises, 'kg', 'km')).toBe('Wall Balls: 15 reps');
  });

  it('should format multiple sets with identical reps and weight', () => {
    const exercises: StructuredExercise[] = [
      {
        exerciseName: 'sandbag_lunges',
        category: 'functional',
        sets: [
          { setNumber: 1, reps: 10, weight: 20 },
          { setNumber: 2, reps: 10, weight: 20 },
          { setNumber: 3, reps: 10, weight: 20 }
        ]
      }
    ];

    expect(generateSummary(exercises, 'kg', 'km')).toBe('Sandbag Lunges: 3x10, 20kg');
  });

  it('should format multiple sets with different reps/weights as just count', () => {
    const exercises: StructuredExercise[] = [
      {
        exerciseName: 'sandbag_lunges',
        category: 'functional',
        sets: [
          { setNumber: 1, reps: 10, weight: 20 },
          { setNumber: 2, reps: 8, weight: 20 },
          { setNumber: 3, reps: 6, weight: 25 }
        ]
      }
    ];

    expect(generateSummary(exercises, 'kg', 'km')).toBe('Sandbag Lunges: 3 sets, 10 reps');
  });

  it('should handle distance and time', () => {
    const exercises: StructuredExercise[] = [
      {
        exerciseName: 'rowing',
        category: 'functional',
        sets: [
          { setNumber: 1, distance: 1000, time: 4.5 }
        ]
      }
    ];

    expect(generateSummary(exercises, 'kg', 'km')).toBe('Rowing: 1000m, 4.5min');
  });

  it('should convert distance labels correctly (mi -> ft)', () => {
    const exercises: StructuredExercise[] = [
      {
        exerciseName: 'sled_push',
        category: 'functional',
        sets: [
          { setNumber: 1, distance: 50 }
        ]
      }
    ];

    expect(generateSummary(exercises, 'lbs', 'mi')).toBe('Sled Push: 50ft');
  });

  it('should convert distance labels correctly (km -> m)', () => {
    const exercises: StructuredExercise[] = [
      {
        exerciseName: 'sled_push',
        category: 'functional',
        sets: [
          { setNumber: 1, distance: 50 }
        ]
      }
    ];

    expect(generateSummary(exercises, 'kg', 'km')).toBe('Sled Push: 50m');
  });

  it('should format custom exercises with and without labels', () => {
    const exercises: StructuredExercise[] = [
      {
        exerciseName: 'custom',
        category: 'custom',
        customLabel: 'My Special Move',
        sets: [
          { setNumber: 1, reps: 10 }
        ]
      },
      {
        exerciseName: 'custom',
        category: 'custom',
        sets: [
          { setNumber: 1, time: 2 }
        ]
      }
    ];

    expect(generateSummary(exercises, 'kg', 'km')).toBe('My Special Move: 10 reps; Custom: 2min');
  });

  it('should combine multiple exercises separated by semicolons', () => {
    const exercises: StructuredExercise[] = [
      {
        exerciseName: 'skierg',
        category: 'functional',
        sets: [
          { setNumber: 1, distance: 1000 }
        ]
      },
      {
        exerciseName: 'wall_balls',
        category: 'functional',
        sets: [
          { setNumber: 1, reps: 20, weight: 14 }
        ]
      }
    ];

    expect(generateSummary(exercises, 'kg', 'km')).toBe('SkiErg: 1000m; Wall Balls: 20 reps, 14kg');
  });

  it('should format multiple sets with only reps but no weight correctly', () => {
    const exercises: StructuredExercise[] = [
      {
        exerciseName: 'burpee_broad_jump',
        category: 'functional',
        sets: [
          { setNumber: 1, reps: 20 },
          { setNumber: 2, reps: 20 }
        ]
      }
    ];
    // allSame is true (undefined weight === undefined weight)
    expect(generateSummary(exercises, 'kg', 'km')).toBe('Burpee Broad Jump: 2x20');
  });

  it('should format multiple sets without reps or time as just N sets', () => {
    const exercises: StructuredExercise[] = [
       {
        exerciseName: 'easy_run',
        category: 'running',
        sets: [
          { setNumber: 1, distance: 5000 },
          { setNumber: 2, distance: 5000 }
        ]
       }
    ];
    expect(generateSummary(exercises, 'kg', 'km')).toBe('Easy Run: 2 sets, 5000m');
  });
});


describe('makeBlockId', () => {
  it('should increment the counter and format the ID correctly', () => {
    const counterRef = { current: 0 };

    const id1 = makeBlockId('exercise', counterRef);
    expect(id1).toBe('exercise__1');
    expect(counterRef.current).toBe(1);

    const id2 = makeBlockId('exercise', counterRef);
    expect(id2).toBe('exercise__2');
    expect(counterRef.current).toBe(2);
  });

  it('should handle empty names correctly', () => {
    const counterRef = { current: 5 };
    const id = makeBlockId('', counterRef);
    expect(id).toBe('__6');
    expect(counterRef.current).toBe(6);
  });

  it('should handle names that already contain underscores', () => {
    const counterRef = { current: 10 };
    const id = makeBlockId('some_complex_name', counterRef);
    expect(id).toBe('some_complex_name__11');
    expect(counterRef.current).toBe(11);
  });
});

describe('getBlockExerciseName', () => {
  it('should extract the base name from a standard block ID', () => {
    expect(getBlockExerciseName('squat__1')).toBe('squat');
  });

  it('should extract the base name even if the name contains underscores', () => {
    expect(getBlockExerciseName('bulgarian_split_squat__2')).toBe('bulgarian_split_squat');
    expect(getBlockExerciseName('some__complex__name__3')).toBe('some__complex__name');
  });

  it('should return "custom" for names starting with "custom:"', () => {
    expect(getBlockExerciseName('custom:my_exercise__1')).toBe('custom');
    expect(getBlockExerciseName('custom:another_one__5')).toBe('custom');
  });

  it('should handle block IDs without the expected double underscore gracefully', () => {
    expect(getBlockExerciseName('squat')).toBe('squat');
    expect(getBlockExerciseName('squat_1')).toBe('squat_1');
  });
});

describe('exerciseToPayload', () => {
  it('should format a valid StructuredExercise with sets containing reps, weight, distance, time, and notes', () => {
    const exercise: StructuredExercise = {
      exerciseName: 'custom',
      customLabel: 'Custom Workout',
      category: 'custom',
      confidence: 90,
      sets: [
        {
          setNumber: 1,
          reps: 10,
          weight: 50,
          distance: 100,
          time: 5,
          notes: 'Felt good'
        },
        {
          setNumber: 2,
          reps: 8,
          weight: 55,
          distance: 100,
          time: 5
        }
      ]
    };

    const payload = exerciseToPayload(exercise);

    expect(payload).toEqual({
      exerciseName: 'custom',
      customLabel: 'Custom Workout',
      category: 'custom',
      confidence: 90,
      sets: [
        {
          setNumber: 1,
          reps: 10,
          weight: 50,
          distance: 100,
          time: 5,
          notes: 'Felt good'
        },
        {
          setNumber: 2,
          reps: 8,
          weight: 55,
          distance: 100,
          time: 5,
          notes: undefined
        }
      ]
    });
  });

  it('should format correctly when sets array is empty', () => {
    const exercise: StructuredExercise = {
      exerciseName: 'running',
      category: 'running',
      sets: []
    };

    const payload = exerciseToPayload(exercise);

    expect(payload).toEqual({
      exerciseName: 'running',
      customLabel: undefined,
      category: 'running',
      confidence: undefined,
      sets: []
    });
  });

  it('should handle undefined sets gracefully', () => {
    // Need to cast to bypass TypeScript complaining about missing sets property
    // since StructuredExercise interface expects sets to be defined,
    // but the function defensively handles it: `(ex.sets || []).map(...)`
    const exercise = {
      exerciseName: 'wall_balls',
      category: 'functional',
      // sets is omitted
    } as unknown as StructuredExercise;

    const payload = exerciseToPayload(exercise);

    expect(payload).toEqual({
      exerciseName: 'wall_balls',
      customLabel: undefined,
      category: 'functional',
      confidence: undefined,
      sets: []
    });
  });
});

describe('mergeParsedWithEdits', () => {
  it('preserves every edited block even when two share the same exerciseName + customLabel', () => {
    // UI supports "log as separate block" — a user can end up with two
    // back-squat blocks that both have hasUserEdits set. The merge
    // MUST keep both; earlier versions deduped by key and silently
    // dropped the second block on re-parse.
    const counterRef = { current: 10 };
    const existingBlocks = ['back_squat__1', 'back_squat__2', 'rowing__3'];
    const existingData: Record<string, StructuredExercise> = {
      back_squat__1: {
        exerciseName: 'back_squat' as never,
        category: 'strength',
        sets: [{ setNumber: 1, reps: 5, weight: 100 }],
        hasUserEdits: true,
      },
      back_squat__2: {
        exerciseName: 'back_squat' as never,
        category: 'strength',
        sets: [{ setNumber: 1, reps: 3, weight: 120 }],
        hasUserEdits: true,
      },
      // Unedited block — the parse result should replace it.
      rowing__3: {
        exerciseName: 'rowing' as never,
        category: 'functional',
        sets: [{ setNumber: 1, distance: 500 }],
      },
    };

    const parsed = [
      // Parser saw a single back_squat; the two edited duplicates stay put.
      { exerciseName: 'back_squat', category: 'strength', sets: [{ setNumber: 1, reps: 5, weight: 80 }] },
      // New exercise the user didn't have — should be appended.
      { exerciseName: 'bench_press', category: 'strength', sets: [{ setNumber: 1, reps: 5, weight: 60 }] },
    ] as unknown as Parameters<typeof mergeParsedWithEdits>[0];

    const { newBlocks, newData } = mergeParsedWithEdits(parsed, counterRef, existingBlocks, existingData);

    expect(newBlocks).toContain('back_squat__1');
    expect(newBlocks).toContain('back_squat__2');
    // Parsed back_squat was skipped because an edited block already covers that key.
    const parsedBackSquatBlock = newBlocks.find((id) => id.startsWith('back_squat__') && id !== 'back_squat__1' && id !== 'back_squat__2');
    expect(parsedBackSquatBlock).toBeUndefined();
    // bench_press appended from the parse.
    const benchBlock = newBlocks.find((id) => id.startsWith('bench_press__'));
    expect(benchBlock).toBeDefined();
    // The unedited rowing block is dropped — the parse is the source of
    // truth for unedited content.
    expect(newBlocks).not.toContain('rowing__3');
    // Both user edits preserved with their original weights.
    expect(newData['back_squat__1'].sets[0].weight).toBe(100);
    expect(newData['back_squat__2'].sets[0].weight).toBe(120);
  });
});

describe('useWorkoutEditor initialExerciseData', () => {
  it('marks every restored block as user-edited so legacy drafts survive the first auto-parse', () => {
    // Drafts saved before the `hasUserEdits` flag existed don't carry
    // it. When the editor rehydrates from such a draft and the user's
    // free text triggers auto-parse, the merge MUST preserve those
    // blocks — otherwise the first debounced parse silently wipes
    // structured rows the user had already built.
    const initialData: Record<string, StructuredExercise> = {
      back_squat__1: {
        exerciseName: 'back_squat' as never,
        category: 'strength',
        sets: [{ setNumber: 1, reps: 5, weight: 100 }],
        // NB: no hasUserEdits — the draft pre-dates the field.
      },
    };
    const { result } = renderHook(
      () => useWorkoutEditor({
        initialExerciseBlocks: ['back_squat__1'],
        initialExerciseData: initialData,
      }),
      { wrapper: createQueryWrapper() },
    );
    expect(result.current.exerciseData.back_squat__1.hasUserEdits).toBe(true);
  });
});

describe('useWorkoutEditor resetEditor', () => {
  it('seeds block counter from the max suffix in hydrated block ids so subsequent addExercise calls do not collide', () => {
    const { result } = renderHook(() => useWorkoutEditor(), { wrapper: createQueryWrapper() });

    // Hydrate with an existing block whose suffix is 3. Without
    // re-seeding, the default counter (0) would produce "back-squat__1"
    // on the first addExercise call, which doesn't collide here — but
    // with duplicated workouts having multiple blocks, the next
    // addExercise at counter=1 would produce the same key as a hydrated
    // one. Seed to the max suffix to avoid this.
    const hydratedBlock = 'back-squat__3';
    const hydratedData: Record<string, StructuredExercise> = {
      [hydratedBlock]: {
        exerciseName: 'back-squat' as never,
        category: 'strength',
        sets: [{ setNumber: 1, reps: 5, weight: 100 }],
      },
    };

    act(() => {
      result.current.resetEditor([hydratedBlock], hydratedData, false);
    });

    // Adding a new back-squat should produce __4, not __1 (collision).
    act(() => {
      result.current.addExercise('back_squat' as never);
    });

    const allBlocks = result.current.exerciseBlocks;
    expect(allBlocks).toContain('back-squat__3');
    const newBlock = allBlocks.find((b) => b !== 'back-squat__3');
    expect(newBlock).toBeDefined();
    // The suffix on the new block must be > 3.
    const suffix = Number.parseInt(newBlock!.split('__').pop() ?? '', 10);
    expect(suffix).toBeGreaterThan(3);
  });

  it('does not lower an already-higher counter when reset with lower-suffix blocks', () => {
    const { result } = renderHook(() => useWorkoutEditor({ initialBlockCounter: 10 }), { wrapper: createQueryWrapper() });

    act(() => {
      result.current.resetEditor(['back-squat__2'], {
        'back-squat__2': {
          exerciseName: 'back-squat' as never,
          category: 'strength',
          sets: [{ setNumber: 1, reps: 5 }],
        },
      }, false);
    });

    act(() => {
      result.current.addExercise('back_squat' as never);
    });

    const newBlock = result.current.exerciseBlocks.find((b) => b !== 'back-squat__2');
    expect(newBlock).toBeDefined();
    const suffix = Number.parseInt(newBlock!.split('__').pop() ?? '', 10);
    expect(suffix).toBeGreaterThan(10);
  });
});
