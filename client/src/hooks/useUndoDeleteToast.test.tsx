import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Toaster } from "@/components/ui/toaster";
import { api } from "@/lib/api";
import { installRadixPointerMocks } from "@/test/support/radixPointerMocks";
import { renderWithClient } from "@/test/support/renderWithClient";

import { useUndoDeleteToast } from "./useRecycleBin";

vi.mock("@/lib/api", () => ({
  api: {
    recycleBin: {
      list: vi.fn(),
      restore: vi.fn(),
      restoreBatch: vi.fn(),
      purge: vi.fn(),
      empty: vi.fn(),
    },
  },
  QUERY_KEYS: {
    recycleBin: ["/api/v1/recycle-bin"],
    timeline: ["/api/v1/timeline"],
    workouts: ["/api/v1/workouts"],
    plans: ["/api/v1/plans"],
    personalRecords: ["/api/v1/personal-records"],
    exerciseAnalytics: ["/api/v1/exercise-analytics"],
    trainingOverview: ["/api/v1/training-overview"],
  },
}));

function UndoHarness({ target }: Readonly<{ target: { itemId: string } | { batchId: string } }>) {
  const showUndo = useUndoDeleteToast();
  return (
    <button
      type="button"
      onClick={() => showUndo({ title: "Workout deleted", target })}
      data-testid="trigger"
    >
      delete
    </button>
  );
}

describe("useUndoDeleteToast", () => {
  // The undo lives on the toast, so the Toaster has to be in the tree, and
  // Radix toast reaches for pointer APIs jsdom doesn't implement.
  installRadixPointerMocks();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the delete toast with an Undo that restores the item", async () => {
    vi.mocked(api.recycleBin.restore).mockResolvedValue({
      ok: true,
      entityType: "workout_log",
      entityId: "w1",
      batchId: null,
      warnings: [],
    });
    const user = userEvent.setup();
    renderWithClient(
      <>
        <UndoHarness target={{ itemId: "rb-1" }} />
        <Toaster />
      </>,
    );

    await user.click(screen.getByTestId("trigger"));
    expect(await screen.findByText("Workout deleted")).toBeInTheDocument();
    await user.click(await screen.findByTestId("button-undo-delete"));

    await waitFor(() => {
      expect(api.recycleBin.restore).toHaveBeenCalledWith("rb-1");
    });
    expect(api.recycleBin.restoreBatch).not.toHaveBeenCalled();
  });

  it("undoes a bulk delete through the batch id", async () => {
    vi.mocked(api.recycleBin.restoreBatch).mockResolvedValue({
      ok: true,
      batchId: "batch-1",
      restored: [],
      warnings: [],
    });
    const user = userEvent.setup();
    renderWithClient(
      <>
        <UndoHarness target={{ batchId: "batch-1" }} />
        <Toaster />
      </>,
    );

    await user.click(screen.getByTestId("trigger"));
    await user.click(await screen.findByTestId("button-undo-delete"));

    await waitFor(() => {
      expect(api.recycleBin.restoreBatch).toHaveBeenCalledWith("batch-1");
    });
    expect(api.recycleBin.restore).not.toHaveBeenCalled();
  });
});
