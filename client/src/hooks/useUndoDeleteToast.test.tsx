import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Toaster } from "@/components/ui/toaster";
import { api } from "@/lib/api";
import { installRadixPointerMocks } from "@/test/support/radixPointerMocks";
import { renderWithClient } from "@/test/support/renderWithClient";

import { useUndoDeleteToast } from "./useRecycleBin";

vi.mock("@/lib/api", async () =>
  (await import("@/test/support/recycleBinApiMock")).mockRecycleBinApiModule(),
);

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
