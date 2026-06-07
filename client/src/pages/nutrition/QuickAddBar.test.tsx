import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useFavorites, useRecentFoods } from "@/hooks/useNutrition";

import { QuickAddBar } from "./QuickAddBar";

vi.mock("@/hooks/useNutrition", () => ({ useFavorites: vi.fn(), useRecentFoods: vi.fn() }));

const FOOD = { id: "f1", name: "Banana" };

describe("QuickAddBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing when there are no recent or favorite foods", () => {
    vi.mocked(useRecentFoods).mockReturnValue({ data: [] } as never);
    vi.mocked(useFavorites).mockReturnValue({ data: [] } as never);
    const { container } = render(<QuickAddBar onSelect={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders recent foods and selects one on click", async () => {
    vi.mocked(useRecentFoods).mockReturnValue({ data: [FOOD] } as never);
    vi.mocked(useFavorites).mockReturnValue({ data: [] } as never);
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<QuickAddBar onSelect={onSelect} />);

    await user.click(screen.getByTestId("quickadd-recent-f1"));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "f1" }));
  });
});
