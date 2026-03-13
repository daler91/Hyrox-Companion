import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateJSON, generateCSV } from './exportService';
import type { IStorage } from '../storage';

describe('exportService', () => {
  let mockStorage: Partial<IStorage>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T12:00:00.000Z'));

    mockStorage = {
      getTimeline: vi.fn(),
      listTrainingPlans: vi.fn(),
      getAllExerciseSetsWithDates: vi.fn(),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('generateJSON', () => {
    it('should generate empty JSON when no data exists', async () => {
      vi.mocked(mockStorage.getTimeline!).mockResolvedValue([]);
      vi.mocked(mockStorage.listTrainingPlans!).mockResolvedValue([]);
      vi.mocked(mockStorage.getAllExerciseSetsWithDates!).mockResolvedValue([]);

      const result = await generateJSON('user_1', mockStorage as IStorage);

      expect(result).toEqual({
        timeline: [],
        plans: [],
        exerciseSets: [],
        exportedAt: '2024-01-01T12:00:00.000Z',
      });

      expect(mockStorage.getTimeline).toHaveBeenCalledWith('user_1');
      expect(mockStorage.listTrainingPlans).toHaveBeenCalledWith('user_1');
      expect(mockStorage.getAllExerciseSetsWithDates).toHaveBeenCalledWith('user_1');
    });

    it('should generate JSON with complete user data', async () => {
      const mockTimeline = [
        {
          workoutLogId: 'log_1',
          date: '2024-01-01',
          type: 'Strength',
          status: 'completed',
          focus: 'Leg Day',
          mainWorkout: 'Squats',
          accessory: 'Lunges',
          notes: 'Felt strong',
          duration: 60,
          rpe: 8,
        },
      ];

      const mockPlans = [
        { id: 1, name: 'Hypertrophy Block' } as any,
      ];

      const mockExerciseSets = [
        {
          date: '2024-01-01',
          workoutLogId: 'log_1',
          exerciseName: 'Barbell Squat',
          customLabel: null,
          category: 'legs',
          setNumber: 1,
          reps: 5,
          weight: 100,
          distance: null,
          time: null,
          notes: 'Warmup',
        },
      ];

      vi.mocked(mockStorage.getTimeline!).mockResolvedValue(mockTimeline as any);
      vi.mocked(mockStorage.listTrainingPlans!).mockResolvedValue(mockPlans as any);
      vi.mocked(mockStorage.getAllExerciseSetsWithDates!).mockResolvedValue(mockExerciseSets as any);

      const result = await generateJSON('user_1', mockStorage as IStorage);

      expect(result).toEqual({
        timeline: mockTimeline,
        plans: mockPlans,
        exerciseSets: [
          {
            date: '2024-01-01',
            workoutTitle: 'Leg Day',
            exerciseName: 'Barbell Squat',
            customLabel: null,
            category: 'legs',
            setNumber: 1,
            reps: 5,
            weight: 100,
            distance: null,
            time: null,
            notes: 'Warmup',
          },
        ],
        exportedAt: '2024-01-01T12:00:00.000Z',
      });
    });

    it('should map workoutTitle as empty string if workoutLogId has no matching focus', async () => {
      const mockTimeline = [
        { workoutLogId: 'log_1', focus: null },
        { workoutLogId: 'log_2' },
      ];

      const mockExerciseSets = [
        { workoutLogId: 'log_1', exerciseName: 'A', setNumber: 1 },
        { workoutLogId: 'log_3', exerciseName: 'B', setNumber: 1 },
      ];

      vi.mocked(mockStorage.getTimeline!).mockResolvedValue(mockTimeline as any);
      vi.mocked(mockStorage.listTrainingPlans!).mockResolvedValue([]);
      vi.mocked(mockStorage.getAllExerciseSetsWithDates!).mockResolvedValue(mockExerciseSets as any);

      const result = await generateJSON('user_1', mockStorage as IStorage);

      expect(result.exerciseSets).toEqual([
        {
          workoutTitle: '',
          exerciseName: 'A',
          setNumber: 1,
          category: undefined,
          customLabel: undefined,
          date: undefined,
          distance: undefined,
          notes: undefined,
          reps: undefined,
          time: undefined,
          weight: undefined
        },
        {
          workoutTitle: '',
          exerciseName: 'B',
          setNumber: 1,
          category: undefined,
          customLabel: undefined,
          date: undefined,
          distance: undefined,
          notes: undefined,
          reps: undefined,
          time: undefined,
          weight: undefined
        },
      ]);
    });
  });

  describe('generateCSV', () => {
    it('should generate empty CSV structure when no data exists', async () => {
      vi.mocked(mockStorage.getTimeline!).mockResolvedValue([]);
      vi.mocked(mockStorage.getAllExerciseSetsWithDates!).mockResolvedValue([]);

      const result = await generateCSV('user_1', mockStorage as IStorage);
      const expectedCSV = "Date,Type,Status,Focus,Main Workout,Accessory,Notes,Duration,RPE";

      expect(result).toBe(expectedCSV);
      expect(mockStorage.getTimeline).toHaveBeenCalledWith('user_1');
      expect(mockStorage.getAllExerciseSetsWithDates).toHaveBeenCalledWith('user_1');
    });

    it('should generate CSV with timeline and exercise sets', async () => {
      const mockTimeline = [
        {
          workoutLogId: 'log_1',
          date: '2024-01-01',
          type: 'Strength',
          status: 'completed',
          focus: 'Leg Day',
          mainWorkout: 'Squats',
          accessory: 'Lunges',
          notes: 'Felt strong',
          duration: 60,
          rpe: 8,
        },
      ];

      const mockExerciseSets = [
        {
          date: '2024-01-01',
          workoutLogId: 'log_1',
          exerciseName: 'Barbell Squat',
          customLabel: null,
          category: 'legs',
          setNumber: 1,
          reps: 5,
          weight: 100,
          distance: null,
          time: null,
          notes: 'Warmup',
        },
      ];

      vi.mocked(mockStorage.getTimeline!).mockResolvedValue(mockTimeline as any);
      vi.mocked(mockStorage.getAllExerciseSetsWithDates!).mockResolvedValue(mockExerciseSets as any);

      const result = await generateCSV('user_1', mockStorage as IStorage);

      const lines = result.split('\n');
      expect(lines[0]).toBe("Date,Type,Status,Focus,Main Workout,Accessory,Notes,Duration,RPE");
      expect(lines[1]).toBe("2024-01-01,Strength,completed,Leg Day,Squats,Lunges,Felt strong,60,8");

      // Checking for the exercise set section separator
      expect(lines[2]).toBe("");
      expect(lines[3]).toBe("--- EXERCISE SETS (Per-Set Data) ---");
      expect(lines[4]).toBe("Date,Workout,Exercise,Category,Set #,Reps,Weight,Distance (m),Time (min),Notes");

      // customLabel is null, fallback to exerciseName
      expect(lines[5]).toBe("2024-01-01,Leg Day,Barbell Squat,legs,1,5,100,,,Warmup");
    });

    it('should properly escape csv fields containing commas, quotes, or newlines', async () => {
      const mockTimeline = [
        {
          workoutLogId: 'log_1',
          date: '2024-01-01',
          type: 'Strength',
          status: 'completed',
          focus: 'Arms, Chest, and Back', // Contains comma
          mainWorkout: 'Bench "Press"', // Contains quote
          accessory: 'Curls\nExtensions', // Contains newline
          notes: null,
          duration: null,
          rpe: null,
        },
      ];

      const mockExerciseSets = [
        {
          date: '2024-01-01',
          workoutLogId: 'log_1',
          exerciseName: 'Bench Press',
          customLabel: 'Bench "Press"', // Quote
          category: 'chest',
          setNumber: 1,
          reps: 5,
          weight: 100,
          distance: null,
          time: null,
          notes: 'Hard, but good', // Comma
        },
      ];

      vi.mocked(mockStorage.getTimeline!).mockResolvedValue(mockTimeline as any);
      vi.mocked(mockStorage.getAllExerciseSetsWithDates!).mockResolvedValue(mockExerciseSets as any);

      const result = await generateCSV('user_1', mockStorage as IStorage);

      expect(result).toContain('2024-01-01,Strength,completed,"Arms, Chest, and Back","Bench ""Press""","Curls\nExtensions",,,');
      expect(result).toContain('2024-01-01,"Arms, Chest, and Back","Bench ""Press""",chest,1,5,100,,,"Hard, but good"');
    });
  });
});
