import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { usePlanImport } from '../usePlanImport';
import * as queryClientLib from '@/lib/queryClient';
import * as toastHook from '@/hooks/use-toast';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { format, startOfWeek } from 'date-fns';

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

describe('usePlanImport', () => {
  const mockToast = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(toastHook.useToast).mockReturnValue({ toast: mockToast } as any);
    vi.mocked(queryClientLib.apiRequest).mockResolvedValue({
      json: () => Promise.resolve({ success: true, id: 'test-plan-id' }),
    } as Response);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    testQueryClient.clear();
  });

  describe('Initial state', () => {
    it('initializes with default values', () => {
      const { result } = renderHook(() => usePlanImport(), { wrapper });
      expect(result.current.csvPreview).toBeNull();
      expect(result.current.schedulingPlanId).toBeNull();
      expect(result.current.startDate).toBe(format(startOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-MM-dd"));
      expect(result.current.fileInputRef.current).toBeNull();
    });
  });

  describe('handleFileUpload', () => {
    const fileUploadCases = [
      {
        isValid: false,
        name: 'rejects non-CSV files',
        expectedToast: { title: "Please upload a CSV file", variant: "destructive" },
        expectPreviewNull: true
      },
      {
        isValid: true,
        name: 'processes valid CSV files',
        expectedToast: null,
        expectPreviewNull: false
      }
    ];

    it.each(fileUploadCases)('$name', async ({ isValid, expectedToast, expectPreviewNull }) => {
      const { result } = renderHook(() => usePlanImport(), { wrapper });
      const csvContent = "Week,Day,Focus,Workout\n1,Monday,Strength,Squats\n";
      const file = new File([isValid ? csvContent : 'test content'], isValid ? 'plan.csv' : 'test.txt', { type: isValid ? 'text/csv' : 'text/plain' });
      const mockEvent = { target: { files: [file], value: isValid ? 'plan.csv' : 'test.txt' } } as unknown as React.ChangeEvent<HTMLInputElement>;

      const mockFileReader = {
        readAsText: vi.fn(function(this: { onload: (event: unknown) => void }) {
          if (this.onload) this.onload({ target: { result: csvContent } });
        }),
        onload: null
      };

      vi.stubGlobal('FileReader', vi.fn(() => mockFileReader));
      act(() => { result.current.handleFileUpload(mockEvent); });
      vi.unstubAllGlobals();

      if (expectedToast) {
        expect(mockToast).toHaveBeenCalledWith(expectedToast);
      } else {
        expect(mockFileReader.readAsText).toHaveBeenCalledWith(file);
      }

      if (expectPreviewNull) {
        expect(result.current.csvPreview).toBeNull();
      } else {
        expect(result.current.csvPreview).toEqual({
          fileName: 'plan.csv',
          content: csvContent,
          rows: [{ weekNumber: 1, dayName: 'Monday', focus: 'Strength', mainWorkout: 'Squats' }]
        });
      }
    });
  });

  describe('Mutations', () => {
    const mutationCases = [
      {
        name: 'confirmImport',
        setup: (res: any) => res.current.setCsvPreview({ fileName: 'plan.csv', content: 'csv data', rows: [] }),
        trigger: (res: any) => res.current.confirmImport(),
        method: 'POST', endpoint: '/api/plans/import', payload: { csvContent: 'csv data', fileName: 'plan.csv' },
        successToast: "Plan imported! Now set a start date.",
        errorToast: "Failed to import plan",
        invalidates: [["/api/plans"]],
        postSuccessAssert: (res: any) => {
          expect(res.current.schedulingPlanId).toBe('test-plan-id');
          expect(res.current.csvPreview).toBeNull();
        }
      },
      {
        name: 'schedulePlanMutation',
        setup: (res: any) => res.current.setSchedulingPlanId('test-plan-id'),
        trigger: (res: any) => res.current.schedulePlanMutation.mutate({ planId: 'test-plan-id', startDate: '2023-10-01' }),
        method: 'POST', endpoint: '/api/plans/test-plan-id/schedule', payload: { startDate: '2023-10-01' },
        successToast: "Training plan scheduled!",
        errorToast: "Failed to schedule plan",
        invalidates: [["/api/timeline", 'test-plan-id'], ["/api/plans"]],
        postSuccessAssert: (res: any, mockOnPlanScheduled: any) => {
          expect(mockOnPlanScheduled).toHaveBeenCalledWith('test-plan-id');
          expect(res.current.schedulingPlanId).toBeNull();
        }
      },
      {
        name: 'samplePlanMutation',
        setup: () => {},
        trigger: (res: any) => res.current.samplePlanMutation.mutate(),
        method: 'POST', endpoint: '/api/plans/sample', payload: {},
        successToast: "Sample plan created! Now set a start date.",
        errorToast: "Failed to create sample plan",
        invalidates: [["/api/plans"]],
        postSuccessAssert: () => {}
      },
      {
        name: 'renamePlanMutation',
        setup: () => {},
        trigger: (res: any) => res.current.renamePlanMutation.mutate({ planId: 'p1', name: 'New Name' }),
        method: 'PATCH', endpoint: '/api/plans/p1', payload: { name: 'New Name' },
        successToast: "Plan renamed",
        errorToast: "Failed to rename plan",
        invalidates: [["/api/plans"], ["/api/timeline"]],
        postSuccessAssert: () => {}
      }
    ];

    it.each(mutationCases)('$name executes correctly on success', async ({ setup, trigger, method, endpoint, payload, successToast, invalidates, postSuccessAssert }) => {
      const mockOnPlanScheduled = vi.fn();
      const { result } = renderHook(() => usePlanImport({ onPlanScheduled: mockOnPlanScheduled }), { wrapper });
      act(() => { setup(result); });
      act(() => { trigger(result); });

      await waitFor(() => {
        expect(queryClientLib.apiRequest).toHaveBeenCalledWith(method, endpoint, payload);
        invalidates.forEach(key => {
          expect(queryClientLib.queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: key });
        });
        expect(mockToast).toHaveBeenCalledWith({ title: successToast });
      });
      postSuccessAssert(result, mockOnPlanScheduled);
    });

    it.each(mutationCases)('$name handles error', async ({ setup, trigger, errorToast }) => {
      vi.mocked(queryClientLib.apiRequest).mockRejectedValueOnce(new Error('API Failure'));
      const { result } = renderHook(() => usePlanImport(), { wrapper });
      act(() => { setup(result); });
      act(() => { trigger(result); });

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith({ title: errorToast, variant: "destructive" });
      });
    });
  });
});
