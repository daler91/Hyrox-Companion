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

// Mock useMutation to make testing sync without waiting on internal queryClient hooks, but triggering our onSuccess explicitly.
vi.mock('@tanstack/react-query', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@tanstack/react-query')>();
  return {
    ...mod,
    useMutation: vi.fn(({ mutationFn, onSuccess, onError }: any) => ({
      mutate: async (...args: any[]) => {
        try {
          if (mutationFn) {
            await mutationFn(...args);
          }
          if (onSuccess) onSuccess();
        } catch(e) {
          if (onError) onError();
        }
      },
      isPending: false,
    })),
  };
});

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
    describe('handleSaveFromDetail', () => {
      it('updates existing workout if workoutLogId is present', async () => {
        const { result } = renderHook(() => useWorkoutActions('test-plan-id'), { wrapper });
        const mockEntry = { workoutLogId: 'w-1', date: '2024-01-01', focus: 'strength' };

        act(() => {
          result.current.openDetailDialog(mockEntry as any);
        });

        const updates = { focus: 'cardio', mainWorkout: 'run', accessory: null, notes: null };
        await act(async () => {
          await result.current.handleSaveFromDetail(updates);
        });

        expect(queryClientLib.apiRequest).toHaveBeenCalledWith('PATCH', '/api/workouts/w-1', {
          ...updates,
          exercises: undefined,
        });
        expect(result.current.detailEntry).toBeNull();
      });

      it('logs new workout if planDayId is present and exercises exist', async () => {
        const { result } = renderHook(() => useWorkoutActions('test-plan-id'), { wrapper });
        const mockEntry = { planDayId: 'pd-1', date: '2024-01-01', focus: 'strength' };

        act(() => {
          result.current.openDetailDialog(mockEntry as any);
        });

        const updates = { focus: 'cardio', mainWorkout: 'run', accessory: null, notes: null, exercises: [{ name: 'run' }] };
        await act(async () => {
          await result.current.handleSaveFromDetail(updates);
        });

        expect(queryClientLib.apiRequest).toHaveBeenCalledWith('POST', '/api/workouts', {
          planDayId: 'pd-1',
          date: '2024-01-01',
          focus: 'cardio',
          mainWorkout: 'run',
          accessory: undefined,
          notes: undefined,
          exercises: [{ name: 'run' }]
        });
        expect(result.current.detailEntry).toBeNull();
      });

      it('updates plan day if planDayId is present and no exercises exist', async () => {
        const { result } = renderHook(() => useWorkoutActions('test-plan-id'), { wrapper });
        const mockEntry = { planDayId: 'pd-1', date: '2024-01-01', focus: 'strength' };

        act(() => {
          result.current.openDetailDialog(mockEntry as any);
        });

        const updates = { focus: 'cardio', mainWorkout: 'run', accessory: null, notes: null };
        await act(async () => {
          await result.current.handleSaveFromDetail(updates);
        });

        expect(queryClientLib.apiRequest).toHaveBeenCalledWith('PATCH', '/api/plans/test-plan-id/days/pd-1', updates);
        expect(result.current.detailEntry).toBeNull();
      });
    });

    describe('handleMarkComplete', () => {
      it('logs a workout based on planDayId', async () => {
        const { result } = renderHook(() => useWorkoutActions('test-plan-id'), { wrapper });
        const mockEntry = { planDayId: 'pd-1', date: '2024-01-01', focus: 'strength', mainWorkout: 'lift', accessory: 'curls', notes: 'good' };

        await act(async () => {
          await result.current.handleMarkComplete(mockEntry as any);
        });

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

    describe('confirmSkip', () => {
      it('updates plan day status to skipped and resets skipConfirmEntry', async () => {
        const { result } = renderHook(() => useWorkoutActions('test-plan-id'), { wrapper });
        const mockEntry = { planDayId: 'pd-1', date: '2024-01-01', focus: 'cardio' };

        act(() => {
          result.current.handleSkip(mockEntry as any);
        });

        await act(async () => {
          await result.current.confirmSkip();
        });

        expect(queryClientLib.apiRequest).toHaveBeenCalledWith('PATCH', '/api/plans/days/pd-1/status', { status: 'skipped' });
        expect(result.current.skipConfirmEntry).toBeNull();
      });
    });

    describe('handleChangeStatus', () => {
      it('updates plan day status', async () => {
        const { result } = renderHook(() => useWorkoutActions('test-plan-id'), { wrapper });
        const mockEntry = { planDayId: 'pd-1', date: '2024-01-01', focus: 'cardio' };

        await act(async () => {
          await result.current.handleChangeStatus(mockEntry as any, 'completed');
        });

        expect(queryClientLib.apiRequest).toHaveBeenCalledWith('PATCH', '/api/plans/days/pd-1/status', { status: 'completed' });
      });
    });

    describe('handleDelete', () => {
      it('deletes workout if workoutLogId is present and planDayId is not', async () => {
        const { result } = renderHook(() => useWorkoutActions('test-plan-id'), { wrapper });
        const mockEntry = { workoutLogId: 'w-1', date: '2024-01-01', focus: 'strength' };

        await act(async () => {
          await result.current.handleDelete(mockEntry as any);
        });

        expect(queryClientLib.apiRequest).toHaveBeenCalledWith('DELETE', '/api/workouts/w-1');
      });

      it('deletes plan day if planDayId is present', async () => {
        const { result } = renderHook(() => useWorkoutActions('test-plan-id'), { wrapper });
        const mockEntry = { planDayId: 'pd-1', date: '2024-01-01', focus: 'strength' };

        await act(async () => {
          await result.current.handleDelete(mockEntry as any);
        });

        expect(queryClientLib.apiRequest).toHaveBeenCalledWith('DELETE', '/api/plans/days/pd-1');
      });

      it('deletes plan day if both workoutLogId and planDayId are present', async () => {
        const { result } = renderHook(() => useWorkoutActions('test-plan-id'), { wrapper });
        const mockEntry = { planDayId: 'pd-1', workoutLogId: 'w-1', date: '2024-01-01', focus: 'strength' };

        await act(async () => {
          await result.current.handleDelete(mockEntry as any);
        });

        expect(queryClientLib.apiRequest).toHaveBeenCalledWith('DELETE', '/api/plans/days/pd-1');
      });
    });
  });

  describe('API Callbacks and Toast notifications', () => {
    it('triggers success toast and invalidates timeline on successful status update', async () => {
      const { result } = renderHook(() => useWorkoutActions('test-plan-id'), { wrapper });
      const mockEntry = { planDayId: 'pd-1', date: '2024-01-01', focus: 'cardio' };

      await act(async () => {
        await result.current.handleChangeStatus(mockEntry as any, 'completed');
      });

      expect(queryClientLib.queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["/api/timeline"] });
      expect(mockToast).toHaveBeenCalledWith({ title: "Status updated" });
    });

    it('triggers error toast on failed status update', async () => {
      // Setup mutation mock to simulate failure
      vi.mocked(queryClientLib.apiRequest).mockRejectedValueOnce(new Error('Network Error'));

      const { result } = renderHook(() => useWorkoutActions('test-plan-id'), { wrapper });
      const mockEntry = { planDayId: 'pd-1', date: '2024-01-01', focus: 'cardio' };

      await act(async () => {
        await result.current.handleChangeStatus(mockEntry as any, 'completed');
      });

      expect(mockToast).toHaveBeenCalledWith({ title: "Failed to update status", variant: "destructive" });
    });
  });
});
