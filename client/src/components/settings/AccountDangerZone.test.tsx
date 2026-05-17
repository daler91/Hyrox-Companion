import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AccountDangerZone } from "./AccountDangerZone";

const mocks = vi.hoisted(() => ({
  rawRequest: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/lib/api/client", () => ({
  rawRequest: mocks.rawRequest,
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

function renderDangerZone() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(<AccountDangerZone />, { wrapper });
}

describe("AccountDangerZone", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.clearAllMocks();
    mocks.rawRequest.mockResolvedValue(new Response(JSON.stringify({ success: true })));
  });

  it("clears user-scoped browser data after account deletion succeeds", async () => {
    localStorage.setItem("fitai-offline-queue", "[]");
    localStorage.setItem("fitai-log-workout-draft:user-1", "{}");
    localStorage.setItem("fitai-onboarding-complete", "true");
    localStorage.setItem("theme", "dark");
    localStorage.setItem("fitai-privacy-consent-v1", "123");
    sessionStorage.setItem("fitai-log-workout-draft-announced:user-1", "1");

    renderDangerZone();

    fireEvent.click(screen.getByRole("button", { name: /delete account/i }));
    fireEvent.change(await screen.findByLabelText(/type delete to confirm/i), {
      target: { value: "DELETE" },
    });
    fireEvent.click(screen.getByRole("button", { name: /delete my account/i }));

    await waitFor(() => {
      expect(mocks.rawRequest).toHaveBeenCalledWith("DELETE", "/api/v1/account");
      expect(localStorage.getItem("fitai-offline-queue")).toBeNull();
      expect(localStorage.getItem("fitai-log-workout-draft:user-1")).toBeNull();
      expect(localStorage.getItem("fitai-onboarding-complete")).toBeNull();
      expect(sessionStorage.getItem("fitai-log-workout-draft-announced:user-1")).toBeNull();
    });

    expect(localStorage.getItem("theme")).toBe("dark");
    expect(localStorage.getItem("fitai-privacy-consent-v1")).toBe("123");
  });
});
