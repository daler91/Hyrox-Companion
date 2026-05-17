import { act, render, screen, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OfflineIndicator } from "../OfflineIndicator";

// Mock the hook + pending-count helper so we can drive both states
// synchronously without real network or IDB.
const onlineMock = { current: false };
const queueMock = { pendingCount: 3 };
const toastMock = vi.fn();
const invalidateWorkoutWriteQueriesMock = vi.fn();
vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => onlineMock.current,
}));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));
vi.mock("@/lib/offlineQueue", () => ({
  getPendingCount: () => queueMock.pendingCount,
  OFFLINE_QUEUE_CHANGE_EVENT: "offline-queue-change",
  OFFLINE_SYNC_COMPLETE_EVENT: "offline-sync-complete",
}));
vi.mock("@/lib/workoutInvalidation", () => ({
  invalidateWorkoutWriteQueries: () => invalidateWorkoutWriteQueriesMock(),
}));

describe("OfflineIndicator a11y", () => {
  beforeEach(() => {
    onlineMock.current = false;
    queueMock.pendingCount = 3;
    toastMock.mockClear();
    invalidateWorkoutWriteQueriesMock.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders nothing when online with no recent sync", async () => {
    onlineMock.current = true;
    queueMock.pendingCount = 0;
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

  it("shows queued writes even while online", async () => {
    onlineMock.current = true;
    queueMock.pendingCount = 2;

    render(<OfflineIndicator />);

    expect(await screen.findByTestId("indicator-sync-pending")).toHaveTextContent("2 changes waiting");
  });

  it("reacts to queue-change and sync-complete events", async () => {
    onlineMock.current = true;
    queueMock.pendingCount = 0;
    render(<OfflineIndicator />);

    act(() => {
      globalThis.dispatchEvent(new CustomEvent("offline-queue-change", { detail: { pendingCount: 1 } }));
    });
    expect(await screen.findByTestId("indicator-sync-pending")).toHaveTextContent("1 change waiting");

    queueMock.pendingCount = 0;
    act(() => {
      globalThis.dispatchEvent(new CustomEvent("offline-sync-complete", { detail: { synced: 1, failed: 0, dropped: 1 } }));
    });

    expect(await screen.findByTestId("indicator-sync-complete")).toHaveTextContent("1 change synced");
    expect(invalidateWorkoutWriteQueriesMock).toHaveBeenCalledOnce();
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
      title: "Some offline changes couldn't be synced",
      variant: "destructive",
    }));
  });
});
