import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as useToastModule from '@/hooks/use-toast';
import { api } from '@/lib/api';
import { queryClient as globalQueryClient } from '@/lib/queryClient';

import {
  useCoachingMaterials,
  useCreateCoachingMaterial,
  useDeleteCoachingMaterial,
  useRagStatus,
  useReEmbed,
  useUpdateCoachingMaterial,
} from '../useCoachingMaterials';

vi.mock('@/lib/api', () => ({
  QUERY_KEYS: {
    coachingMaterials: ['coaching-materials'],
    ragStatus: ['rag-status'],
  },
  api: {
    coaching: {
      list: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      getRagStatus: vi.fn(),
      reEmbed: vi.fn(),
    },
  },
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: vi.fn(),
}));

vi.mock('@/lib/queryClient', () => ({
  queryClient: {
    invalidateQueries: vi.fn(),
  },
  humanizeApiError: vi.fn((e) => e.message),
  AiBudgetExceededError: class AiBudgetExceededError extends Error {},
  RateLimitError: class RateLimitError extends Error { retryAfter?: number },
}));

const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

describe('useCoachingMaterials hooks', () => {
  let queryClient: QueryClient;
  let mockToast: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    queryClient = createTestQueryClient();
    vi.clearAllMocks();
    mockToast = vi.fn();
    (useToastModule.useToast as any).mockReturnValue({ toast: mockToast });
  });

  afterEach(() => {
    queryClient.clear();
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  describe('useCoachingMaterials', () => {
    it('fetches coaching materials successfully', async () => {
      const mockMaterials = [
        { id: '1', title: 'Test 1', content: 'Content 1', type: 'principles' },
      ];
      (api.coaching.list as any).mockResolvedValue(mockMaterials);

      const { result } = renderHook(() => useCoachingMaterials(), { wrapper });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toEqual(mockMaterials);
      expect(api.coaching.list).toHaveBeenCalledTimes(1);
    });
  });

  describe('useCreateCoachingMaterial', () => {
    it('creates coaching material and invalidates queries on success', async () => {
      (api.coaching.create as any).mockResolvedValue({ id: '2' });

      const { result } = renderHook(() => useCreateCoachingMaterial(), { wrapper });

      act(() => {
        result.current.mutate({ title: 'New', content: 'Content', type: 'principles' });
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(api.coaching.create).toHaveBeenCalledWith({ title: 'New', content: 'Content', type: 'principles' });
      expect(globalQueryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['coaching-materials'] });
      expect(mockToast).toHaveBeenCalledWith({ title: 'Coaching material added' });
    });

    it('handles creation errors', async () => {
      (api.coaching.create as any).mockRejectedValue(new Error('Creation failed'));

      const { result } = renderHook(() => useCreateCoachingMaterial(), { wrapper });

      act(() => {
        result.current.mutate({ title: 'New', content: 'Content', type: 'principles' });
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(mockToast).toHaveBeenCalledWith({
        title: 'Failed to add coaching material',
        description: 'Creation failed',
        variant: 'destructive',
      });
    });
  });

  describe('useUpdateCoachingMaterial', () => {
    it('updates coaching material and invalidates queries on success', async () => {
      (api.coaching.update as any).mockResolvedValue({ id: '1' });

      const { result } = renderHook(() => useUpdateCoachingMaterial(), { wrapper });

      act(() => {
        result.current.mutate({ id: '1', title: 'Updated' });
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(api.coaching.update).toHaveBeenCalledWith('1', { title: 'Updated' });
      expect(globalQueryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['coaching-materials'] });
      expect(mockToast).toHaveBeenCalledWith({ title: 'Coaching material updated' });
    });
  });

  describe('useDeleteCoachingMaterial', () => {
    it('deletes coaching material and invalidates queries on success', async () => {
      (api.coaching.delete as any).mockResolvedValue({ success: true });

      const { result } = renderHook(() => useDeleteCoachingMaterial(), { wrapper });

      act(() => {
        result.current.mutate('1');
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(api.coaching.delete).toHaveBeenCalledWith('1');
      expect(globalQueryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['coaching-materials'] });
      expect(mockToast).toHaveBeenCalledWith({ title: 'Coaching material removed' });
    });
  });

  describe('useRagStatus', () => {
    it('fetches RAG status successfully', async () => {
      const mockStatus = { status: 'ready', materialCount: 5 };
      (api.coaching.getRagStatus as any).mockResolvedValue(mockStatus);

      const { result } = renderHook(() => useRagStatus(), { wrapper });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toEqual(mockStatus);
      expect(api.coaching.getRagStatus).toHaveBeenCalledTimes(1);
    });
  });

  describe('useReEmbed', () => {
    it('calls reEmbed and handles success with no errors', async () => {
      (api.coaching.reEmbed as any).mockResolvedValue({ materialsProcessed: 3, errors: [] });

      const { result } = renderHook(() => useReEmbed(), { wrapper });

      act(() => {
        result.current.mutate();
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(api.coaching.reEmbed).toHaveBeenCalledTimes(1);
      expect(globalQueryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['rag-status'] });
      expect(mockToast).toHaveBeenCalledWith({ title: 'Successfully embedded 3 material(s)' });
    });

    it('calls reEmbed and handles success with errors', async () => {
      (api.coaching.reEmbed as any).mockResolvedValue({ materialsProcessed: 2, errors: ['Failed to parse document'] });

      const { result } = renderHook(() => useReEmbed(), { wrapper });

      act(() => {
        result.current.mutate();
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(mockToast).toHaveBeenCalledWith({
        title: 'Embedded 2 materials with 1 error(s)',
        description: 'Failed to parse document',
        variant: 'destructive',
      });
    });

    it('calls reEmbed and handles network error', async () => {
      (api.coaching.reEmbed as any).mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useReEmbed(), { wrapper });

      act(() => {
        result.current.mutate();
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(mockToast).toHaveBeenCalledWith({
        title: 'Failed to re-embed',
        description: 'Network error',
        variant: 'destructive',
      });
    });
  });
});
