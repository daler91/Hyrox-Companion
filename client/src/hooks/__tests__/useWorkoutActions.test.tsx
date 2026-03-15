import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useWorkoutActions } from '../useWorkoutActions';
import * as queryClientLib from '@/lib/queryClient';
import * as toastHook from '@/hooks/use-toast';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// Setup test QueryClient
const testQueryClient = new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
});
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={testQueryClient}>{children}</QueryClientProvider>
);

vi.mock('@/lib/queryClient', () => ({
  apiRequest: vi.fn(),
  queryClient: {
    invalidateQueries: vi.fn(),
  },
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: vi.fn(),
}));



describe('useWorkoutActions', () => {
  const mockToast = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(toastHook.useToast).mockReturnValue({ toast: mockToast } as any);
    vi.mocked(queryClientLib.apiRequest).mockResolvedValue({
      json: () => Promise.resolve({ success: true }),
    } as Response);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    testQueryClient.clear();
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
        result.current.openDetailDialog(mockEntry as any);
      });

      expect(result.current.detailEntry).toEqual(mockEntry);
    });

    it('sets skipConfirmEntry on handleSkip', () => {
      const { result } = renderHook(() => useWorkoutActions('test-plan-id'), { wrapper });
      const mockEntry = { id: 1, date: '2024-01-01', focus: 'cardio' };

      act(() => {
        result.current.handleSkip(mockEntry as any);
      });

      expect(result.current.skipConfirmEntry).toEqual(mockEntry);
    });
  });

  describe('Handler methods', () => {

    describe('Early returns (no-op paths)', () => {
      it('does nothing on actions if required ids or states are missing', () => {
        const { result } = renderHook(() => useWorkoutActions('test-plan-id'), { wrapper });
        const entryWithoutIds = { date: '2024-01-01', focus: 'strength', mainWorkout: 'lift' } as any;

        act(() => {
          // Missing detailEntry
          result.current.handleSaveFromDetail({ focus: 'cardio', mainWorkout: 'run', accessory: null, notes: null });
          // Missing planDayId
          result.current.handleMarkComplete(entryWithoutIds);
          // Missing skipConfirmEntry / planDayId
          result.current.confirmSkip();
          // Missing planDayId
          result.current.handleChangeStatus(entryWithoutIds, 'completed');
          // Missing both planDayId and workoutLogId
          result.current.handleDelete(entryWithoutIds);
        });

        expect(queryClientLib.apiRequest).not.toHaveBeenCalled();

        act(() => {
          result.current.openDetailDialog(entryWithoutIds);
        });

        act(() => {
          // detailEntry has no workoutLogId and no planDayId
          result.current.handleSaveFromDetail({ focus: 'cardio', mainWorkout: 'run', accessory: null, notes: null, exercises: [{ name: 'run' }] });
        });

        expect(queryClientLib.apiRequest).not.toHaveBeenCalled();
      });
    });

    describe('handleSaveFromDetail', () => {
      const runSaveTest = async (mockEntry: any, updates: any, method: string, url: string, payload: any) => {
        const { result } = renderHook(() => useWorkoutActions('test-plan-id'), { wrapper });
        act(() => { result.current.openDetailDialog(mockEntry as any); });
        act(() => { result.current.handleSaveFromDetail(updates); });
        await waitFor(() => {
          expect(queryClientLib.apiRequest).toHaveBeenCalledWith(method, url, payload);
        });
      };

      it('updates existing workout (with or without exercises)', async () => {
        const mockEntry = { workoutLogId: 'w-1', date: '2024-01-01', focus: 'strength' };
        await runSaveTest(mockEntry, { focus: 'cardio', mainWorkout: 'run', accessory: null, notes: null }, 'PATCH', '/api/workouts/w-1', { focus: 'cardio', mainWorkout: 'run', accessory: null, notes: null, exercises: undefined });
        await runSaveTest(mockEntry, { focus: 'cardio', mainWorkout: 'run', accessory: null, notes: null, exercises: [{ name: 'pushups' }] }, 'PATCH', '/api/workouts/w-1', { focus: 'cardio', mainWorkout: 'run', accessory: null, notes: null, exercises: [{ name: 'pushups' }] });
      });

      it('updates plan day if updates have no exercises or empty array', async () => {
        const mockEntry = { planDayId: 'pd-1', date: '2024-01-01', focus: 'strength' };
        await runSaveTest(mockEntry, { focus: 'cardio', mainWorkout: 'run', accessory: null, notes: null }, 'PATCH', '/api/plans/test-plan-id/days/pd-1', { focus: 'cardio', mainWorkout: 'run', accessory: null, notes: null });
        await runSaveTest(mockEntry, { focus: 'cardio', mainWorkout: 'run', accessory: null, notes: null, exercises: [] }, 'PATCH', '/api/plans/test-plan-id/days/pd-1', { focus: 'cardio', mainWorkout: 'run', accessory: null, notes: null, exercises: [] });
      });

      it('logs new workout if planDayId is present and exercises exist', async () => {
        await runSaveTest(
          { planDayId: 'pd-1', date: '2024-01-01', focus: 'strength' },
          { focus: 'cardio', mainWorkout: 'run', accessory: null, notes: null, exercises: [{ name: 'run' }] },
          'POST', '/api/workouts',
          { planDayId: 'pd-1', date: '2024-01-01', focus: 'cardio', mainWorkout: 'run', accessory: undefined, notes: undefined, exercises: [{ name: 'run' }] }
        );
      });
    });

    describe('handleMarkComplete', () => {


      it('logs a workout based on planDayId', async () => {
        const { result } = renderHook(() => useWorkoutActions('test-plan-id'), { wrapper });
        const mockEntry = { planDayId: 'pd-1', date: '2024-01-01', focus: 'strength', mainWorkout: 'lift', accessory: 'curls', notes: 'good' };

        act(() => {
          result.current.handleMarkComplete(mockEntry as any);
        });

        await waitFor(() => {
          expect(queryClientLib.apiRequest).toHaveBeenCalledWith('POST', '/api/workouts', {
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
          result.current.handleSkip(mockEntry as any);
        });

        act(() => {
          result.current.confirmSkip();
        });

        await waitFor(() => {
          expect(queryClientLib.apiRequest).toHaveBeenCalledWith('PATCH', '/api/plans/days/pd-1/status', { status: 'skipped' });
          expect(result.current.skipConfirmEntry).toBeNull();
        });
      });
    });

    describe('handleChangeStatus', () => {


      it('updates plan day status', async () => {
        const { result } = renderHook(() => useWorkoutActions('test-plan-id'), { wrapper });
        const mockEntry = { planDayId: 'pd-1', date: '2024-01-01', focus: 'cardio' };

        act(() => {
          result.current.handleChangeStatus(mockEntry as any, 'completed');
        });

        await waitFor(() => {
          expect(queryClientLib.apiRequest).toHaveBeenCalledWith('PATCH', '/api/plans/days/pd-1/status', { status: 'completed' });
        });
      });
    });

    describe('handleDelete', () => {
      const runDeleteTest = async (mockEntry: any, expectedUrl: string) => {
        const { result } = renderHook(() => useWorkoutActions('test-plan-id'), { wrapper });
        act(() => { result.current.handleDelete(mockEntry as any); });
        await waitFor(() => {
          expect(queryClientLib.apiRequest).toHaveBeenCalledWith('DELETE', expectedUrl);
        });
      };

      it('deletes workout or plan day appropriately', async () => {
        await runDeleteTest({ workoutLogId: 'w-1', date: '2024-01-01', focus: 'strength' }, '/api/workouts/w-1');
        await runDeleteTest({ planDayId: 'pd-1', date: '2024-01-01', focus: 'strength' }, '/api/plans/days/pd-1');
        await runDeleteTest({ planDayId: 'pd-1', workoutLogId: 'w-1', date: '2024-01-01', focus: 'strength' }, '/api/plans/days/pd-1');
      });
    });
    describe('API Callbacks and Toast notifications', () => {
    it('triggers success toast and invalidates timeline on successful status update', async () => {
      const { result } = renderHook(() => useWorkoutActions('test-plan-id'), { wrapper });
      const mockEntry = { planDayId: 'pd-1', date: '2024-01-01', focus: 'cardio' };

      act(() => {
        result.current.handleChangeStatus(mockEntry as any, 'completed');
      });

      await waitFor(() => {
        expect(queryClientLib.queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["/api/timeline"] });
        expect(mockToast).toHaveBeenCalledWith({ title: "Status updated" });
      });
    });

    it('triggers error toast on failed workout deletion', async () => {
      vi.mocked(queryClientLib.apiRequest).mockRejectedValueOnce(new Error('Network Error'));

      const { result } = renderHook(() => useWorkoutActions('test-plan-id'), { wrapper });
      const mockEntry = { workoutLogId: 'w-1', date: '2024-01-01', focus: 'strength' };

      act(() => {
        result.current.handleDelete(mockEntry as any);
      });

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith({ title: "Failed to delete workout", variant: "destructive" });
      });
    });

    it('triggers error toast on failed plan day deletion', async () => {
      vi.mocked(queryClientLib.apiRequest).mockRejectedValueOnce(new Error('Network Error'));

      const { result } = renderHook(() => useWorkoutActions('test-plan-id'), { wrapper });
      const mockEntry = { planDayId: 'pd-1', date: '2024-01-01', focus: 'strength' };

      act(() => {
        result.current.handleDelete(mockEntry as any);
      });

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith({ title: "Failed to delete workout", variant: "destructive" });
      });
    });

    it('triggers error toast on failed update day mutation', async () => {
      vi.mocked(queryClientLib.apiRequest).mockRejectedValueOnce(new Error('Network Error'));

      const { result } = renderHook(() => useWorkoutActions('test-plan-id'), { wrapper });
      const mockEntry = { planDayId: 'pd-1', date: '2024-01-01', focus: 'strength' };

      act(() => {
        result.current.openDetailDialog(mockEntry as any);
      });

      act(() => {
        result.current.handleSaveFromDetail({ focus: 'cardio', mainWorkout: 'run', accessory: null, notes: null });
      });

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith({ title: "Failed to update entry", variant: "destructive" });
      });
    });

    it('triggers error toast on failed log workout mutation', async () => {
      vi.mocked(queryClientLib.apiRequest).mockRejectedValueOnce(new Error('Network Error'));

      const { result } = renderHook(() => useWorkoutActions('test-plan-id'), { wrapper });
      const mockEntry = { planDayId: 'pd-1', date: '2024-01-01', focus: 'strength' };

      act(() => {
        result.current.handleMarkComplete(mockEntry as any);
      });

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith({ title: "Failed to log workout", variant: "destructive" });
      });
    });

    it('triggers error toast on failed update workout mutation', async () => {
      vi.mocked(queryClientLib.apiRequest).mockRejectedValueOnce(new Error('Network Error'));

      const { result } = renderHook(() => useWorkoutActions('test-plan-id'), { wrapper });
      const mockEntry = { workoutLogId: 'w-1', date: '2024-01-01', focus: 'strength' };

      act(() => {
        result.current.openDetailDialog(mockEntry as any);
      });

      act(() => {
        result.current.handleSaveFromDetail({ focus: 'cardio', mainWorkout: 'run', accessory: null, notes: null });
      });

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith({ title: "Failed to update workout", variant: "destructive" });
      });
    });

    it('triggers error toast on failed status update', async () => {
      // Setup mutation mock to simulate failure
      vi.mocked(queryClientLib.apiRequest).mockRejectedValueOnce(new Error('Network Error'));

      const { result } = renderHook(() => useWorkoutActions('test-plan-id'), { wrapper });
      const mockEntry = { planDayId: 'pd-1', date: '2024-01-01', focus: 'cardio' };

      act(() => {
        result.current.handleChangeStatus(mockEntry as any, 'completed');
      });

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith({ title: "Failed to update status", variant: "destructive" });
      });
    });
  });

});

});
