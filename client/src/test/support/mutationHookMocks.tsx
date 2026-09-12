import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { vi } from "vitest";

/**
 * Shared harness for the mutation-hook specs (useStravaMutations,
 * useGarminMutations, useDeviceLinkMutations). They all mock the same two
 * modules — the toast hook and the module-level queryClient the hooks reach
 * directly — and render through the same no-retry provider, so the factories,
 * spies and wrapper live here instead of being copied into each spec.
 */

/** Toast spy the specs assert on; the hooks receive it via `useToast()`. */
export const mockToast = vi.fn();

/** Factory body for `vi.mock("@/hooks/use-toast", ...)`. */
export function makeToastMock() {
  return { useToast: vi.fn(() => ({ toast: mockToast })) };
}

/**
 * Stands in for the module-level queryClient's invalidateQueries. The hooks
 * reach that singleton directly in their onError (a revoked connection must
 * refetch /status even though the mutation failed), so this spy — not the
 * provider's client — is what the invalidation assertions watch.
 */
export const invalidateQueriesSpy = vi.fn().mockResolvedValue(undefined);

/**
 * Factory body for `vi.mock("@/lib/queryClient", importOriginal)`. Keeps the
 * real module's other exports (apiRequest, humanizeApiError, …) and swaps only
 * the singleton client for the spy above.
 */
export async function makeQueryClientSingletonMock(
  importOriginal: () => Promise<Record<string, unknown>>,
) {
  return {
    ...(await importOriginal()),
    queryClient: { invalidateQueries: invalidateQueriesSpy },
  };
}

/** The query keys the hook invalidated, in call order. */
export function invalidatedKeys(): unknown[] {
  return invalidateQueriesSpy.mock.calls.map((call) => (call[0] as { queryKey: unknown }).queryKey);
}

/**
 * No-retry client for every mutation under test: renderHook's `wrapper` option
 * wants a component, so this hands back one closed over a fresh QueryClient.
 */
export function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: Readonly<{ children: ReactNode }>) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}
