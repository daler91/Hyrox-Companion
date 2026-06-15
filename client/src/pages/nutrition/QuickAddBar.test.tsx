import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/api";
import { BANANA } from "@/test/factories/foodFactory";
import { renderWithClient } from "@/test/support/renderWithClient";

import { QuickAddBar } from "./QuickAddBar";

vi.mock("@/lib/api", () => ({
  api: { nutrition: { recent: vi.fn(), listFavorites: vi.fn() } },
  QUERY_KEYS: {
    nutritionRecent: ["/api/v1/nutrition/foods/recent"],
    nutritionFavorites: ["/api/v1/nutrition/favorites"],
  },
}));

describe("QuickAddBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing when there are no recent or favorite foods", () => {
    vi.mocked(api.nutrition.recent).mockResolvedValue([]);
    vi.mocked(api.nutrition.listFavorites).mockResolvedValue([]);
    const { container } = renderWithClient(<QuickAddBar onSelect={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders recent foods and selects one on click", async () => {
    vi.mocked(api.nutrition.recent).mockResolvedValue([BANANA]);
    vi.mocked(api.nutrition.listFavorites).mockResolvedValue([]);
    const onSelect = vi.fn();
    const user = userEvent.setup();
    renderWithClient(<QuickAddBar onSelect={onSelect} />);

    await user.click(await screen.findByTestId("quickadd-recent-f1"));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "f1" }));
  });
});
