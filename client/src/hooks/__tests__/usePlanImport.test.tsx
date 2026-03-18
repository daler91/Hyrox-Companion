import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { usePlanImport } from '../usePlanImport';
import * as queryClientLib from '@/lib/queryClient';
import * as toastHook from '@/hooks/use-toast';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { format, startOfWeek } from 'date-fns';

const createWrapper = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return { qc, wrapper: ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider> };
};

vi.mock('@/lib/queryClient', () => ({
  apiRequest: vi.fn(), queryClient: { invalidateQueries: vi.fn() }
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: vi.fn() }));

describe('usePlanImport', () => {
  const mockToast = vi.fn();
  let qc: QueryClient, wrapper: React.FC<{ children: React.ReactNode }>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(toastHook.useToast).mockReturnValue({ toast: mockToast } as any);
    vi.mocked(queryClientLib.apiRequest).mockResolvedValue({ json: () => Promise.resolve({ success: true, id: 'test-plan-id' }) } as Response);
    const w = createWrapper();
    qc = w.qc;
    wrapper = w.wrapper;
  });

  afterEach(() => { vi.restoreAllMocks(); qc.clear(); });

  const runHook = (props?: any) => renderHook(() => usePlanImport(props), { wrapper });

  describe('Initial state', () => {
    it('initializes with default values', () => {
      const { result } = runHook();
      expect(result.current.csvPreview).toBeNull();
      expect(result.current.schedulingPlanId).toBeNull();
      expect(result.current.startDate).toBe(format(startOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-MM-dd"));
      expect(result.current.fileInputRef.current).toBeNull();
    });
  });

  describe('handleFileUpload', () => {
    it.each([
      [false, 'rejects non-CSV files', { title: "Please upload a CSV file", variant: "destructive" }, true],
      [true, 'processes valid CSV files', null, false]
    ])('%s', async (isValid, _, expectedToast, expectPreviewNull) => {
      const { result } = runHook();
      const content = "Week,Day,Focus,Workout\n1,Monday,Strength,Squats\n";
      const file = new File([isValid ? content : 'err'], isValid ? 'plan.csv' : 'x.txt', { type: isValid ? 'text/csv' : 'text/plain' });
      const ev = { target: { files: [file], value: file.name } } as unknown as React.ChangeEvent<HTMLInputElement>;

      const mockReader = {
        readAsText: vi.fn(function(this: { onload: (e: any) => void }) {
          if (this.onload) this.onload({ target: { result: content } });
        }),
        onload: null
      };

      vi.stubGlobal('FileReader', vi.fn(() => mockReader));
      act(() => { result.current.handleFileUpload(ev); });
      vi.unstubAllGlobals();

      if (expectedToast) expect(mockToast).toHaveBeenCalledWith(expectedToast);
      else expect(mockReader.readAsText).toHaveBeenCalledWith(file);

      if (expectPreviewNull) expect(result.current.csvPreview).toBeNull();
      else expect(result.current.csvPreview).toEqual({ fileName: 'plan.csv', content, rows: [{ weekNumber: 1, dayName: 'Monday', focus: 'Strength', mainWorkout: 'Squats' }] });
    });
  });

  describe('Mutations', () => {
    const cases = [
      {
        name: 'confirmImport',
        setup: (res: any) => res.current.setCsvPreview({ fileName: 'plan.csv', content: 'c', rows: [] }),
        trigger: (res: any) => res.current.confirmImport(),
        method: 'POST', endpoint: '/api/v1/plans/import', payload: { csvContent: 'c', fileName: 'plan.csv' },
        sToast: "Plan imported! Now set a start date.", eToast: "Failed to import plan", inv: [["/api/v1/plans"]],
        postAssert: (res: any) => { expect(res.current.schedulingPlanId).toBe('test-plan-id'); expect(res.current.csvPreview).toBeNull(); }
      },
      {
        name: 'schedulePlanMutation',
        setup: (res: any) => res.current.setSchedulingPlanId('test-plan-id'),
        trigger: (res: any) => res.current.schedulePlanMutation.mutate({ planId: 'test-plan-id', startDate: '2023-10-01' }),
        method: 'POST', endpoint: '/api/v1/plans/test-plan-id/schedule', payload: { startDate: '2023-10-01' },
        sToast: "Training plan scheduled!", eToast: "Failed to schedule plan", inv: [["/api/v1/timeline", 'test-plan-id'], ["/api/v1/plans"]],
        postAssert: (res: any, mockFn: any) => { expect(mockFn).toHaveBeenCalledWith('test-plan-id'); expect(res.current.schedulingPlanId).toBeNull(); }
      },
      {
        name: 'samplePlanMutation', setup: () => {}, trigger: (res: any) => res.current.samplePlanMutation.mutate(),
        method: 'POST', endpoint: '/api/v1/plans/sample', payload: {},
        sToast: "Sample plan created! Now set a start date.", eToast: "Failed to create sample plan", inv: [["/api/v1/plans"]], postAssert: () => {}
      },
      {
        name: 'renamePlanMutation', setup: () => {}, trigger: (res: any) => res.current.renamePlanMutation.mutate({ planId: 'p1', name: 'New Name' }),
        method: 'PATCH', endpoint: '/api/v1/plans/p1', payload: { name: 'New Name' },
        sToast: "Plan renamed", eToast: "Failed to rename plan", inv: [["/api/v1/plans"], ["/api/v1/timeline"]], postAssert: () => {}
      }
    ];

    it.each(cases)('$name success', async ({ setup, trigger, method, endpoint, payload, sToast, inv, postAssert }) => {
      const mockCb = vi.fn();
      const { result } = runHook({ onPlanScheduled: mockCb });
      act(() => { setup(result); }); act(() => { trigger(result); });

      await waitFor(() => {
        expect(queryClientLib.apiRequest).toHaveBeenCalledWith(method, endpoint, payload);
        inv.forEach(k => expect(queryClientLib.queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: k }));
        expect(mockToast).toHaveBeenCalledWith({ title: sToast });
      });
      postAssert(result, mockCb);
    });

    it.each(cases)('$name error', async ({ setup, trigger, eToast }) => {
      vi.mocked(queryClientLib.apiRequest).mockRejectedValueOnce(new Error('API Failure'));
      const { result } = runHook();
      act(() => { setup(result); }); act(() => { trigger(result); });
      await waitFor(() => { expect(mockToast).toHaveBeenCalledWith({ title: eToast, variant: "destructive" }); });
    });
  });
});
