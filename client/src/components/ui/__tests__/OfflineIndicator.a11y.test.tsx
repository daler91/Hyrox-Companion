import { act, render, screen, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { droppedChangesDescription, OfflineIndicator } from "../OfflineIndicator";

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
      globalThis.dispatchEvent(new CustomEvent("offline-sync-complete", { detail: { synced: 1, failed: 0, dropped: 1, expired: 0 } }));
    });

    expect(await screen.findByTestId("indicator-sync-complete")).toHaveTextContent("1 change synced");
    expect(invalidateWorkoutWriteQueriesMock).toHaveBeenCalledOnce();
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
      title: "Some offline changes couldn't be synced",
      variant: "destructive",
    }));
  });
});

// Tech debt #57: the toast blamed "too many failed attempts" for every drop,
// including the ones discarded for being more than 7 days old.
describe("droppedChangesDescription", () => {
  it("names age when every drop expired", () => {
    expect(droppedChangesDescription(1, 1)).toBe(
      "1 change was discarded because it was queued more than 7 days ago. Please re-enter recent edits.",
    );
    expect(droppedChangesDescription(2, 2)).toBe(
      "2 changes were discarded because they were queued more than 7 days ago. Please re-enter recent edits.",
    );
  });

  it("names failed attempts when none expired", () => {
    expect(droppedChangesDescription(3, 0)).toBe(
      "3 changes were discarded after too many failed attempts. Please re-enter recent edits.",
    );
  });

  it("splits a mix of the two", () => {
    expect(droppedChangesDescription(3, 1)).toBe(
      "3 changes were discarded: 1 queued more than 7 days ago, 2 after too many failed attempts. Please re-enter recent edits.",
    );
  });

  it("is what the toast says for an expired drop", () => {
    onlineMock.current = true;
    queueMock.pendingCount = 0;
    toastMock.mockClear();
    render(<OfflineIndicator />);

    act(() => {
      globalThis.dispatchEvent(
        new CustomEvent("offline-sync-complete", { detail: { synced: 0, failed: 0, dropped: 1, expired: 1 } }),
      );
    });

    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ description: droppedChangesDescription(1, 1) }),
    );
  });
});
