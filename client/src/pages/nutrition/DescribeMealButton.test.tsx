import type { ParseMealResponse } from "@shared/schema";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/api";

import { DescribeMealButton } from "./DescribeMealButton";

vi.mock("@/lib/api", () => ({
  api: { nutrition: { parseMealText: vi.fn() } },
  QUERY_KEYS: {},
}));

const PARSED: ParseMealResponse = {
  rawInput: "2 eggs",
  warnings: [],
  items: [
    {
      name: "egg, scrambled",
      quantityG: 100,
      displayAmount: "2 eggs",
      mealType: "breakfast",
      confidence: 90,
      foodId: "f1",
      food: null,
      nutrition: null,
    },
  ],
};

function renderButton(onParsed: (r: ParseMealResponse) => void) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui: ReactNode = <DescribeMealButton onParsed={onParsed} />;
  render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe("DescribeMealButton", () => {
  beforeEach(() => vi.clearAllMocks());

  it("opens a dialog, parses the typed meal, and hands the result to onParsed", async () => {
    const user = userEvent.setup();
    vi.mocked(api.nutrition.parseMealText).mockResolvedValue(PARSED);
    const onParsed = vi.fn();
    renderButton(onParsed);

    await user.click(screen.getByTestId("button-describe-meal"));
    await user.type(screen.getByTestId("input-describe-meal"), "2 eggs");
    await user.click(screen.getByTestId("button-parse-meal"));

    await waitFor(() => expect(api.nutrition.parseMealText).toHaveBeenCalledWith("2 eggs"));
    await waitFor(() => expect(onParsed).toHaveBeenCalledWith(PARSED));
  });

  it("keeps the parse button disabled until text is entered", async () => {
    const user = userEvent.setup();
    renderButton(vi.fn());
    await user.click(screen.getByTestId("button-describe-meal"));
    expect(screen.getByTestId("button-parse-meal")).toBeDisabled();
  });
});
