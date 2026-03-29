import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useWorkoutActions } from '../useWorkoutActions';
import * as queryClientLib from '@/lib/queryClient';
import * as toastHook from '@/hooks/use-toast';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { TimelineEntry } from '@shared/schema';
import React from 'react';

// Setup test QueryClient
const createTestQueryClient = () => new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
});
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={createTestQueryClient()}>{children}</QueryClientProvider>
);

vi.mock('@/lib/queryClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/queryClient')>();
  return {
    ...actual,
    apiRequest: vi.fn(),
    queryClient: {
      invalidateQueries: vi.fn().mockResolvedValue(undefined),
      cancelQueries: vi.fn().mockResolvedValue(undefined),
      getQueryData: vi.fn().mockReturnValue([]),
      setQueryData: vi.fn(),
    },
  };
});

vi.mock('@/hooks/use-toast', () => ({
  useToast: vi.fn(),
}));



describe('useWorkoutActions', () => {
  const mockToast = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(queryClientLib.queryClient.invalidateQueries).mockResolvedValue(undefined);
    vi.mocked(toastHook.useToast).mockReturnValue({ toast: mockToast } as unknown as ReturnType<typeof toastHook.useToast>);
    vi.mocked(queryClientLib.apiRequest).mockResolvedValue({
      json: () => Promise.resolve({ success: true }),
    } as Response);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('State management', () => {
    it('initializes with null states', () => {
      const { result } = renderHook(() => useWorkoutActions('test-plan-id'), { wrapper });

      expect(result.current.detailEntry).toBeNull();
      expect(result.current.skipConfirmEntry).toBeNull();
    });

    it('sets detailEntry on openDetailDialog', () => {
      const { result } = renderHook(() => useWorkoutActions('test-plan-id'), { wrapper });
      const mockEntry = { id: 1, date: '2024-01-01', focus: 'strength' };

      act(() => {
        result.current.openDetailDialog(mockEntry as unknown as TimelineEntry);
      });

      expect(result.current.detailEntry).toEqual(mockEntry);
    });

    it('sets skipConfirmEntry on handleSkip', () => {
      const { result } = renderHook(() => useWorkoutActions('test-plan-id'), { wrapper });
      const mockEntry = { id: 1, date: '2024-01-01', focus: 'cardio' };

      act(() => {
        result.current.handleSkip(mockEntry as unknown as TimelineEntry);
      });

      expect(result.current.skipConfirmEntry).toEqual(mockEntry);
    });
  });

  describe('Handler methods', () => {
    describe('handleSaveFromDetail', () => {
      it('updates existing workout if workoutLogId is present', async () => {
        const { result } = renderHook(() => useWorkoutActions('test-plan-id'), { wrapper });
        const mockEntry = { workoutLogId: 'w-1', date: '2024-01-01', focus: 'strength' };

        act(() => {
          result.current.openDetailDialog(mockEntry as unknown as TimelineEntry);
        });

        const updates = { focus: 'cardio', mainWorkout: 'run', accessory: null, notes: null };
        act(() => {
          result.current.handleSaveFromDetail(updates);
        });

        await waitFor(() => {
          expect(queryClientLib.apiRequest).toHaveBeenCalledWith('PATCH', '/api/v1/workouts/w-1', {
            ...updates,
            exercises: undefined,
          });
          expect(result.current.detailEntry).toBeNull();
        });
      });

      it('logs new workout if planDayId is present and exercises exist', async () => {
        const { result } = renderHook(() => useWorkoutActions('test-plan-id'), { wrapper });
        const mockEntry = { planDayId: 'pd-1', date: '2024-01-01', focus: 'strength' };

        act(() => {
          result.current.openDetailDialog(mockEntry as unknown as TimelineEntry);
        });

        const updates = { focus: 'cardio', mainWorkout: 'run', accessory: null, notes: null, exercises: [{ exerciseName: 'run', category: 'conditioning', sets: [] }] };
        act(() => {
          result.current.handleSaveFromDetail(updates);
        });

        await waitFor(() => {
          expect(queryClientLib.apiRequest).toHaveBeenCalledWith('POST', '/api/v1/workouts', {
            planDayId: 'pd-1',
            date: '2024-01-01',
            focus: 'cardio',
            mainWorkout: 'run',
            accessory: undefined,
            notes: undefined,
            exercises: [{ exerciseName: 'run', category: 'conditioning', sets: [] }]
          });
          expect(result.current.detailEntry).toBeNull();
        });
      });

      it('updates plan day if planDayId is present and no exercises exist', async () => {
        const { result } = renderHook(() => useWorkoutActions('test-plan-id'), { wrapper });
        const mockEntry = { planDayId: 'pd-1', date: '2024-01-01', focus: 'strength' };

        act(() => {
          result.current.openDetailDialog(mockEntry as unknown as TimelineEntry);
        });

        const updates = { focus: 'cardio', mainWorkout: 'run', accessory: null, notes: null };
        act(() => {
          result.current.handleSaveFromDetail(updates);
        });

        await waitFor(() => {
          expect(queryClientLib.apiRequest).toHaveBeenCalledWith('PATCH', '/api/v1/plans/test-plan-id/days/pd-1', updates);
          expect(result.current.detailEntry).toBeNull();
        });
      });
    });

    describe('handleMarkComplete', () => {
      it('logs a workout based on planDayId', async () => {
        const { result } = renderHook(() => useWorkoutActions('test-plan-id'), { wrapper });
        const mockEntry = { planDayId: 'pd-1', date: '2024-01-01', focus: 'strength', mainWorkout: 'lift', accessory: 'curls', notes: 'good' };

        act(() => {
          result.current.handleMarkComplete(mockEntry as unknown as TimelineEntry);
        });

        await waitFor(() => {
          expect(queryClientLib.apiRequest).toHaveBeenCalledWith('POST', '/api/v1/workouts', {
            planDayId: 'pd-1',
            date: '2024-01-01',
            focus: 'strength',
            mainWorkout: 'lift',
            accessory: 'curls',
            notes: 'good',
          });
        });
      });
    });

    describe('confirmSkip', () => {
      it('updates plan day status to skipped and resets skipConfirmEntry', async () => {
        const { result } = renderHook(() => useWorkoutActions('test-plan-id'), { wrapper });
        const mockEntry = { planDayId: 'pd-1', date: '2024-01-01', focus: 'cardio' };

        act(() => {
          result.current.handleSkip(mockEntry as unknown as TimelineEntry);
        });

        act(() => {
          result.current.confirmSkip();
        });

        await waitFor(() => {
          expect(queryClientLib.apiRequest).toHaveBeenCalledWith('PATCH', '/api/v1/plans/days/pd-1/status', { status: 'skipped' });
          expect(result.current.skipConfirmEntry).toBeNull();
        });
      });
    });

    describe('handleChangeStatus', () => {
      it('updates plan day status', async () => {
        const { result } = renderHook(() => useWorkoutActions('test-plan-id'), { wrapper });
        const mockEntry = { planDayId: 'pd-1', date: '2024-01-01', focus: 'cardio' };

        act(() => {
          result.current.handleChangeStatus(mockEntry as unknown as TimelineEntry, 'completed');
        });

        await waitFor(() => {
          expect(queryClientLib.apiRequest).toHaveBeenCalledWith('PATCH', '/api/v1/plans/days/pd-1/status', { status: 'completed' });
        });
      });
    });

    describe('handleDelete', () => {
      it('deletes workout if workoutLogId is present and planDayId is not', async () => {
        const { result } = renderHook(() => useWorkoutActions('test-plan-id'), { wrapper });
        const mockEntry = { workoutLogId: 'w-1', date: '2024-01-01', focus: 'strength' };

        act(() => {
          result.current.handleDelete(mockEntry as unknown as TimelineEntry);
        });

        await waitFor(() => {
          expect(queryClientLib.apiRequest).toHaveBeenCalledWith('DELETE', '/api/v1/workouts/w-1');
        });
      });

      it('deletes plan day if planDayId is present', async () => {
        const { result } = renderHook(() => useWorkoutActions('test-plan-id'), { wrapper });
        const mockEntry = { planDayId: 'pd-1', date: '2024-01-01', focus: 'strength' };

        act(() => {
          result.current.handleDelete(mockEntry as unknown as TimelineEntry);
        });

        await waitFor(() => {
          expect(queryClientLib.apiRequest).toHaveBeenCalledWith('DELETE', '/api/v1/plans/days/pd-1');
        });
      });

      it('deletes plan day if both workoutLogId and planDayId are present', async () => {
        const { result } = renderHook(() => useWorkoutActions('test-plan-id'), { wrapper });
        const mockEntry = { planDayId: 'pd-1', workoutLogId: 'w-1', date: '2024-01-01', focus: 'strength' };

        act(() => {
          result.current.handleDelete(mockEntry as unknown as TimelineEntry);
        });

        await waitFor(() => {
          expect(queryClientLib.apiRequest).toHaveBeenCalledWith('DELETE', '/api/v1/plans/days/pd-1');
        });
      });
    });
  });

  describe('API Callbacks and Toast notifications', () => {


    type MutationTestCase = [
      string,
      { planDayId?: string; workoutLogId?: string; date: string; focus: string },
      'handleSaveFromDetail' | 'handleMarkComplete' | 'handleDelete',
      any[],
      boolean,
      string
    ];

    const mutationTestCases: MutationTestCase[] = [
      ['updateDayMutation', { planDayId: 'pd-1', date: '2024-01-01', focus: 'strength' }, 'handleSaveFromDetail', [{ focus: 'cardio', mainWorkout: 'run', accessory: null, notes: null }], true, 'Failed to update entry'],
      ['logWorkoutMutation', { planDayId: 'pd-1', date: '2024-01-01', focus: 'strength' }, 'handleMarkComplete', [{}], false, 'Failed to log workout'],
      ['updateWorkoutMutation', { workoutLogId: 'w-1', date: '2024-01-01', focus: 'strength' }, 'handleSaveFromDetail', [{ focus: 'cardio', mainWorkout: 'run', accessory: null, notes: null }], true, 'Failed to update workout'],
      ['deleteWorkoutMutation', { workoutLogId: 'w-1', date: '2024-01-01', focus: 'strength' }, 'handleDelete', [{}], false, 'Failed to delete workout'],
      ['deletePlanDayMutation', { planDayId: 'pd-1', date: '2024-01-01', focus: 'strength' }, 'handleDelete', [{}], false, 'Failed to delete workout']
    ];

    it.each(mutationTestCases)('triggers error toast on failed %s', async (_, mockEntry, actionName, args, needsDialog, expectedTitle) => {
      vi.mocked(queryClientLib.apiRequest).mockRejectedValueOnce(new Error('API Failure'));
      const { result } = renderHook(() => useWorkoutActions('test-plan-id'), { wrapper });

      if (needsDialog) {
        act(() => {
          result.current.openDetailDialog(mockEntry as unknown as TimelineEntry);
        });
      }

      act(() => {
        if (actionName === 'handleDelete') {
          result.current.handleDelete(mockEntry as unknown as TimelineEntry);
        } else if (actionName === 'handleMarkComplete') {
          result.current.handleMarkComplete(mockEntry as unknown as TimelineEntry);
        } else if (actionName === 'handleSaveFromDetail') {
          result.current.handleSaveFromDetail(args[0]);
        }
      });

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith({ title: expectedTitle, description: "API Failure", variant: "destructive" });
      });
    });
    it('triggers success toast and invalidates timeline on successful status update', async () => {
      const { result } = renderHook(() => useWorkoutActions('test-plan-id'), { wrapper });
      const mockEntry = { planDayId: 'pd-1', date: '2024-01-01', focus: 'cardio' };

      act(() => {
        result.current.handleChangeStatus(mockEntry as unknown as TimelineEntry, 'completed');
      });

      await waitFor(() => {
        expect(queryClientLib.queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["/api/v1/timeline"] });
        expect(mockToast).toHaveBeenCalledWith({ title: "Status updated" });
      });
    });

    it('triggers error toast on failed status update', async () => {
      // Setup mutation mock to simulate failure
      vi.mocked(queryClientLib.apiRequest).mockRejectedValueOnce(new Error('Network Error'));

      const { result } = renderHook(() => useWorkoutActions('test-plan-id'), { wrapper });
      const mockEntry = { planDayId: 'pd-1', date: '2024-01-01', focus: 'cardio' };

      act(() => {
        result.current.handleChangeStatus(mockEntry as unknown as TimelineEntry, 'completed');
      });

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith({ title: "Failed to update status", description: "Network Error", variant: "destructive" });
      });
    });
});

});
