import { OAT_BAR_LABEL_SCAN } from "@shared/nutritionTestFixtures";
import type { ParseMealResponse } from "@shared/schema";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/api";

import { LogFoodActions } from "./LogFoodActions";

vi.mock("@/lib/api", () => ({
  api: { nutrition: { parseMealPhoto: vi.fn(), parseLabel: vi.fn() } },
  QUERY_KEYS: {},
}));

const toastSpy = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: toastSpy }) }));

// The photo rows' capture + consent gating are tested in their own suites;
// stub them to hand a photo straight back, so this suite covers the menu and
// the parses it owns.
vi.mock("./SnapMealButton", async () => ({
  SnapMealButton: (await import("@/test/support/photoRowStub")).photoRow("Snap a meal"),
}));
vi.mock("./ScanLabelButton", async () => ({
  ScanLabelButton: (await import("@/test/support/photoRowStub")).photoRow("Scan label"),
}));

const PARSED: ParseMealResponse = { rawInput: "[photo]", warnings: [], items: [] };

function renderActions() {
  const handlers = {
    onDescribe: vi.fn(),
    onScanBarcode: vi.fn(),
    onMealParsed: vi.fn(),
    onLabelExtracted: vi.fn(),
    onCustomFood: vi.fn(),
    onRecipe: vi.fn(),
    onTargets: vi.fn(),
  };
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <LogFoodActions {...handlers} />
    </QueryClientProvider>,
  );
  return handlers;
}

/** A promise and its resolver, for a parse that answers when the test says. */
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("LogFoodActions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("opens the method sheet from the single primary button", async () => {
    const user = userEvent.setup();
    renderActions();

    expect(screen.queryByTestId("menu-describe-meal")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("button-log-food"));

    expect(await screen.findByTestId("menu-describe-meal")).toBeInTheDocument();
    expect(screen.getByTestId("menu-scan-barcode")).toBeInTheDocument();
    expect(screen.getByText("Snap a meal")).toBeInTheDocument();
    expect(screen.getByText("Scan label")).toBeInTheDocument();
    expect(screen.getByTestId("menu-custom-food")).toBeInTheDocument();
    expect(screen.getByTestId("menu-recipe")).toBeInTheDocument();
    expect(screen.getByTestId("menu-targets")).toBeInTheDocument();
  });

  it("fires the chosen method and closes the sheet", async () => {
    const user = userEvent.setup();
    const handlers = renderActions();

    await user.click(screen.getByTestId("button-log-food"));
    await user.click(await screen.findByTestId("menu-describe-meal"));

    expect(handlers.onDescribe).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.queryByTestId("menu-describe-meal")).not.toBeInTheDocument(),
    );
  });

  it("routes the secondary create-and-manage actions", async () => {
    const user = userEvent.setup();
    const handlers = renderActions();

    await user.click(screen.getByTestId("button-log-food"));
    await user.click(await screen.findByTestId("menu-targets"));
    expect(handlers.onTargets).toHaveBeenCalledTimes(1);

    await user.click(screen.getByTestId("button-log-food"));
    await user.click(await screen.findByTestId("menu-custom-food"));
    expect(handlers.onCustomFood).toHaveBeenCalledTimes(1);

    await user.click(screen.getByTestId("button-log-food"));
    await user.click(await screen.findByTestId("menu-recipe"));
    expect(handlers.onRecipe).toHaveBeenCalledTimes(1);
  });

  // CL31 (CODEBASE_ANALYSIS_2026-10-03): the parse lived in the sheet's row, so
  // dismissing the sheet mid-parse dropped the (billed) result on the floor.
  it("still opens the review when a meal parse finishes after the sheet was dismissed", async () => {
    const user = userEvent.setup();
    const parse = deferred<ParseMealResponse>();
    vi.mocked(api.nutrition.parseMealPhoto).mockReturnValue(parse.promise);
    const handlers = renderActions();

    await user.click(screen.getByTestId("button-log-food"));
    await user.click(await screen.findByText("Snap a meal"));
    expect(api.nutrition.parseMealPhoto).toHaveBeenCalledWith("ZmFrZS1pbWFnZQ==", "image/jpeg");

    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByText("Snap a meal")).not.toBeInTheDocument();
    });
    // The always-visible button carries the progress once the row is gone.
    expect(screen.getByTestId("button-log-food")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByTestId("status-photo-parse")).toHaveTextContent("Reading your photo");

    parse.resolve(PARSED);

    await waitFor(() => {
      expect(handlers.onMealParsed).toHaveBeenCalledWith(PARSED);
    });
    expect(screen.getByTestId("button-log-food")).toHaveAttribute("aria-busy", "false");
  });

  it("still prefills the custom food when a label parse finishes after the sheet was dismissed", async () => {
    const user = userEvent.setup();
    const parse = deferred<typeof OAT_BAR_LABEL_SCAN>();
    vi.mocked(api.nutrition.parseLabel).mockReturnValue(parse.promise);
    const handlers = renderActions();

    await user.click(screen.getByTestId("button-log-food"));
    await user.click(await screen.findByText("Scan label"));
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByText("Scan label")).not.toBeInTheDocument();
    });

    parse.resolve(OAT_BAR_LABEL_SCAN);

    await waitFor(() => {
      expect(handlers.onLabelExtracted).toHaveBeenCalledWith(OAT_BAR_LABEL_SCAN);
    });
  });

  it("toasts instead of opening the form when no label was found", async () => {
    const user = userEvent.setup();
    vi.mocked(api.nutrition.parseLabel).mockResolvedValue({ label: null, suggestion: null, warnings: [] });
    const handlers = renderActions();

    await user.click(screen.getByTestId("button-log-food"));
    await user.click(await screen.findByText("Scan label"));

    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ title: "No nutrition label found", variant: "destructive" }),
      );
    });
    expect(handlers.onLabelExtracted).not.toHaveBeenCalled();
    // The sheet stays open for another try.
    expect(screen.getByText("Scan label")).toBeInTheDocument();
  });
});
