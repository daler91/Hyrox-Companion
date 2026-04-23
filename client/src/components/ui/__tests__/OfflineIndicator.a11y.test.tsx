import { render, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OfflineIndicator } from "../OfflineIndicator";

// Mock the hook + pending-count helper so we can drive both states
// synchronously without real network or IDB.
const onlineMock = { current: false };
vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => onlineMock.current,
}));
vi.mock("@/lib/offlineQueue", () => ({
  getPendingCount: () => 3,
}));

describe("OfflineIndicator a11y", () => {
  beforeEach(() => {
    onlineMock.current = false;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders nothing when online with no recent sync", async () => {
    onlineMock.current = true;
    const { container } = render(<OfflineIndicator />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("has no WCAG violations while offline with queued writes", async () => {
    onlineMock.current = false;
    const { container } = render(<OfflineIndicator />);
    // Wait a frame so the lazy initializer + effect resolve.
    await waitFor(() => {
      expect(container.querySelector('[data-testid="indicator-offline"]')).toBeTruthy();
    });
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
