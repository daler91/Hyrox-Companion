import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useUnitPreferences } from '../useUnitPreferences';

const createTestQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      queryFn: () => Promise.resolve({}), // Provide a default mock queryFn to avoid React Query warnings
    },
  },
});

describe('useUnitPreferences', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  it('returns default values when no data is available', async () => {
    const { result } = renderHook(() => useUnitPreferences(), { wrapper });

    expect(result.current.weightUnit).toBe('kg');
    expect(result.current.distanceUnit).toBe('km');
    expect(result.current.weightLabel).toBe('kg');
    expect(result.current.distanceLabel).toBe('km');
  });

  it('returns user preferences when data is available (metric)', async () => {
    queryClient.setQueryData(['/api/preferences'], {
      weightUnit: 'kg',
      distanceUnit: 'km',
      weeklyGoal: 3
    });

    const { result } = renderHook(() => useUnitPreferences(), { wrapper });

    await waitFor(() => {
      expect(result.current.weightUnit).toBe('kg');
    });

    expect(result.current.distanceUnit).toBe('km');
    expect(result.current.weightLabel).toBe('kg');
    expect(result.current.distanceLabel).toBe('km');
    expect(result.current.isLoading).toBe(false);
  });

  it('returns user preferences when data is available (imperial)', async () => {
    queryClient.setQueryData(['/api/preferences'], {
      weightUnit: 'lbs',
      distanceUnit: 'miles',
      weeklyGoal: 3
    });

    const { result } = renderHook(() => useUnitPreferences(), { wrapper });

    await waitFor(() => {
      expect(result.current.weightUnit).toBe('lbs');
    });

    expect(result.current.distanceUnit).toBe('miles');
    expect(result.current.weightLabel).toBe('lbs');
    expect(result.current.distanceLabel).toBe('miles');
    expect(result.current.isLoading).toBe(false);
  });

  it('falls back to defaults if partial data is missing', async () => {
    queryClient.setQueryData(['/api/preferences'], {
      // Missing weightUnit and distanceUnit
      weeklyGoal: 3
    });

    const { result } = renderHook(() => useUnitPreferences(), { wrapper });

    await waitFor(() => {
      expect(result.current.weightUnit).toBe('kg');
    });

    expect(result.current.distanceUnit).toBe('km');
    expect(result.current.weightLabel).toBe('kg');
    expect(result.current.distanceLabel).toBe('km');
    expect(result.current.isLoading).toBe(false);
  });
});
