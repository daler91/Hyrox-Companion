import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach,beforeEach, describe, expect, it, vi } from 'vitest';
// Mocks
import * as wouter from 'wouter';

import type { StructuredExercise } from '@/components/ExerciseInput';
import * as toastHook from '@/hooks/use-toast';
import * as voiceInputHook from '@/hooks/useVoiceInput';
import * as workoutEditorHook from '@/hooks/useWorkoutEditor';
import * as queryClientLib from '@/lib/queryClient';

import { useWorkoutForm } from '../useWorkoutForm';
import type { UseWorkoutFormProps } from '../workout-form/types';

vi.mock('wouter', () => ({
  useLocation: vi.fn(),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: vi.fn(),
}));

vi.mock('@/hooks/useVoiceInput', () => ({
  useVoiceInput: vi.fn(),
}));

vi.mock('@/lib/queryClient', () => ({
  apiRequest: vi.fn(),
  queryClient: {
    invalidateQueries: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/hooks/useWorkoutEditor', () => ({
  generateSummary: vi.fn(),
  exerciseToPayload: vi.fn(),
}));

// Setup Test QueryClient
const testQueryClient = new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
});
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={testQueryClient}>{children}</QueryClientProvider>
);

interface FailedSaveToast {
  readonly title: string;
  readonly description: string;
  readonly variant: "destructive";
}

interface ExpectFailedSaveToastArgs {
  readonly error: unknown;
  readonly expectedToast: FailedSaveToast;
  readonly defaultProps: UseWorkoutFormProps;
  readonly renderFormHook: (props: UseWorkoutFormProps) => {
    readonly result: { readonly current: ReturnType<typeof useWorkoutForm> };
  };
  readonly mockToast: (toast: FailedSaveToast) => void;
  readonly mockNavigate: (path: string) => void;
}

type ExercisePayload = ReturnType<typeof workoutEditorHook.exerciseToPayload>;

function createExercisePayload(
  exerciseName: ExercisePayload["exerciseName"],
  set: Partial<ExercisePayload["sets"][number]>,
): ExercisePayload {
  return {
    exerciseName,
    customLabel: undefined,
    category: "",
    confidence: undefined,
    sets: [{
      setNumber: 1,
      reps: undefined,
      weight: undefined,
      distance: undefined,
      time: undefined,
      plannedReps: undefined,
      plannedWeight: undefined,
      plannedDistance: undefined,
      plannedTime: undefined,
      blockId: undefined,
      stepNumber: undefined,
      intervalMinute: undefined,
      cycleNumber: undefined,
      stepRole: undefined,
      groupId: undefined,
      notes: undefined,
      ...set,
    }],
  };
}

async function expectFailedSaveToast({
  error,
  expectedToast,
  defaultProps,
  renderFormHook,
  mockToast,
  mockNavigate,
}: ExpectFailedSaveToastArgs) {
  vi.mocked(queryClientLib.apiRequest).mockRejectedValueOnce(error);

  const { result } = renderFormHook({ ...defaultProps, useTextMode: true });

  act(() => {
    result.current.setTitle('Failed Workout');
    result.current.setFreeText('Did things');
  });

  act(() => {
    result.current.handleSave();
  });

  await waitFor(() => {
    expect(mockToast).toHaveBeenCalledWith(expectedToast);
    expect(queryClientLib.queryClient.invalidateQueries).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });
}

describe('useWorkoutForm', () => {
  const mockToast = vi.fn();
  const mockNavigate = vi.fn();
  const mockVoiceInput = {
    isListening: false,
    startListening: vi.fn(),
    stopListening: vi.fn(),
  };
  const mockNotesVoiceInput = {
    isListening: false,
    startListening: vi.fn(),
    stopListening: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    testQueryClient.clear();

    vi.mocked(toastHook.useToast).mockReturnValue({ toast: mockToast } as unknown as ReturnType<typeof toastHook.useToast>);
    vi.mocked(wouter.useLocation).mockReturnValue(['/current', mockNavigate]);
    vi.mocked(queryClientLib.apiRequest).mockImplementation(async () =>
      new Response(JSON.stringify({ success: true })),
    );
    vi.mocked(queryClientLib.queryClient.invalidateQueries).mockResolvedValue(undefined);

    // Mock useVoiceInput returns
    let callCount = 0;
    vi.mocked(voiceInputHook.useVoiceInput).mockImplementation((_params) => {
      callCount++;
      const isFirst = callCount % 2 !== 0;
      if (isFirst) {
        return mockVoiceInput as unknown as ReturnType<typeof voiceInputHook.useVoiceInput>;
      }
      return mockNotesVoiceInput as unknown as ReturnType<typeof voiceInputHook.useVoiceInput>;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });


  const defaultProps: UseWorkoutFormProps = {
    useTextMode: true,
    exerciseBlocks: [],
    exerciseData: {},
    structureBlocks: [],
    weightLabel: 'kg',
    distanceUnit: 'km',
  };

  const setupVoiceMocks = () => {
    let mainVoiceHandler: Parameters<typeof voiceInputHook.useVoiceInput>[0] | undefined;
    let notesVoiceHandler: Parameters<typeof voiceInputHook.useVoiceInput>[0] | undefined;
    let renderCallCount = 0;

    vi.mocked(voiceInputHook.useVoiceInput).mockImplementation((params) => {
      renderCallCount++;
      // Reset count every 2 calls (since there are 2 hooks per render)
      const isFirst = renderCallCount % 2 !== 0;

      if (isFirst) {
        mainVoiceHandler = params;
        return mockVoiceInput as unknown as ReturnType<typeof voiceInputHook.useVoiceInput>;
      } else {
        notesVoiceHandler = params;
        return mockNotesVoiceInput as unknown as ReturnType<typeof voiceInputHook.useVoiceInput>;
      }
    });

    return {
      getMainHandler: () => mainVoiceHandler,
      getNotesHandler: () => notesVoiceHandler
    };
  };

  const renderFormHook = (props: UseWorkoutFormProps = defaultProps) => renderHook(() => useWorkoutForm(props), { wrapper });


  it('initializes with default state', () => {
    const { result } = renderFormHook(defaultProps);

    expect(result.current.title).toBe('');
    expect(result.current.date).toBe(new Date().toISOString().split('T')[0]);
    expect(result.current.freeText).toBe('');
    expect(result.current.notes).toBe('');
    expect(result.current.durationMinutes).toBe('');
  });

  describe('State management', () => {
    it('updates state fields correctly', () => {
      const { result } = renderFormHook(defaultProps);

      act(() => {
        result.current.setTitle('My Workout');
        result.current.setDate('2024-05-01');
        result.current.setFreeText('Run 5k');
        result.current.setNotes('Felt great');
        result.current.setDurationMinutes('48');
      });

      expect(result.current.title).toBe('My Workout');
      expect(result.current.date).toBe('2024-05-01');
      expect(result.current.freeText).toBe('Run 5k');
      expect(result.current.notes).toBe('Felt great');
      expect(result.current.durationMinutes).toBe('48');
    });
  });

  describe('Voice Input Handlers', () => {
    it('appends voice result with a space if needed', () => {
      const handlers = setupVoiceMocks();

      const { result } = renderFormHook(defaultProps);

      act(() => {
        result.current.setFreeText('Running');
        result.current.setNotes('Fast');
      });

      act(() => {
        handlers.getMainHandler()!.onResult!("is fun");
        handlers.getNotesHandler()!.onResult!("and fun");
      });

      expect(result.current.freeText).toBe('Running is fun');
      expect(result.current.notes).toBe('Fast and fun');
    });

    it('does not append space if text already ends with a space or newline', () => {
      const handlers = setupVoiceMocks();

      const { result } = renderFormHook(defaultProps);

      act(() => {
        result.current.setFreeText('Running ');
      });

      act(() => {
        handlers.getMainHandler()!.onResult!("is fun");
      });

      expect(result.current.freeText).toBe('Running is fun');

      act(() => {
        result.current.setFreeText('Running\n');
      });

      act(() => {
        handlers.getMainHandler()!.onResult!("is fun");
      });

      expect(result.current.freeText).toBe('Running\nis fun');
    });

    it('triggers destructive toast with a retry action on voice error', () => {
      const handlers = setupVoiceMocks();

      renderFormHook(defaultProps);

      act(() => {
        handlers.getMainHandler()!.onError!("Microphone not found");
      });

      expect(mockToast).toHaveBeenCalledTimes(1);
      const call = mockToast.mock.calls[0][0];
      expect(call.title).toBe('Voice input failed');
      expect(call.description).toBe('Microphone not found');
      expect(call.variant).toBe('destructive');
      // The retry action is a JSX element; just verify it was supplied.
      expect(call.action).toBeDefined();
    });
  });

  describe('Validation Logic (handleSave)', () => {
    it('stops active voice listening on save', () => {
      const activeVoiceInput = { ...mockVoiceInput, isListening: true };
      const activeNotesVoiceInput = { ...mockNotesVoiceInput, isListening: true };

      let callCount = 0;
      vi.mocked(voiceInputHook.useVoiceInput).mockImplementation(() => {
        callCount++;
        const isFirst = callCount % 2 !== 0;
        return isFirst ? activeVoiceInput as unknown as ReturnType<typeof voiceInputHook.useVoiceInput> : activeNotesVoiceInput as unknown as ReturnType<typeof voiceInputHook.useVoiceInput>;
      });

      const { result } = renderFormHook(defaultProps);

      act(() => {
        result.current.handleSave();
      });

      expect(activeVoiceInput.stopListening).toHaveBeenCalled();
      expect(activeNotesVoiceInput.stopListening).toHaveBeenCalled();
    });

    it('uses fallback title "Workout" when title is empty', async () => {
      const { result } = renderFormHook({ ...defaultProps, useTextMode: true });

      act(() => {
        result.current.setFreeText('5km run');
      });

      act(() => {
        result.current.handleSave();
      });

      await waitFor(() => {
        expect(queryClientLib.apiRequest).toHaveBeenCalledWith(
          'POST',
          '/api/v1/workouts',
          expect.objectContaining({ title: 'Workout', focus: 'Workout' }),
          expect.any(AbortSignal),
          expect.objectContaining({ "X-Idempotency-Key": expect.any(String) }),
        );
      });
    });

    it('requires content when the composer has no exercises and no free text', () => {
      const { result } = renderFormHook({ ...defaultProps, useTextMode: true });

      act(() => {
        result.current.setTitle('My Workout');
        result.current.setFreeText('   '); // Empty spaces
      });

      act(() => {
        result.current.handleSave();
      });

      expect(mockToast).toHaveBeenCalledWith({
        title: 'Missing workout details',
        description: 'Please add an exercise or describe your workout.',
        variant: 'destructive',
      });
      expect(queryClientLib.apiRequest).not.toHaveBeenCalled();
    });

    it('also errors when structured mode has no blocks and no free text', () => {
      const { result } = renderFormHook({ ...defaultProps, useTextMode: false, exerciseBlocks: [] });

      act(() => {
        result.current.setTitle('My Builder Workout');
      });

      act(() => {
        result.current.handleSave();
      });

      expect(mockToast).toHaveBeenCalledWith({
        title: 'Missing workout details',
        description: 'Please add an exercise or describe your workout.',
        variant: 'destructive',
      });
      expect(queryClientLib.apiRequest).not.toHaveBeenCalled();
    });

    it('blocks save when text exists but there are no structured rows', () => {
      const { result } = renderFormHook({ ...defaultProps, useTextMode: false, exerciseBlocks: ['missing-row'] });

      act(() => {
        result.current.setFreeText('Parsed text that did not create rows');
      });

      act(() => {
        result.current.handleSave();
      });

      expect(mockToast).toHaveBeenCalledWith({
        title: 'Missing workout details',
        description: 'Please add at least one structured exercise row or run Parse before saving.',
        variant: 'destructive',
      });
      expect(queryClientLib.apiRequest).not.toHaveBeenCalled();
    });
  });

  describe('Successful Save (handleSave)', () => {
    it('saves successfully in Text Mode', async () => {
      const { result } = renderFormHook({ ...defaultProps, useTextMode: true });

      act(() => {
        result.current.setTitle('My Run');
        result.current.setDate('2024-05-01');
        result.current.setFreeText('Ran 5k in 25 mins');
        result.current.setNotes('Felt great');
        result.current.setDurationMinutes('25');
      });

      act(() => {
        result.current.handleSave();
      });

      await waitFor(() => {
        expect(queryClientLib.apiRequest).toHaveBeenCalledWith('POST', '/api/v1/workouts', {
          title: 'My Run',
          date: '2024-05-01',
          focus: 'My Run',
          mainWorkout: 'Ran 5k in 25 mins',
          notes: 'Felt great',
          rpe: null,
          duration: 25,
        }, expect.any(AbortSignal), expect.objectContaining({ "X-Idempotency-Key": expect.any(String) }));
      });
    });

    it('saves successfully in Builder Mode', async () => {
      const mockExercise: StructuredExercise = {
        exerciseName: 'back_squat',
        category: 'strength',
        sets: [{ setNumber: 1, reps: 10, weight: 100 }],
      };
      const mockExerciseData = {
        'block-1': mockExercise,
      };

      vi.mocked(workoutEditorHook.generateSummary).mockReturnValue('Squat: 10 reps, 100kg');
      vi.mocked(workoutEditorHook.exerciseToPayload).mockReturnValue(
        createExercisePayload('back_squat', { reps: 10, weight: 100 }),
      );

      const props = {
        ...defaultProps,
        useTextMode: false,
        exerciseBlocks: ['block-1', 'invalid-block'], // 'invalid-block' is missing from data
        exerciseData: mockExerciseData,
      };

      const { result } = renderFormHook(props);

      act(() => {
        result.current.setTitle('Leg Day');
        result.current.setDate('2024-05-02');
        result.current.setNotes('Heavy lifts');
      });

      act(() => {
        result.current.handleSave();
      });

      await waitFor(() => {
        // Verification that `generateSummary` receives filtered blocks
        expect(workoutEditorHook.generateSummary).toHaveBeenCalledWith([mockExercise], 'kg', 'km');
        expect(workoutEditorHook.exerciseToPayload).toHaveBeenCalledWith(mockExercise, 0, [mockExercise]);

        expect(queryClientLib.apiRequest).toHaveBeenCalledWith('POST', '/api/v1/workouts', {
          title: 'Leg Day',
          date: '2024-05-02',
          focus: 'Leg Day',
          mainWorkout: 'Squat: 10 reps, 100kg',
          notes: 'Heavy lifts',
          rpe: null,
          exercises: [
            expect.objectContaining({
              exerciseName: 'back_squat',
              sets: [expect.objectContaining({ setNumber: 1, reps: 10, weight: 100 })],
            }),
          ],
        }, expect.any(AbortSignal), expect.objectContaining({ "X-Idempotency-Key": expect.any(String) }));
      });
    });

    it('allows save when structured rows are present with free text', async () => {
      const mockExercise: StructuredExercise = {
        exerciseName: 'easy_run',
        category: 'running',
        sets: [{ setNumber: 1, reps: 1, time: 20 }],
      };
      vi.mocked(workoutEditorHook.exerciseToPayload).mockReturnValue(
        createExercisePayload('easy_run', { reps: 1, time: 20 }),
      );

      const { result } = renderFormHook({
        ...defaultProps,
        useTextMode: false,
        exerciseBlocks: ['block-1'],
        exerciseData: { 'block-1': mockExercise },
      });

      act(() => {
        result.current.setTitle('Structured + text');
        result.current.setFreeText('Use this as main workout text');
      });

      act(() => {
        result.current.handleSave();
      });

      await waitFor(() => {
        expect(queryClientLib.apiRequest).toHaveBeenCalledWith(
          'POST',
          '/api/v1/workouts',
          expect.objectContaining({
            title: 'Structured + text',
            mainWorkout: 'Use this as main workout text',
            exercises: [
              expect.objectContaining({
                exerciseName: 'easy_run',
                sets: [expect.objectContaining({ setNumber: 1, reps: 1, time: 20 })],
              }),
            ],
          }),
          expect.any(AbortSignal),
          expect.objectContaining({ "X-Idempotency-Key": expect.any(String) }),
        );
      });
    });

    it('handles saving with null notes if notes are empty', async () => {
      const { result } = renderFormHook({ ...defaultProps, useTextMode: true });

      act(() => {
        result.current.setTitle('My Run');
        result.current.setDate('2024-05-01');
        result.current.setFreeText('Ran 5k');
        result.current.setNotes(''); // Empty notes
      });

      act(() => {
        result.current.handleSave();
      });

      await waitFor(() => {
        expect(queryClientLib.apiRequest).toHaveBeenCalledWith('POST', '/api/v1/workouts', expect.objectContaining({
          notes: null, // Should be normalized to null
        }), expect.any(AbortSignal), expect.objectContaining({ "X-Idempotency-Key": expect.any(String) }));
      });
    });
  });

  describe('Mutation Side Effects', () => {
    it('triggers success callbacks and navigation on successful save', async () => {
      const { result } = renderFormHook({ ...defaultProps, useTextMode: true });

      act(() => {
        result.current.setTitle('Success Workout');
        result.current.setFreeText('Did things');
      });

      act(() => {
        result.current.handleSave();
      });

      await waitFor(() => {
        expect(queryClientLib.queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["/api/v1/workouts"] });
        expect(queryClientLib.queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["/api/v1/timeline"] });
        expect(mockToast).toHaveBeenCalledWith({
          title: "Workout logged",
          description: "Your workout has been saved successfully.",
        });
        expect(mockNavigate).toHaveBeenCalledWith("/");
      });
    });

    it('shows structured rows error toast for STRUCTURED_ROWS_REQUIRED failures', async () => {
      await expectFailedSaveToast({
        error: { response: { data: { code: 'STRUCTURED_ROWS_REQUIRED' } } },
        expectedToast: {
          title: "Workout needs structured rows",
          description: "Tap Parse or add at least one exercise set before saving.",
          variant: "destructive",
        },
        defaultProps,
        renderFormHook,
        mockToast,
        mockNavigate,
      });
    });

    it('triggers generic error toast on failed save', async () => {
      await expectFailedSaveToast({
        error: new Error('500: Internal Server Error'),
        expectedToast: {
          title: "Error",
          description: "Failed to save workout. Please try again.",
          variant: "destructive",
        },
        defaultProps,
        renderFormHook,
        mockToast,
        mockNavigate,
      });
    });
  });
});
