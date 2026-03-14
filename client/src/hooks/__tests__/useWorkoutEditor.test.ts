import { describe, it, expect } from 'vitest';
import { generateSummary } from '../useWorkoutEditor';
import type { StructuredExercise } from '@/components/ExerciseInput';

describe('generateSummary', () => {
  it('should handle exercises with no sets', () => {
    const exercises: StructuredExercise[] = [
      {
        exerciseName: 'skierg',
        category: 'hyrox_station',
        sets: []
      }
    ];

    expect(generateSummary(exercises, 'kg', 'km')).toBe('SkiErg: completed');
  });

  it('should format single set with reps', () => {
    const exercises: StructuredExercise[] = [
      {
        exerciseName: 'wall_balls',
        category: 'hyrox_station',
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
        category: 'hyrox_station',
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
        category: 'hyrox_station',
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
        category: 'hyrox_station',
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
        category: 'hyrox_station',
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
        category: 'hyrox_station',
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
        category: 'hyrox_station',
        sets: [
          { setNumber: 1, distance: 1000 }
        ]
      },
      {
        exerciseName: 'wall_balls',
        category: 'hyrox_station',
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
        category: 'hyrox_station',
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
    // The current generateSummary logic:
    // If allSame is false or (allSame && !firstSet.reps):
    // if (!firstSet.reps && sets.length > 1), pushes `${sets.length} sets`
    // However allSame relies on `reps` and `weight` being strictly equal, which they are (undefined === undefined).
    // Let's test what the function actually outputs.
    // firstSet = { setNumber: 1, distance: 5000 }
    // allSame = true (reps undefined === undefined, weight undefined === undefined)
    // if (allSame && sets.length > 1 && firstSet.reps) -> false
    // else if (firstSet.reps) -> false
    // else if (sets.length > 1) -> parts.push(`2 sets`)
    // if (allSame && firstSet.weight) -> false
    // if (firstSet.distance) -> parts.push(`5000m`) (since distanceUnit is km)
    // so we expect 'Easy Run: 2 sets, 5000m'
    expect(generateSummary(exercises, 'kg', 'km')).toBe('Easy Run: 2 sets, 5000m');
  });
});
