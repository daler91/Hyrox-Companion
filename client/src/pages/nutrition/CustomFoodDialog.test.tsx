import type { Food, ParseLabelResponse } from "@shared/schema";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/api";

import { CustomFoodDialog } from "./CustomFoodDialog";

vi.mock("@/lib/api", () => ({
  api: { nutrition: { createCustomFood: vi.fn(), updateCustomFood: vi.fn() } },
  QUERY_KEYS: { nutritionCustomFoods: ["nutrition", "custom-foods"] },
}));
vi.mock("@/lib/queryClient", () => ({
  queryClient: { invalidateQueries: vi.fn().mockResolvedValue(undefined) },
  humanizeApiError: (e: unknown) => String(e),
  AiBudgetExceededError: class extends Error {},
  RateLimitError: class extends Error {},
}));

const PREFILL: ParseLabelResponse = {
  label: {
    productName: "Oat Bar",
    brand: "Acme",
    servingSizeText: "1 bar (45g)",
    servingSizeG: 45,
    per100g: { calories: 400, protein: 10, carb: 60, fat: 12, fiber: 6 },
    perServing: null,
    basis: "per100g",
    confidence: 90,
  },
  suggestion: {
    name: "Oat Bar",
    brand: "Acme",
    caloriesPer100g: 400,
    proteinPer100g: 10,
    carbPer100g: 60,
    fatPer100g: 12,
    fiberPer100g: 6,
    servingSizeG: 45,
  },
  warnings: ["Energy was printed in kJ and converted to kcal."],
};

function renderDialog(prefill: ParseLabelResponse, onCreated = vi.fn(), onClose = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui: ReactNode = (
    <CustomFoodDialog state={{ mode: "create", prefill }} onClose={onClose} onCreated={onCreated} />
  );
  render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
  return { onCreated, onClose };
}

describe("CustomFoodDialog label prefill", () => {
  beforeEach(() => vi.clearAllMocks());

  it("seeds the form from the scanned label and shows the review banner with warnings", () => {
    renderDialog(PREFILL);

    expect(screen.getByText("Review label")).toBeInTheDocument();
    expect(screen.getByTestId("input-custom-name")).toHaveValue("Oat Bar");
    expect(screen.getByTestId("input-custom-brand")).toHaveValue("Acme");
    expect(screen.getByTestId("input-custom-caloriesPer100g")).toHaveValue(400);
    expect(screen.getByTestId("input-custom-fiberPer100g")).toHaveValue(6);
    expect(screen.getByTestId("input-custom-serving")).toHaveValue(45);
    expect(screen.getByTestId("label-prefill-banner")).toHaveTextContent(
      "Energy was printed in kJ and converted to kcal.",
    );
  });

  it("saves and chains into logging via onCreated on 'Save & log'", async () => {
    const user = userEvent.setup();
    const created = { id: "food-1", name: "Oat Bar" } as Food;
    vi.mocked(api.nutrition.createCustomFood).mockResolvedValue(created);
    const { onCreated, onClose } = renderDialog(PREFILL);

    await user.click(screen.getByTestId("button-save-and-log-custom-food"));

    await waitFor(() =>
      expect(api.nutrition.createCustomFood).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Oat Bar", caloriesPer100g: 400, servingSizeG: 45 }),
      ),
    );
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(created));
    expect(onClose).toHaveBeenCalled();
  });

  it("plain Save persists the food without chaining into logging", async () => {
    const user = userEvent.setup();
    vi.mocked(api.nutrition.createCustomFood).mockResolvedValue({ id: "food-1" } as Food);
    const { onCreated, onClose } = renderDialog(PREFILL);

    await user.click(screen.getByTestId("button-save-custom-food"));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("shows the printed per-serving values read-only when per-100g couldn't be derived", () => {
    renderDialog({
      label: {
        ...PREFILL.label!,
        servingSizeText: "1 bar",
        servingSizeG: null,
        per100g: null,
        perServing: { calories: 200, protein: 10, carb: 5, fat: 15, fiber: null },
        basis: "perServing",
      },
      suggestion: {
        name: "Oat Bar",
        brand: "Acme",
        caloriesPer100g: null,
        proteinPer100g: null,
        carbPer100g: null,
        fatPer100g: null,
        fiberPer100g: null,
        servingSizeG: null,
      },
      warnings: [],
    });

    const block = screen.getByTestId("label-per-serving-values");
    expect(block).toHaveTextContent("Printed per serving (1 bar)");
    expect(block).toHaveTextContent("200 kcal");
    expect(block).toHaveTextContent("10 g protein");
    expect(screen.getByTestId("input-custom-caloriesPer100g")).toHaveValue(null);
  });
});
