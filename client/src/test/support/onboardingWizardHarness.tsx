import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { Mock } from "vitest";
import { vi } from "vitest";

import { OnboardingWizard } from "@/components/OnboardingWizard";
import { useToast } from "@/hooks/use-toast";
import * as queryClientLib from "@/lib/queryClient";

// Shared harness for the OnboardingWizard suites. Callers must mock
// "@/hooks/use-toast" (`useToast: vi.fn()`) and "@/lib/queryClient"
// (via @/test/support/queryClientLibMock) in their own file — vi.mock calls
// cannot be shared, but the factory bodies and per-test reset can.

/**
 * Per-test reset shared by the OnboardingWizard suites: clear all mocks,
 * re-arm the queryClient/apiRequest/useToast defaults, wipe localStorage,
 * and hand back a fresh QueryClient with retries off.
 */
export function resetOnboardingWizardMocks(mockToast: Mock): QueryClient {
  vi.clearAllMocks();
  // eslint-disable-next-line @typescript-eslint/unbound-method -- vi.mocked needs the raw method reference; the mock never reads `this`
  vi.mocked(queryClientLib.queryClient.invalidateQueries).mockResolvedValue(undefined);
  vi.mocked(queryClientLib.apiRequest).mockImplementation(async () =>
    new Response(JSON.stringify({ success: true })),
  );
  vi.mocked(useToast).mockReturnValue({ toast: mockToast } as unknown as ReturnType<
    typeof useToast
  >);
  localStorage.clear();
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

/** Render the wizard open inside the given QueryClient. */
export function renderOnboardingWizard(queryClient: QueryClient, onComplete: () => void) {
  return render(
    <QueryClientProvider client={queryClient}>
      <OnboardingWizard open={true} onComplete={onComplete} />
    </QueryClientProvider>,
  );
}
