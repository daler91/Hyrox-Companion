import { describe, expect, it, vi } from 'vitest';

import type { IStorage } from '../storage';
import { generateCSV } from './exportService';

describe('exportService - generateCSV', () => {
  const mockUserId = 'user-1';

  const createMockStorage = (
    timeline: unknown[] = [],
    exerciseSets: unknown[] = []
  ): IStorage => {
    return {
      timeline: { getTimeline: vi.fn().mockResolvedValue(timeline) },
      analytics: { getAllExerciseSetsWithDates: vi.fn().mockResolvedValue(exerciseSets) },
    } as unknown as IStorage;
  };

  it('should generate header row for empty data', async () => {
    const storage = createMockStorage([], []);
    const csv = await generateCSV(mockUserId, storage);
    expect(csv).toBe('Date,Type,Status,Focus,Main Workout,Accessory,Notes,Duration,RPE');
  });

  it('should generate basic timeline rows without exercise sets', async () => {
    const timeline = [
      {
        workoutLogId: 'w-1',
        date: '2023-10-01',
        type: 'Run',
        status: 'Completed',
        focus: 'Endurance',
        mainWorkout: '5k',
        accessory: 'Core',
        notes: 'Felt good',
        duration: 30,
        rpe: 5,
      },
    ];
    const storage = createMockStorage(timeline, []);
    const csv = await generateCSV(mockUserId, storage);

    const expectedRows = [
      'Date,Type,Status,Focus,Main Workout,Accessory,Notes,Duration,RPE',
      '2023-10-01,Run,Completed,Endurance,5k,Core,Felt good,30,5'
    ].join('\n');

    expect(csv).toBe(expectedRows);
  });

  it('should generate exercise sets section if present', async () => {
    const timeline = [
      {
        workoutLogId: 'w-1',
        date: '2023-10-01',
        focus: 'Strength',
      },
    ];
    const exerciseSets = [
      {
        workoutLogId: 'w-1',
        date: '2023-10-01',
        exerciseName: 'Squat',
        customLabel: null,
        category: 'Lower Body',
        setNumber: 1,
        reps: 10,
        weight: 135,
        distance: null,
        time: null,
        notes: 'Warmup',
      },
    ];
    const storage = createMockStorage(timeline, exerciseSets);
    const csv = await generateCSV(mockUserId, storage);

    const expectedRows = [
      'Date,Type,Status,Focus,Main Workout,Accessory,Notes,Duration,RPE',
      '2023-10-01,,,Strength,,,,,',
      '',
      '--- EXERCISE SETS (Per-Set Data) ---',
      'Date,Workout,Exercise,Category,Set #,Reps,Weight,Distance (m),Time (min),Notes',
      '2023-10-01,Strength,Squat,Lower Body,1,10,135,,,Warmup'
    ].join('\n');

    expect(csv).toBe(expectedRows);
  });

  it('should correctly escape quotes, commas, and newlines in text fields', async () => {
    const timeline = [
      {
        workoutLogId: 'w-1',
        date: '2023-10-01',
        focus: 'Line 1\nLine 2',
        notes: 'She said, "Hello"',
        mainWorkout: 'A, B, and C',
      },
    ];
    const exerciseSets = [
      {
        workoutLogId: 'w-1',
        date: '2023-10-01',
        exerciseName: 'Bench Press',
        customLabel: 'My "Custom" Bench',
        category: 'Upper Body',
        setNumber: 1,
        reps: 5,
        notes: 'Hard,\nheavy!',
      },
    ];
    const storage = createMockStorage(timeline, exerciseSets);
    const csv = await generateCSV(mockUserId, storage);

    const expectedRows = [
      'Date,Type,Status,Focus,Main Workout,Accessory,Notes,Duration,RPE',
      '2023-10-01,,,"Line 1\nLine 2","A, B, and C",,"She said, ""Hello""",,',
      '',
      '--- EXERCISE SETS (Per-Set Data) ---',
      'Date,Workout,Exercise,Category,Set #,Reps,Weight,Distance (m),Time (min),Notes',
      '2023-10-01,"Line 1\nLine 2","My ""Custom"" Bench",Upper Body,1,5,,,,"Hard,\nheavy!"'
    ].join('\n');

    expect(csv).toBe(expectedRows);
  });

  it('should propagate errors when storage fails', async () => {
    const storage = createMockStorage([], []);
    storage.timeline.getTimeline = vi.fn().mockRejectedValue(new Error('Storage failure'));

    await expect(generateCSV(mockUserId, storage)).rejects.toThrow('Storage failure');
  });

});
