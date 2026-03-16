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
    it('rejects non-CSV files', () => {
      const { result } = renderHook(() => usePlanImport(), { wrapper });

      const mockEvent = {
        target: {
          files: [new File(['test content'], 'test.txt', { type: 'text/plain' })],
          value: 'test.txt'
        }
      } as unknown as React.ChangeEvent<HTMLInputElement>;

      act(() => {
        result.current.handleFileUpload(mockEvent);
      });

      expect(mockToast).toHaveBeenCalledWith({
        title: "Please upload a CSV file",
        variant: "destructive",
      });
      expect(result.current.csvPreview).toBeNull();
    });

    it('processes valid CSV files', async () => {
      const { result } = renderHook(() => usePlanImport(), { wrapper });

      const csvContent = "Week,Day,Focus,Workout\n1,Monday,Strength,Squats\n";
      const file = new File([csvContent], 'plan.csv', { type: 'text/csv' });

      const mockEvent = {
        target: {
          files: [file],
          value: 'plan.csv'
        }
      } as unknown as React.ChangeEvent<HTMLInputElement>;

      // Mock FileReader
      const mockFileReader = {
        readAsText: vi.fn(function(this: { onload: (event: unknown) => void }) {
          if (this.onload) {
            this.onload({ target: { result: csvContent } });
          }
        }),
        onload: null
      };

      vi.stubGlobal('FileReader', vi.fn(() => mockFileReader));

      act(() => {
        result.current.handleFileUpload(mockEvent);
      });

      expect(mockFileReader.readAsText).toHaveBeenCalledWith(file);

      expect(result.current.csvPreview).toEqual({
        fileName: 'plan.csv',
        content: csvContent,
        rows: [{
          weekNumber: 1,
          dayName: 'Monday',
          focus: 'Strength',
          mainWorkout: 'Squats'
        }]
      });

      vi.unstubAllGlobals();
    });
  });

  describe('Mutations', () => {
    // Shared helper for testing common mutation error states to reduce code duplication
    const testErrorState = async (trigger: (res: any) => void, expectedErrorTitle: string) => {
      vi.mocked(queryClientLib.apiRequest).mockRejectedValueOnce(new Error('API Failure'));
      const { result } = renderHook(() => usePlanImport(), { wrapper });
      act(() => trigger(result));
      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith({ title: expectedErrorTitle, variant: "destructive" });
      });
    };

    it('confirmImport handles import mutation and cleans up preview', async () => {
      const { result } = renderHook(() => usePlanImport(), { wrapper });
      act(() => {
        result.current.setCsvPreview({ fileName: 'plan.csv', content: 'csv data', rows: [] });
      });
      act(() => { result.current.confirmImport(); });

      await waitFor(() => {
        expect(queryClientLib.apiRequest).toHaveBeenCalledWith('POST', '/api/plans/import', { csvContent: 'csv data', fileName: 'plan.csv' });
        expect(queryClientLib.queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["/api/plans"] });
        expect(result.current.schedulingPlanId).toBe('test-plan-id');
        expect(mockToast).toHaveBeenCalledWith({ title: "Plan imported! Now set a start date." });
        expect(result.current.csvPreview).toBeNull();
      });
    });


    it('handles import error', async () => {
      vi.mocked(queryClientLib.apiRequest).mockRejectedValueOnce(new Error('Import failed'));
      const { result } = renderHook(() => usePlanImport(), { wrapper });
      act(() => {
        result.current.setCsvPreview({ fileName: 'plan.csv', content: 'csv data', rows: [] });
      });
      act(() => {
        result.current.confirmImport();
      });
      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith({ title: "Failed to import plan", variant: "destructive" });
      });
    });


    it('samplePlanMutation creates a sample plan', async () => {
      const { result } = renderHook(() => usePlanImport(), { wrapper });
      act(() => { result.current.samplePlanMutation.mutate(); });

      await waitFor(() => {
        expect(queryClientLib.apiRequest).toHaveBeenCalledWith('POST', '/api/plans/sample', {});
        expect(queryClientLib.queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["/api/plans"] });
        expect(result.current.schedulingPlanId).toBe('test-plan-id');
        expect(mockToast).toHaveBeenCalledWith({ title: "Sample plan created! Now set a start date." });
      });
    });

    it('handles sample plan creation error', async () => {
      await testErrorState((res) => res.current.samplePlanMutation.mutate(), "Failed to create sample plan");
    });

    it('renamePlanMutation renames a plan', async () => {
      const { result } = renderHook(() => usePlanImport(), { wrapper });
      act(() => { result.current.renamePlanMutation.mutate({ planId: 'p1', name: 'New Name' }); });

      await waitFor(() => {
        expect(queryClientLib.apiRequest).toHaveBeenCalledWith('PATCH', '/api/plans/p1', { name: 'New Name' });
        expect(queryClientLib.queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["/api/plans"] });
        expect(queryClientLib.queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["/api/timeline"] });
        expect(mockToast).toHaveBeenCalledWith({ title: "Plan renamed" });
      });
    });

    it('handles plan rename error', async () => {
      await testErrorState((res) => res.current.renamePlanMutation.mutate({ planId: 'p1', name: 'New Name' }), "Failed to rename plan");
    });

    it('schedulePlanMutation schedules a plan', async () => {
      const mockOnPlanScheduled = vi.fn();
      const { result } = renderHook(() => usePlanImport({ onPlanScheduled: mockOnPlanScheduled }), { wrapper });
      act(() => { result.current.setSchedulingPlanId('test-plan-id'); });
      act(() => { result.current.schedulePlanMutation.mutate({ planId: 'test-plan-id', startDate: '2023-10-01' }); });

      await waitFor(() => {
        expect(queryClientLib.apiRequest).toHaveBeenCalledWith('POST', '/api/plans/test-plan-id/schedule', { startDate: '2023-10-01' });
        expect(queryClientLib.queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["/api/timeline", 'test-plan-id'] });
        expect(queryClientLib.queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["/api/plans"] });
        expect(mockOnPlanScheduled).toHaveBeenCalledWith('test-plan-id');
        expect(result.current.schedulingPlanId).toBeNull();
        expect(mockToast).toHaveBeenCalledWith({ title: "Training plan scheduled!" });
      });
    });

    it('handles plan schedule error', async () => {
      await testErrorState((res) => res.current.schedulePlanMutation.mutate({ planId: 'p1', startDate: '2023-10-01' }), "Failed to schedule plan");
    });
  });
});
