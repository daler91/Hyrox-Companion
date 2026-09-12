import type { StructureBlockInput } from '@shared/schema';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect,it, vi } from 'vitest';

import type { SetData, StructuredExercise } from '@/components/ExerciseInput';
import { api, type ParseWorkoutStructureResponse } from '@/lib/api';

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

const staleStructureBlock: StructureBlockInput = {
  sectionType: 'main',
  formatType: 'emom',
  durationMinutes: 10,
  steps: [
    {
      stepNumber: 1,
      minuteIndex: 1,
      stepType: 'work',
      exerciseName: 'wall_balls',
      targets: { targetReps: 12 },
    },
  ],
};

const flatParseResponse: ParseWorkoutStructureResponse = {
  exercises: [
    {
      exerciseName: 'rowing',
      category: 'functional',
      sets: [{ setNumber: 1, distance: 500 }],
    },
  ],
  structureBlocks: [],
  warnings: [],
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('generateSummary', () => {
  /** One logged exercise; each set takes its 1-based setNumber from its position. */
  function ex(
    exerciseName: string,
    sets: Omit<SetData, 'setNumber'>[],
    over: Partial<StructuredExercise> = {},
  ): StructuredExercise {
    return {
      exerciseName: exerciseName as StructuredExercise['exerciseName'],
      category: 'functional',
      sets: sets.map((set, index) => ({ setNumber: index + 1, ...set })),
      ...over,
    };
  }

  // Each row: the logged exercises and the one-line summary they render as.
  // Units default to the metric pair; the imperial row passes its own.
  it.each<{
    name: string;
    exercises: StructuredExercise[];
    units?: [weight: string, distance: string];
    expected: string;
  }>([
    {
      name: 'exercises with no sets',
      exercises: [ex('skierg', [])],
      expected: 'SkiErg: completed',
    },
    {
      name: 'a single set with reps',
      exercises: [ex('wall_balls', [{ reps: 15 }])],
      expected: 'Wall Balls: 15 reps',
    },
    {
      name: 'multiple sets with identical reps and weight',
      exercises: [
        ex('sandbag_lunges', [
          { reps: 10, weight: 20 },
          { reps: 10, weight: 20 },
          { reps: 10, weight: 20 },
        ]),
      ],
      expected: 'Sandbag Lunges: 3x10, 20kg',
    },
    {
      name: 'multiple sets with different reps/weights as just a count',
      exercises: [
        ex('sandbag_lunges', [
          { reps: 10, weight: 20 },
          { reps: 8, weight: 20 },
          { reps: 6, weight: 25 },
        ]),
      ],
      expected: 'Sandbag Lunges: 3 sets, 10 reps',
    },
    {
      name: 'distance and time',
      exercises: [ex('rowing', [{ distance: 1000, time: 4.5 }])],
      expected: 'Rowing: 1000 m, 4.5min',
    },
    {
      name: 'a distance label converted for imperial units (mi -> ft)',
      exercises: [ex('sled_push', [{ distance: 50 }])],
      units: ['lbs', 'mi'],
      expected: 'Sled Push: 50 ft',
    },
    {
      name: 'a distance label converted for metric units (km -> m)',
      exercises: [ex('sled_push', [{ distance: 50 }])],
      expected: 'Sled Push: 50 m',
    },
    {
      name: 'custom exercises with and without labels',
      exercises: [
        ex('custom', [{ reps: 10 }], { category: 'custom', customLabel: 'My Special Move' }),
        ex('custom', [{ time: 2 }], { category: 'custom' }),
      ],
      expected: 'My Special Move: 10 reps; Custom: 2min',
    },
    {
      name: 'multiple exercises separated by semicolons',
      exercises: [ex('skierg', [{ distance: 1000 }]), ex('wall_balls', [{ reps: 20, weight: 14 }])],
      expected: 'SkiErg: 1000 m; Wall Balls: 20 reps, 14kg',
    },
    {
      // allSame is true here (undefined weight === undefined weight).
      name: 'multiple sets with only reps and no weight',
      exercises: [ex('burpee_broad_jump', [{ reps: 20 }, { reps: 20 }])],
      expected: 'Burpee Broad Jump: 2x20',
    },
    {
      name: 'multiple sets without reps or time as just N sets',
      exercises: [
        ex('easy_run', [{ distance: 5000 }, { distance: 5000 }], { category: 'running' }),
      ],
      expected: 'Easy Run: 2 sets, 5000 m',
    },
  ])('should format $name', ({ exercises, units = ['kg', 'km'], expected }) => {
    expect(generateSummary(exercises, units[0], units[1])).toBe(expected);
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

    // A fully-populated exercise maps field-for-field: the payload mirrors the
    // input, carrying absent optionals as explicit undefineds (which toEqual
    // treats the same as absent keys).
    expect(payload).toEqual(exercise);
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
        exerciseName: 'back_squat',
        category: 'strength',
        sets: [{ setNumber: 1, reps: 5, weight: 100 }],
        hasUserEdits: true,
      },
      back_squat__2: {
        exerciseName: 'back_squat',
        category: 'strength',
        sets: [{ setNumber: 1, reps: 3, weight: 120 }],
        hasUserEdits: true,
      },
      // Unedited block — the parse result should replace it.
      rowing__3: {
        exerciseName: 'rowing',
        category: 'functional',
        sets: [{ setNumber: 1, distance: 500 }],
      },
    };

    const parsed: Parameters<typeof mergeParsedWithEdits>[0] = [
      // Parser saw a single back_squat; the two edited duplicates stay put.
      { exerciseName: 'back_squat', category: 'strength', sets: [{ setNumber: 1, reps: 5, weight: 80 }] },
      // New exercise the user didn't have — should be appended.
      { exerciseName: 'bench_press', category: 'strength', sets: [{ setNumber: 1, reps: 5, weight: 60 }] },
    ];

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

  it('dedupes parsed EMOM rows against preserved legacy EMOM edited rows', () => {
    const counterRef = { current: 2 };
    const existingBlocks = ['emom__1'];
    const existingData: Record<string, StructuredExercise> = {
      emom__1: {
        exerciseName: 'emom',
        category: 'conditioning',
        sets: [{ setNumber: 1, time: 12 }],
        hasUserEdits: true,
      },
    };

    const parsed: Parameters<typeof mergeParsedWithEdits>[0] = [
      {
        exerciseName: 'EMOM',
        category: 'conditioning',
        sets: [{ setNumber: 1, time: 12 }],
      },
    ];

    const { newBlocks } = mergeParsedWithEdits(parsed, counterRef, existingBlocks, existingData);

    expect(newBlocks).toEqual(['emom__1']);
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
        exerciseName: 'back_squat',
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
  it('converts EMOM adds into custom rows so new data never stores exerciseName=emom', () => {
    const { result } = renderHook(() => useWorkoutEditor(), { wrapper: createQueryWrapper() });

    act(() => {
      result.current.addExercise('emom');
    });

    const blockId = result.current.exerciseBlocks[0];
    expect(result.current.exerciseData[blockId]).toMatchObject({
      exerciseName: 'custom',
      customLabel: 'EMOM',
    });
  });

});

describe('useWorkoutEditor parse results', () => {
  it('clears stale structure blocks when a text parse returns flat exercises', async () => {
    vi.spyOn(api.exercises, 'parseStructured').mockResolvedValueOnce(flatParseResponse);
    const { result } = renderHook(
      () => useWorkoutEditor({ initialStructureBlocks: [staleStructureBlock] }),
      { wrapper: createQueryWrapper() },
    );

    expect(result.current.structureBlocks).toHaveLength(1);

    await act(async () => {
      await result.current.parseMutation.mutateAsync('500m row');
    });

    expect(result.current.structureBlocks).toEqual([]);
    expect(result.current.exerciseBlocks).toHaveLength(1);
    expect(Object.values(result.current.exerciseData)[0]).toMatchObject({
      exerciseName: 'rowing',
    });
  });

  it('clears stale structure blocks when a photo parse returns flat exercises', async () => {
    vi.spyOn(api.exercises, 'parseStructuredFromImage').mockResolvedValueOnce(flatParseResponse);
    const { result } = renderHook(
      () => useWorkoutEditor({ initialStructureBlocks: [staleStructureBlock] }),
      { wrapper: createQueryWrapper() },
    );

    await act(async () => {
      await result.current.parseImageMutation.mutateAsync({
        imageBase64: 'abc123',
        mimeType: 'image/png',
      });
    });

    expect(result.current.structureBlocks).toEqual([]);
    expect(result.current.exerciseBlocks).toHaveLength(1);
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
      result.current.addExercise('back_squat');
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
      result.current.addExercise('back_squat');
    });

    const newBlock = result.current.exerciseBlocks.find((b) => b !== 'back-squat__2');
    expect(newBlock).toBeDefined();
    const suffix = Number.parseInt(newBlock!.split('__').pop() ?? '', 10);
    expect(suffix).toBeGreaterThan(10);
  });
});
