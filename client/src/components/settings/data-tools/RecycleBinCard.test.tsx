import type { RecycleBinListItem, RecycleBinListResponse } from "@shared/schema";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/api";
import { installRadixPointerMocks } from "@/test/support/radixPointerMocks";
import { renderWithClient } from "@/test/support/renderWithClient";

import { RecycleBinCard } from "./RecycleBinCard";

const mocks = vi.hoisted(() => ({ toast: vi.fn() }));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));

vi.mock("@/lib/api", async () =>
  (await import("@/test/support/recycleBinApiMock")).mockRecycleBinApiModule(),
);

function item(overrides: Partial<RecycleBinListItem> = {}): RecycleBinListItem {
  return {
    id: "rb-1",
    entityType: "workout_log",
    entityId: "w1",
    batchId: null,
    label: "Strength",
    summary: "5x5 Back Squat",
    entityDate: "2026-09-01",
    childCount: 5,
    deletedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    expiresAt: new Date(Date.now() + 88 * 24 * 60 * 60 * 1000).toISOString(),
    ...overrides,
  };
}

function listing(items: RecycleBinListItem[]): RecycleBinListResponse {
  const counts = { total: items.length, workout_log: 0, plan_day: 0, training_plan: 0 };
  for (const entry of items) counts[entry.entityType] += 1;
  return { items, counts };
}

describe("RecycleBinCard", () => {
  installRadixPointerMocks();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the empty state, with Empty bin disabled, when nothing is binned", async () => {
    vi.mocked(api.recycleBin.list).mockResolvedValue(listing([]));
    renderWithClient(<RecycleBinCard />);

    expect(await screen.findByTestId("recycle-bin-empty")).toBeInTheDocument();
    expect(screen.getByTestId("button-empty-recycle-bin")).toBeDisabled();
    expect(screen.queryByTestId("recycle-bin-count")).not.toBeInTheDocument();
  });

  it("lists items with their type, summary and expiry, and passes an accessibility audit", async () => {
    vi.mocked(api.recycleBin.list).mockResolvedValue(
      listing([
        item(),
        item({
          id: "rb-2",
          entityType: "training_plan",
          entityId: "p1",
          label: "12-week build",
          summary: "48 days · 12 weeks",
        }),
      ]),
    );
    const { container } = renderWithClient(<RecycleBinCard />);

    const row = await screen.findByTestId("recycle-bin-item-rb-1");
    expect(row).toHaveTextContent("Strength");
    expect(row).toHaveTextContent("Workout");
    expect(row).toHaveTextContent("5x5 Back Squat");
    expect(row).toHaveTextContent("expires in 88 days");
    expect(screen.getByTestId("recycle-bin-item-rb-2")).toHaveTextContent("Training plan");
    expect(screen.getByTestId("recycle-bin-count")).toHaveTextContent("2");

    expect(await axe(container)).toHaveNoViolations();
  });

  it("restores an item straight away (no confirmation — restore is safe)", async () => {
    vi.mocked(api.recycleBin.list).mockResolvedValue(listing([item()]));
    vi.mocked(api.recycleBin.restore).mockResolvedValue({
      ok: true,
      entityType: "workout_log",
      entityId: "w1",
      batchId: null,
      warnings: [],
    });
    const user = userEvent.setup();
    renderWithClient(<RecycleBinCard />);

    await user.click(await screen.findByTestId("button-restore-rb-1"));

    await waitFor(() => {
      expect(api.recycleBin.restore).toHaveBeenCalledWith("rb-1");
    });
    expect(mocks.toast).toHaveBeenCalledWith({ title: "Restored" });
  });

  it("asks before deleting an item forever, then purges it", async () => {
    vi.mocked(api.recycleBin.list).mockResolvedValue(listing([item()]));
    vi.mocked(api.recycleBin.purge).mockResolvedValue({ success: true });
    const user = userEvent.setup();
    renderWithClient(<RecycleBinCard />);

    await user.click(await screen.findByTestId("button-purge-rb-1"));
    expect(api.recycleBin.purge).not.toHaveBeenCalled();
    expect(await screen.findByText("Delete forever?")).toBeInTheDocument();

    await user.click(screen.getByTestId("confirm-purge-item"));

    await waitFor(() => {
      expect(api.recycleBin.purge).toHaveBeenCalledWith("rb-1");
    });
  });

  it("asks before emptying the bin, then empties it", async () => {
    vi.mocked(api.recycleBin.list).mockResolvedValue(
      listing([item(), item({ id: "rb-2", entityId: "w2" })]),
    );
    vi.mocked(api.recycleBin.empty).mockResolvedValue({ success: true, purgedCount: 2 });
    const user = userEvent.setup();
    renderWithClient(<RecycleBinCard />);

    await user.click(await screen.findByTestId("button-empty-recycle-bin"));
    expect(await screen.findByText("Empty the recycle bin?")).toBeInTheDocument();
    expect(screen.getByText(/2 items will be permanently deleted/)).toBeInTheDocument();

    await user.click(screen.getByTestId("confirm-empty-recycle-bin"));

    await waitFor(() => {
      expect(api.recycleBin.empty).toHaveBeenCalledTimes(1);
    });
  });

  it("shows an error message when the listing fails", async () => {
    vi.mocked(api.recycleBin.list).mockRejectedValue(new Error("500: boom"));
    renderWithClient(<RecycleBinCard />);

    expect(await screen.findByTestId("recycle-bin-error")).toBeInTheDocument();
  });
});
