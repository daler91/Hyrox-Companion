import type { ParseMealResponse } from "@shared/schema";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/api";

import { DescribeMealButton } from "./DescribeMealButton";

vi.mock("@/lib/api", () => ({
  api: { nutrition: { parseMealText: vi.fn() }, preferences: { update: vi.fn() } },
  QUERY_KEYS: { authUser: ["/api/v1/auth/user"] },
}));

// The consent gate reads this; default to consented so the parse tests run
// unobstructed, and flip it per-test to exercise the gate.
const authState = vi.hoisted(() => ({ aiCoachEnabled: true }));
vi.mock("@/hooks/useAuth", () => ({
  useIsAiCoachEnabled: () => authState.aiCoachEnabled,
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
  beforeEach(() => {
    vi.clearAllMocks();
    authState.aiCoachEnabled = true;
  });

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

  it("gates parsing behind AI consent and resumes with the typed text after accepting", async () => {
    const user = userEvent.setup();
    authState.aiCoachEnabled = false;
    vi.mocked(api.preferences.update).mockResolvedValue({} as never);
    vi.mocked(api.nutrition.parseMealText).mockResolvedValue(PARSED);
    const onParsed = vi.fn();
    renderButton(onParsed);

    await user.click(screen.getByTestId("button-describe-meal"));
    await user.type(screen.getByTestId("input-describe-meal"), "2 eggs");
    await user.click(screen.getByTestId("button-parse-meal"));

    // No parse yet — the consent dialog interposes.
    expect(api.nutrition.parseMealText).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Enable AI Coach" }));

    await waitFor(() =>
      expect(api.preferences.update).toHaveBeenCalledWith({ aiCoachEnabled: true }),
    );
    await waitFor(() => expect(api.nutrition.parseMealText).toHaveBeenCalledWith("2 eggs"));
    await waitFor(() => expect(onParsed).toHaveBeenCalledWith(PARSED));
  });

  it("keeps the dialog and typed text when consent is declined", async () => {
    const user = userEvent.setup();
    authState.aiCoachEnabled = false;
    renderButton(vi.fn());

    await user.click(screen.getByTestId("button-describe-meal"));
    await user.type(screen.getByTestId("input-describe-meal"), "2 eggs");
    await user.click(screen.getByTestId("button-parse-meal"));
    await user.click(screen.getByRole("button", { name: "Not now" }));

    expect(api.nutrition.parseMealText).not.toHaveBeenCalled();
    expect(screen.getByTestId("input-describe-meal")).toHaveValue("2 eggs");
  });

  it("keeps the dialog and text when the parse finds no foods", async () => {
    const user = userEvent.setup();
    vi.mocked(api.nutrition.parseMealText).mockResolvedValue({
      rawInput: "asdf",
      warnings: [],
      items: [],
    });
    const onParsed = vi.fn();
    renderButton(onParsed);

    await user.click(screen.getByTestId("button-describe-meal"));
    await user.type(screen.getByTestId("input-describe-meal"), "asdf");
    await user.click(screen.getByTestId("button-parse-meal"));

    await waitFor(() => expect(screen.getByTestId("text-no-foods-found")).toBeInTheDocument());
    expect(onParsed).not.toHaveBeenCalled();
    expect(screen.getByTestId("input-describe-meal")).toHaveValue("asdf");
  });
});
