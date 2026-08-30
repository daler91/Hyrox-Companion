import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";

/**
 * Render `ui` inside a fresh QueryClientProvider (retries off, staleTime
 * Infinity), optionally seeding the athlete's bodyweight into the preferences
 * query. The caller passes the preferences key so this helper never imports
 * QUERY_KEYS (specs mock "@/lib/api" with differing shapes). Replaces the
 * renderWithClient previously duplicated across the fuelling specs.
 */
export function renderWithBodyweight(
  ui: ReactNode,
  preferencesKey: unknown,
  bodyweightKg: number | null = 75,
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  if (bodyweightKg !== null) {
    queryClient.setQueryData(preferencesKey as never, { bodyweightKg } as never);
  }
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}
