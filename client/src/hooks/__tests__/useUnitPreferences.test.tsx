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

  type TestCase = {
    description: string;
    mockData?: { weightUnit?: string; distanceUnit?: string; weeklyGoal?: number };
    expectedWeight: 'kg' | 'lbs';
    expectedDistance: 'km' | 'miles';
    expectedLoading: boolean | undefined;
  };

  const testCases: TestCase[] = [
    {
      description: 'returns default values when no data is available',
      mockData: undefined,
      expectedWeight: 'kg',
      expectedDistance: 'km',
      expectedLoading: undefined,
    },
    {
      description: 'returns user preferences when data is available (metric)',
      mockData: { weightUnit: 'kg', distanceUnit: 'km', weeklyGoal: 3 },
      expectedWeight: 'kg',
      expectedDistance: 'km',
      expectedLoading: false,
    },
    {
      description: 'returns user preferences when data is available (imperial)',
      mockData: { weightUnit: 'lbs', distanceUnit: 'miles', weeklyGoal: 3 },
      expectedWeight: 'lbs',
      expectedDistance: 'miles',
      expectedLoading: false,
    },
    {
      description: 'falls back to defaults if partial data is missing',
      mockData: { weeklyGoal: 3 }, // Missing weightUnit and distanceUnit
      expectedWeight: 'kg',
      expectedDistance: 'km',
      expectedLoading: false,
    },
  ];

  it.each(testCases)('$description', async ({ mockData, expectedWeight, expectedDistance, expectedLoading }) => {
    if (mockData !== undefined) {
      queryClient.setQueryData(['/api/v1/preferences'], mockData);
    }

    const { result } = renderHook(() => useUnitPreferences(), { wrapper });

    if (mockData !== undefined) {
      await waitFor(() => {
        expect(result.current.weightUnit).toBe(expectedWeight);
      });
    }

    expect(result.current.weightUnit).toBe(expectedWeight);
    expect(result.current.distanceUnit).toBe(expectedDistance);
    expect(result.current.weightLabel).toBe(expectedWeight);
    expect(result.current.distanceLabel).toBe(expectedDistance);

    if (expectedLoading !== undefined) {
      expect(result.current.isLoading).toBe(expectedLoading);
    }
  });
});
