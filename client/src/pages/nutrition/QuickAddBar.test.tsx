import type { FoodWithPortionMemory } from "@shared/schema";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Toaster } from "@/components/ui/toaster";
import { api } from "@/lib/api";
import { BANANA } from "@/test/factories/foodFactory";
import { installRadixPointerMocks } from "@/test/support/radixPointerMocks";
import { renderWithClient } from "@/test/support/renderWithClient";

import { QuickAddBar } from "./QuickAddBar";

const offlineQueueMocks = vi.hoisted(() => ({
  enqueueMutation: vi.fn(),
  createOfflineMutationId: vi.fn(() => "queued-id"),
}));

vi.mock("@/lib/api", () => ({
  api: {
    nutrition: {
      recent: vi.fn(),
      listFavorites: vi.fn(),
      createLog: vi.fn(),
      deleteLog: vi.fn(),
    },
  },
  QUERY_KEYS: {
    nutritionRecent: ["/api/v1/nutrition/foods/recent"],
    nutritionFavorites: ["/api/v1/nutrition/favorites"],
    nutritionDay: (date: string) => ["/api/v1/nutrition/summary", date],
    nutritionRangePrefix: ["/api/v1/nutrition/range"],
  },
}));
vi.mock("@/lib/offlineQueue", () => offlineQueueMocks);

function setOnline(online: boolean) {
  Object.defineProperty(globalThis.navigator, "onLine", { value: online, configurable: true });
}

const DATE = "2026-07-20";

/** A favourite the athlete has logged before — 140 g at breakfast. */
function remembered(overrides: Partial<FoodWithPortionMemory> = {}): FoodWithPortionMemory {
  return { ...BANANA, lastQuantityG: 140, lastMealType: "breakfast", ...overrides };
}

/** A favourite that was starred but never logged, so there is no portion to reuse. */
function unlogged(): FoodWithPortionMemory {
  return { ...BANANA, lastQuantityG: null, lastMealType: null };
}

describe("QuickAddBar", () => {
  // The undo test mounts the Toaster, and Radix toast reaches for pointer APIs
  // jsdom doesn't implement.
  installRadixPointerMocks();

  beforeEach(() => {
    vi.clearAllMocks();
    offlineQueueMocks.createOfflineMutationId.mockReturnValue("queued-id");
    setOnline(true);
  });

  afterEach(() => setOnline(true));

  it("renders nothing when there are no recent or favorite foods", () => {
    vi.mocked(api.nutrition.recent).mockResolvedValue([]);
    vi.mocked(api.nutrition.listFavorites).mockResolvedValue([]);
    const { container } = renderWithClient(<QuickAddBar onSelect={vi.fn()} date={DATE} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders recent foods and selects one on click", async () => {
    vi.mocked(api.nutrition.recent).mockResolvedValue([remembered()]);
    vi.mocked(api.nutrition.listFavorites).mockResolvedValue([]);
    const onSelect = vi.fn();
    const user = userEvent.setup();
    renderWithClient(<QuickAddBar onSelect={onSelect} date={DATE} />);

    await user.click(await screen.findByTestId("quickadd-recent-f1"));

    // Recent chips still open the dialog — that list is automatic and long, so
    // a stray tap there would be a real logging error.
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "f1" }));
    expect(api.nutrition.createLog).not.toHaveBeenCalled();
  });

  it("logs a favourite in one tap using the portion it was last logged in", async () => {
    vi.mocked(api.nutrition.recent).mockResolvedValue([]);
    vi.mocked(api.nutrition.listFavorites).mockResolvedValue([remembered()]);
    vi.mocked(api.nutrition.createLog).mockResolvedValue({ id: "entry-1" } as never);
    const onSelect = vi.fn();
    const user = userEvent.setup();
    renderWithClient(<QuickAddBar onSelect={onSelect} date={DATE} />);

    await user.click(await screen.findByTestId("quickadd-favorites-f1"));

    await waitFor(() => {
      expect(api.nutrition.createLog).toHaveBeenCalledWith(
        expect.objectContaining({ foodId: "f1", quantityG: 140, mealType: "breakfast" }),
        expect.anything(),
      );
    });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("offers an undo that removes the entry it just logged", async () => {
    vi.mocked(api.nutrition.recent).mockResolvedValue([]);
    vi.mocked(api.nutrition.listFavorites).mockResolvedValue([remembered()]);
    vi.mocked(api.nutrition.createLog).mockResolvedValue({ id: "entry-1" } as never);
    vi.mocked(api.nutrition.deleteLog).mockResolvedValue({ success: true });
    const user = userEvent.setup();
    // The undo lives on the toast, so the Toaster has to be in the tree.
    renderWithClient(
      <>
        <QuickAddBar onSelect={vi.fn()} date={DATE} />
        <Toaster />
      </>,
    );

    await user.click(await screen.findByTestId("quickadd-favorites-f1"));
    await user.click(await screen.findByTestId("button-undo-quickadd"));

    await waitFor(() => {
      expect(api.nutrition.deleteLog).toHaveBeenCalledWith("entry-1");
    });
  });

  it("disables the undo button after the first tap to prevent duplicate deletes", async () => {
    vi.mocked(api.nutrition.recent).mockResolvedValue([]);
    vi.mocked(api.nutrition.listFavorites).mockResolvedValue([remembered()]);
    vi.mocked(api.nutrition.createLog).mockResolvedValue({ id: "entry-1" } as never);
    vi.mocked(api.nutrition.deleteLog).mockResolvedValue({ success: true });
    const user = userEvent.setup();
    renderWithClient(
      <>
        <QuickAddBar onSelect={vi.fn()} date={DATE} />
        <Toaster />
      </>,
    );

    await user.click(await screen.findByTestId("quickadd-favorites-f1"));
    const undoBtn = await screen.findByTestId("button-undo-quickadd");
    await user.click(undoBtn);

    // After the first tap the button should be disabled with updated text.
    expect(undoBtn).toBeDisabled();
    expect(undoBtn).toHaveTextContent("Undoing…");

    // A second tap must not fire another delete.
    await user.click(undoBtn);
    expect(api.nutrition.deleteLog).toHaveBeenCalledTimes(1);
  });

  it("queues a favourite's quick-log offline without the undo toast", async () => {
    setOnline(false);
    vi.mocked(api.nutrition.recent).mockResolvedValue([]);
    vi.mocked(api.nutrition.listFavorites).mockResolvedValue([remembered()]);
    const user = userEvent.setup();
    renderWithClient(
      <>
        <QuickAddBar onSelect={vi.fn()} date={DATE} />
        <Toaster />
      </>,
    );

    await user.click(await screen.findByTestId("quickadd-favorites-f1"));

    // A queued write never reaches the server, so there is no entry id to
    // undo yet — the "Food logged" toast (with its undo action) must not
    // appear at all for this mutation.
    await waitFor(() => {
      expect(offlineQueueMocks.enqueueMutation).toHaveBeenCalled();
    });
    expect(api.nutrition.createLog).not.toHaveBeenCalled();
    expect(screen.queryByText("Food logged")).not.toBeInTheDocument();
  });

  it("falls back to the dialog for a favourite that has never been logged", async () => {
    vi.mocked(api.nutrition.recent).mockResolvedValue([]);
    vi.mocked(api.nutrition.listFavorites).mockResolvedValue([unlogged()]);
    const onSelect = vi.fn();
    const user = userEvent.setup();
    renderWithClient(<QuickAddBar onSelect={onSelect} date={DATE} />);

    await user.click(await screen.findByTestId("quickadd-favorites-f1"));

    // No remembered portion means no amount to log without asking.
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "f1" }));
    expect(api.nutrition.createLog).not.toHaveBeenCalled();
  });
});
