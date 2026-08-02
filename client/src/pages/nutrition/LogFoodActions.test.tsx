import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LogFoodActions } from "./LogFoodActions";

// The photo rows carry parse hooks + consent gating of their own (tested in
// their component suites); stub them so this suite exercises the menu only.
vi.mock("./SnapMealButton", () => ({
  SnapMealButton: () => <button type="button">Snap a meal</button>,
}));
vi.mock("./ScanLabelButton", () => ({
  ScanLabelButton: () => <button type="button">Scan label</button>,
}));

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
  render(<LogFoodActions {...handlers} />);
  return handlers;
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
});
