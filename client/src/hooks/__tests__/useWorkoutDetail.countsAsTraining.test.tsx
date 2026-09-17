import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useWorkoutDetail } from "@/hooks/useWorkoutDetail";
import { QUERY_KEYS } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";

// Same isolation as useWorkoutDetail.rollback.test.tsx: replacing useApiMutation
// with a passthrough hands back the raw config, so onSuccess can be driven
// directly without a mocked transport.
vi.mock("@/hooks/useApiMutation", () => ({
  useApiMutation: (config: unknown) => ({
    config,
    mutate: vi.fn(),
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
  }),
}));

vi.mock("@/lib/queryClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/queryClient")>();
  const { QueryClient } = await import("@tanstack/react-query");
  return {
    ...actual,
    queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  };
});

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      workouts: {
        ...actual.api.workouts,
        get: vi.fn().mockResolvedValue(undefined),
        history: vi.fn().mockResolvedValue(undefined),
      },
    },
  };
});

const WORKOUT_ID = "workout-1";
const UNRELATED_KEY = ["/api/v1/unrelated-for-this-test"] as const;

interface MutationConfig {
  onSuccess?: () => unknown;
}

function configOf(mutation: unknown): MutationConfig {
  return (mutation as { config: MutationConfig }).config;
}

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

// Whether a session counts as training feeds the session counts, the streak
// and the training mix (see the comment on updateCountsAsTraining in
// useWorkoutDetail.ts) — so a successful flip has to invalidate the timeline,
// the training overview AND personal records, not just the workout itself.
describe("useWorkoutDetail updateCountsAsTraining invalidates every dependent cache on success", () => {
  beforeEach(() => {
    queryClient.clear();
    queryClient.setQueryData(QUERY_KEYS.timeline, ["stale-timeline"]);
    queryClient.setQueryData(QUERY_KEYS.trainingOverview, { stale: true });
    queryClient.setQueryData(QUERY_KEYS.personalRecords, ["stale-pr"]);
    queryClient.setQueryData(QUERY_KEYS.workout(WORKOUT_ID), { id: WORKOUT_ID });
    queryClient.setQueryData(UNRELATED_KEY, { untouched: true });
  });

  it("invalidates the timeline, training overview and personal records queries", async () => {
    const { result } = renderHook(() => useWorkoutDetail(WORKOUT_ID), { wrapper });
    const countsAsTraining = configOf(result.current.updateCountsAsTraining);

    await countsAsTraining.onSuccess!();

    expect(queryClient.getQueryState(QUERY_KEYS.timeline)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(QUERY_KEYS.trainingOverview)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(QUERY_KEYS.personalRecords)?.isInvalidated).toBe(true);
  });

  it("does not invalidate an unrelated cache entry", async () => {
    const { result } = renderHook(() => useWorkoutDetail(WORKOUT_ID), { wrapper });
    const countsAsTraining = configOf(result.current.updateCountsAsTraining);

    await countsAsTraining.onSuccess!();

    expect(queryClient.getQueryState(UNRELATED_KEY)?.isInvalidated).toBeFalsy();
  });
});
