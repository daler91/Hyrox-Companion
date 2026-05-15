import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useOnboarding } from "@/hooks/useOnboarding";

vi.mock("@/lib/queryClient", () => ({
  queryClient: { invalidateQueries: vi.fn().mockResolvedValue(undefined) },
}));

describe("useOnboarding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("does not mark onboarding complete until an import succeeds", async () => {
    const input = document.createElement("input");
    input.click = vi.fn();
    const fileInputRef = { current: input };
    const { result } = renderHook(() => useOnboarding(false, fileInputRef));

    act(() => {
      result.current.handleOnboardingComplete("import");
    });

    expect(localStorage.getItem("fitai-onboarding-complete")).toBeNull();
    await waitFor(() => {
      expect(result.current.pendingImportCompletion).toBe(true);
    });

    act(() => {
      result.current.handlePlanImported();
    });

    expect(localStorage.getItem("fitai-onboarding-complete")).toBe("true");
    expect(result.current.pendingImportCompletion).toBe(false);
  });
});
