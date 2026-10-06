import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/api";
import { BANANA, makeFood } from "@/test/factories/foodFactory";
import { renderWithClient } from "@/test/support/renderWithClient";

import { FoodSearch } from "./FoodSearch";

vi.mock("@/lib/api", () => ({
  api: { nutrition: { search: vi.fn() } },
  QUERY_KEYS: { nutritionSearch: (q: string) => ["/api/v1/nutrition/foods/search", q] },
}));

describe("FoodSearch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows results after typing and selects one on click", async () => {
    vi.mocked(api.nutrition.search).mockResolvedValue({ results: [BANANA], apiDegraded: false });
    const onSelect = vi.fn();
    const user = userEvent.setup();
    renderWithClient(<FoodSearch onSelect={onSelect} />);

    await user.type(screen.getByTestId("input-food-search"), "ban");

    const result = await screen.findByTestId("result-food-f1");
    await user.click(result);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "f1" }));
  });

  it("announces result count to screen readers via aria-live", async () => {
    vi.mocked(api.nutrition.search).mockResolvedValue({ results: [BANANA], apiDegraded: false });
    const user = userEvent.setup();
    renderWithClient(<FoodSearch onSelect={vi.fn()} />);

    await user.type(screen.getByTestId("input-food-search"), "ban");
    await screen.findByTestId("result-food-f1");
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("1 result found"),
    );
  });

  it("announces no results to screen readers when search is empty", async () => {
    vi.mocked(api.nutrition.search).mockResolvedValue({ results: [], apiDegraded: false });
    const user = userEvent.setup();
    renderWithClient(<FoodSearch onSelect={vi.fn()} />);

    await user.type(screen.getByTestId("input-food-search"), "zzz");
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("No foods found"),
    );
  });

  it("shows kcal and protein on result rows", async () => {
    vi.mocked(api.nutrition.search).mockResolvedValue({ results: [BANANA], apiDegraded: false });
    const user = userEvent.setup();
    renderWithClient(<FoodSearch onSelect={vi.fn()} />);

    await user.type(screen.getByTestId("input-food-search"), "ban");
    const row = await screen.findByTestId("result-food-f1");
    expect(row).toHaveTextContent("kcal");
    expect(row).toHaveTextContent("protein");
  });

  it("selects the top result on Enter", async () => {
    vi.mocked(api.nutrition.search).mockResolvedValue({ results: [BANANA], apiDegraded: false });
    const onSelect = vi.fn();
    const user = userEvent.setup();
    renderWithClient(<FoodSearch onSelect={onSelect} />);

    await user.type(screen.getByTestId("input-food-search"), "ban");
    await screen.findByTestId("result-food-f1");
    await user.type(screen.getByTestId("input-food-search"), "{Enter}");

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "f1" }));
  });

  // CL62 (CODEBASE_ANALYSIS_2026-10-03): within the 300 ms debounce the list
  // still answers the previous query, and Enter picked that query's top hit.
  describe("Enter while the results are behind the typing", () => {
    const EGG = makeFood({ id: "egg", name: "Egg" });
    const EGGPLANT = makeFood({ id: "eggplant", name: "Eggplant" });

    function answerByQuery() {
      vi.mocked(api.nutrition.search).mockImplementation((query: string) =>
        Promise.resolve({ results: query === "eggplant" ? [EGGPLANT] : [EGG], apiDegraded: false }),
      );
    }

    it("picks the top hit for the text as typed, not the previous query's", async () => {
      answerByQuery();
      const onSelect = vi.fn();
      const user = userEvent.setup();
      renderWithClient(<FoodSearch onSelect={onSelect} />);
      const input = screen.getByTestId("input-food-search");

      await user.type(input, "egg");
      await screen.findByTestId("result-food-egg");
      // Typed and submitted well inside the debounce window.
      await user.type(input, "plant{Enter}");

      await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1));
      expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "eggplant" }));
      expect(api.nutrition.search).toHaveBeenCalledWith("eggplant");
    });

    it("drops the pick when the athlete keeps typing", async () => {
      answerByQuery();
      let answerEggplant: (() => void) | undefined;
      const onSelect = vi.fn();
      const user = userEvent.setup();
      renderWithClient(<FoodSearch onSelect={onSelect} />);
      const input = screen.getByTestId("input-food-search");

      await user.type(input, "egg");
      await screen.findByTestId("result-food-egg");
      vi.mocked(api.nutrition.search).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            answerEggplant = () => resolve({ results: [EGGPLANT], apiDegraded: false });
          }),
      );
      await user.type(input, "plant{Enter}");
      await user.type(input, "s");
      answerEggplant?.();

      await screen.findByTestId("result-food-egg");
      expect(onSelect).not.toHaveBeenCalled();
    });

    it("does nothing for text too short to search", async () => {
      answerByQuery();
      const onSelect = vi.fn();
      const user = userEvent.setup();
      renderWithClient(<FoodSearch onSelect={onSelect} />);

      await user.type(screen.getByTestId("input-food-search"), "e{Enter}");

      expect(onSelect).not.toHaveBeenCalled();
      expect(api.nutrition.search).not.toHaveBeenCalled();
    });
  });

  it("surfaces the cached-results notice when the API is degraded", async () => {
    vi.mocked(api.nutrition.search).mockResolvedValue({ results: [], apiDegraded: true });
    const user = userEvent.setup();
    renderWithClient(<FoodSearch onSelect={vi.fn()} />);

    await user.type(screen.getByTestId("input-food-search"), "ban");
    expect(await screen.findByTestId("text-search-degraded")).toBeInTheDocument();
  });
});
