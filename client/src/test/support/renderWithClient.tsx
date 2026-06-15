import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";

interface RenderWithClientOptions {
  /**
   * Seed the react-query cache before render. Each entry is [queryKey, data]; the
   * caller passes the key so this helper never imports QUERY_KEYS (specs mock
   * "@/lib/api" with differing shapes).
   */
  readonly seed?: readonly (readonly [queryKey: unknown, data: unknown])[];
}

/**
 * Render `ui` inside a fresh QueryClientProvider with retries disabled, optionally
 * seeding the cache first. Replaces the renderWithClient previously duplicated
 * across the nutrition specs.
 */
export function renderWithClient(ui: ReactNode, options: RenderWithClientOptions = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  for (const [queryKey, data] of options.seed ?? []) {
    queryClient.setQueryData(queryKey as never, data as never);
  }
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}
