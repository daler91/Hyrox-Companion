import { QueryClient, QueryClientProvider, type QueryFunction } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useIsAuthUserLoaded, useIsOnboardingCompleted } from "../useAuth";

vi.mock("@/lib/api", () => ({
  QUERY_KEYS: { authUser: ["/api/v1/auth/user"] },
}));

vi.mock("@clerk/react", () => ({
  useAuth: vi.fn(),
  useUser: vi.fn(),
}));

vi.mock("@/lib/queryClient", () => ({
  resetCsrfToken: vi.fn(),
}));

function renderCompletion(authUserQueryFn: () => Promise<unknown>) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, queryFn: authUserQueryFn as unknown as QueryFunction },
    },
  });
  return renderHook(
    () => ({ onboardingCompleted: useIsOnboardingCompleted(), isAuthUserLoaded: useIsAuthUserLoaded() }),
    {
      wrapper: ({ children }: Readonly<{ children: React.ReactNode }>) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      ),
    },
  );
}

// The Timeline launches onboarding when this reads false. A failed auth-user
// query used to read as false too, which launched the wizard for an onboarded
// athlete on a device without the local completion flag; it is unknown
// (undefined) instead. U5 (CODEBASE_ANALYSIS_2026-10-03)
describe("useIsOnboardingCompleted", () => {
  it("is unknown while the auth user loads and after it failed to load", async () => {
    let rejectAuthUser: (error: Error) => void = () => undefined;
    const { result } = renderCompletion(
      () =>
        new Promise((_resolve, reject) => {
          rejectAuthUser = reject;
        }),
    );

    expect(result.current.onboardingCompleted).toBeUndefined();

    rejectAuthUser(new Error("503: Service Unavailable"));
    await waitFor(() => {
      expect(result.current.isAuthUserLoaded).toBe(true);
    });
    expect(result.current.onboardingCompleted).toBeUndefined();
  });

  it.each([true, false])("reads %s from a loaded auth user", async (onboardingCompleted) => {
    const { result } = renderCompletion(() => Promise.resolve({ id: "user-1", onboardingCompleted }));

    await waitFor(() => {
      expect(result.current.onboardingCompleted).toBe(onboardingCompleted);
    });
  });
});
