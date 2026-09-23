import { QueryClient } from "@tanstack/react-query";
import { vi } from "vitest";

/**
 * Module factories for the useWorkoutDetail specs that drive a mutation's
 * callbacks by hand (rollback, countsAsTraining). Each spec keeps its own
 * vi.mock calls, which Vitest hoists, and awaits these inside them. Nothing
 * here imports a module those specs mock at runtime, so the factories can
 * await-import this file without cycling back into the module being mocked.
 */

/**
 * Factory body for `vi.mock("@/hooks/useApiMutation", ...)`: a passthrough that
 * hands the config back, so a spec can call a mutation's onMutate, onError or
 * onSuccess itself instead of going through a mocked transport.
 */
export function makeApiMutationPassthroughMock() {
  return {
    useApiMutation: (config: unknown) => ({
      config,
      mutate: vi.fn(),
      mutateAsync: vi.fn().mockResolvedValue(undefined),
      isPending: false,
    }),
  };
}

/**
 * Factory body for `vi.mock("@/lib/queryClient", importOriginal)`: the real
 * module with a real, retry-free QueryClient as its singleton, so cache reads
 * and writes behave as they do in the app.
 */
export async function makeRealQueryClientMock(
  importOriginal: () => Promise<Record<string, unknown>>,
) {
  return {
    ...(await importOriginal()),
    queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  };
}

/**
 * Factory body for `vi.mock("@/lib/api", importOriginal)`: the real module with
 * the workout and history reads stubbed, so rendering the hook fetches nothing.
 */
export async function makeWorkoutReadsApiMock(
  importOriginal: () => Promise<typeof import("@/lib/api")>,
) {
  const actual = await importOriginal();
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
}
