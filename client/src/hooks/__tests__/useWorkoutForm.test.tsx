import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useWorkoutForm } from '../useWorkoutForm';

// Mocks
import * as wouter from 'wouter';
import * as toastHook from '@/hooks/use-toast';
import * as voiceInputHook from '@/hooks/useVoiceInput';
import * as queryClientLib from '@/lib/queryClient';
import * as workoutEditorHook from '@/hooks/useWorkoutEditor';

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
    invalidateQueries: vi.fn(),
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

    vi.mocked(toastHook.useToast).mockReturnValue({ toast: mockToast } as any);
    vi.mocked(wouter.useLocation).mockReturnValue(['/current', mockNavigate]);
    vi.mocked(queryClientLib.apiRequest).mockResolvedValue({
      json: () => Promise.resolve({ success: true }),
    } as Response);

    // Mock useVoiceInput returns
    let callCount = 0;
    vi.mocked(voiceInputHook.useVoiceInput).mockImplementation((params) => {
      callCount++;
      const isFirst = callCount % 2 !== 0;
      if (isFirst) {
        return mockVoiceInput as any;
      }
      return mockNotesVoiceInput as any;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });


  const defaultProps = {
    useTextMode: true,
    exerciseBlocks: [],
    exerciseData: {},
    weightLabel: 'kg',
    distanceUnit: 'km',
  };

  const setupVoiceMocks = () => {
    let mainVoiceHandler: any;
    let notesVoiceHandler: any;
    let renderCallCount = 0;

    vi.mocked(voiceInputHook.useVoiceInput).mockImplementation((params) => {
      renderCallCount++;
      // Reset count every 2 calls (since there are 2 hooks per render)
      const isFirst = renderCallCount % 2 !== 0;

      if (isFirst) {
        mainVoiceHandler = params;
        return mockVoiceInput as any;
      } else {
        notesVoiceHandler = params;
        return mockNotesVoiceInput as any;
      }
    });

    return {
      getMainHandler: () => mainVoiceHandler,
      getNotesHandler: () => notesVoiceHandler
    };
  };

  const renderFormHook = (props = defaultProps) => renderHook(() => useWorkoutForm(props), { wrapper });


  it('initializes with default state', () => {
    const { result } = renderFormHook(defaultProps);

    expect(result.current.title).toBe('');
    expect(result.current.date).toBe(new Date().toISOString().split('T')[0]);
    expect(result.current.freeText).toBe('');
    expect(result.current.notes).toBe('');
  });

  describe('State management', () => {
    it('updates state fields correctly', () => {
      const { result } = renderFormHook(defaultProps);

      act(() => {
        result.current.setTitle('My Workout');
        result.current.setDate('2024-05-01');
        result.current.setFreeText('Run 5k');
        result.current.setNotes('Felt great');
      });

      expect(result.current.title).toBe('My Workout');
      expect(result.current.date).toBe('2024-05-01');
      expect(result.current.freeText).toBe('Run 5k');
      expect(result.current.notes).toBe('Felt great');
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
        handlers.getMainHandler().onResult('is fun');
        handlers.getNotesHandler().onResult('and fun');
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
        handlers.getMainHandler().onResult('is fun');
      });

      expect(result.current.freeText).toBe('Running is fun');

      act(() => {
        result.current.setFreeText('Running\n');
      });

      act(() => {
        handlers.getMainHandler().onResult('is fun');
      });

      expect(result.current.freeText).toBe('Running\nis fun');
    });

    it('triggers destructive toast on voice error', () => {
      const handlers = setupVoiceMocks();

      renderFormHook(defaultProps);

      act(() => {
        handlers.getMainHandler().onError('Microphone not found');
      });

      expect(mockToast).toHaveBeenCalledWith({
        title: 'Voice Input',
        description: 'Microphone not found',
        variant: 'destructive',
      });
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
        return isFirst ? activeVoiceInput as any : activeNotesVoiceInput as any;
      });

      const { result } = renderFormHook(defaultProps);

      act(() => {
        result.current.handleSave();
      });

      expect(activeVoiceInput.stopListening).toHaveBeenCalled();
      expect(activeNotesVoiceInput.stopListening).toHaveBeenCalled();
    });

    it('requires a title', () => {
      const { result } = renderFormHook(defaultProps);

      act(() => {
        result.current.handleSave();
      });

      expect(mockToast).toHaveBeenCalledWith({
        title: 'Missing title',
        description: 'Please enter a workout title.',
        variant: 'destructive',
      });
      expect(queryClientLib.apiRequest).not.toHaveBeenCalled();
    });

    it('requires freeText when useTextMode is true', () => {
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
        description: 'Please describe your workout.',
        variant: 'destructive',
      });
      expect(queryClientLib.apiRequest).not.toHaveBeenCalled();
    });

    it('requires at least one exercise block when useTextMode is false', () => {
      const { result } = renderFormHook({ ...defaultProps, useTextMode: false, exerciseBlocks: [] });

      act(() => {
        result.current.setTitle('My Builder Workout');
      });

      act(() => {
        result.current.handleSave();
      });

      expect(mockToast).toHaveBeenCalledWith({
        title: 'No exercises',
        description: 'Please add at least one exercise.',
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
      });

      act(() => {
        result.current.handleSave();
      });

      await waitFor(() => {
        expect(queryClientLib.apiRequest).toHaveBeenCalledWith('POST', '/api/workouts', {
          title: 'My Run',
          date: '2024-05-01',
          focus: 'My Run',
          mainWorkout: 'Ran 5k in 25 mins',
          notes: 'Felt great',
        });
      });
    });

    it('saves successfully in Builder Mode', async () => {
      const mockExercise = { exerciseName: 'squat', sets: [{ reps: 10, weight: 100 }] };
      const mockExerciseData = {
        'block-1': mockExercise,
      };

      vi.mocked(workoutEditorHook.generateSummary).mockReturnValue('Squat: 10 reps, 100kg');
      vi.mocked(workoutEditorHook.exerciseToPayload).mockReturnValue({
        exerciseName: 'squat',
        sets: [{ reps: 10, weight: 100 }],
      } as any);

      const props = {
        ...defaultProps,
        useTextMode: false,
        exerciseBlocks: ['block-1', 'invalid-block'], // 'invalid-block' is missing from data
        exerciseData: mockExerciseData as any,
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

        expect(queryClientLib.apiRequest).toHaveBeenCalledWith('POST', '/api/workouts', {
          title: 'Leg Day',
          date: '2024-05-02',
          focus: 'Leg Day',
          mainWorkout: 'Squat: 10 reps, 100kg',
          notes: 'Heavy lifts',
          exercises: [
            { exerciseName: 'squat', sets: [{ reps: 10, weight: 100 }] }
          ]
        });
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
        expect(queryClientLib.apiRequest).toHaveBeenCalledWith('POST', '/api/workouts', expect.objectContaining({
          notes: null, // Should be normalized to null
        }));
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
        expect(queryClientLib.queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["/api/workouts"] });
        expect(queryClientLib.queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["/api/timeline"] });
        expect(mockToast).toHaveBeenCalledWith({
          title: "Workout logged",
          description: "Your workout has been saved successfully.",
        });
        expect(mockNavigate).toHaveBeenCalledWith("/");
      });
    });

    it('triggers error toast on failed save', async () => {
      vi.mocked(queryClientLib.apiRequest).mockRejectedValueOnce(new Error('Network Error'));

      const { result } = renderFormHook({ ...defaultProps, useTextMode: true });

      act(() => {
        result.current.setTitle('Failed Workout');
        result.current.setFreeText('Did things');
      });

      act(() => {
        result.current.handleSave();
      });

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith({
          title: "Error",
          description: "Failed to save workout. Please try again.",
          variant: "destructive",
        });
        expect(queryClientLib.queryClient.invalidateQueries).not.toHaveBeenCalled();
        expect(mockNavigate).not.toHaveBeenCalled();
      });
    });
  });
});
