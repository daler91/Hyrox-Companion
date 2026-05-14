import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { email } from "@/lib/api/user";

import { useEmailCheck } from "../useEmailCheck";

vi.mock("@/lib/api/user", () => ({
  email: {
    check: vi.fn(),
  },
}));

describe("useEmailCheck", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(email.check).mockResolvedValue({ sent: [] });
  });

  it("waits for the app user before firing the email check", async () => {
    const { rerender } = renderHook(
      ({ isAuthenticated, isAppUserLoaded }) => useEmailCheck(isAuthenticated, isAppUserLoaded),
      {
        initialProps: {
          isAuthenticated: false,
          isAppUserLoaded: false,
        },
      },
    );

    rerender({ isAuthenticated: true, isAppUserLoaded: false });

    expect(email.check).not.toHaveBeenCalled();

    rerender({ isAuthenticated: true, isAppUserLoaded: true });

    await waitFor(() => expect(email.check).toHaveBeenCalledTimes(1));

    rerender({ isAuthenticated: true, isAppUserLoaded: true });

    expect(email.check).toHaveBeenCalledTimes(1);
  });
});
