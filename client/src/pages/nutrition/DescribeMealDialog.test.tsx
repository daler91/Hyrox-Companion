import type { ParseMealResponse } from "@shared/schema";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/api";
import { captureAuthState } from "@/test/support/imageCaptureMocks";

import { DescribeMealDialog } from "./DescribeMealDialog";

vi.mock("@/lib/api", async () =>
  (await import("@/test/support/imageCaptureMocks")).makeCaptureApiMock({
    parseMealText: vi.fn(),
  }),
);
vi.mock("@/hooks/useAuth", async () =>
  (await import("@/test/support/imageCaptureMocks")).makeCaptureAuthMock(),
);

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

function renderDialog(onParsed: (r: ParseMealResponse) => void, onOpenChange = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui: ReactNode = <DescribeMealDialog open onOpenChange={onOpenChange} onParsed={onParsed} />;
  render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
  return { onOpenChange };
}

describe("DescribeMealDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    captureAuthState.aiCoachEnabled = true;
  });

  it("parses the typed meal and hands the result to onParsed", async () => {
    const user = userEvent.setup();
    vi.mocked(api.nutrition.parseMealText).mockResolvedValue(PARSED);
    const onParsed = vi.fn();
    renderDialog(onParsed);

    await user.type(screen.getByTestId("input-describe-meal"), "2 eggs");
    await user.click(screen.getByTestId("button-parse-meal"));

    await waitFor(() => expect(api.nutrition.parseMealText).toHaveBeenCalledWith("2 eggs"));
    await waitFor(() => expect(onParsed).toHaveBeenCalledWith(PARSED));
  });

  it("keeps the parse button disabled until text is entered", () => {
    renderDialog(vi.fn());
    expect(screen.getByTestId("button-parse-meal")).toBeDisabled();
  });

  it("gates parsing behind AI consent and resumes with the typed text after accepting", async () => {
    const user = userEvent.setup();
    captureAuthState.aiCoachEnabled = false;
    vi.mocked(api.preferences.update).mockResolvedValue({} as never);
    vi.mocked(api.nutrition.parseMealText).mockResolvedValue(PARSED);
    const onParsed = vi.fn();
    renderDialog(onParsed);

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
    captureAuthState.aiCoachEnabled = false;
    renderDialog(vi.fn());

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
    renderDialog(onParsed);

    await user.type(screen.getByTestId("input-describe-meal"), "asdf");
    await user.click(screen.getByTestId("button-parse-meal"));

    await waitFor(() => expect(screen.getByTestId("text-no-foods-found")).toBeInTheDocument());
    expect(onParsed).not.toHaveBeenCalled();
    expect(screen.getByTestId("input-describe-meal")).toHaveValue("asdf");
  });
});
