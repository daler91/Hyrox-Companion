import type { NutritionTarget } from "@shared/schema";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/api";

import { TargetsDialog } from "./TargetsDialog";

vi.mock("@/lib/api", () => ({
  api: { nutrition: { setTarget: vi.fn() } },
  QUERY_KEYS: {
    nutritionTargets: ["/api/v1/nutrition/targets"],
    nutritionDayPrefix: ["/api/v1/nutrition/summary"],
    nutritionRangePrefix: ["/api/v1/nutrition/summary-range"],
    nutritionBlockPrefix: ["/api/v1/nutrition/block"],
  },
}));

const CURRENT: NutritionTarget = {
  id: "t1",
  userId: "u1",
  calories: 2000,
  proteinG: 150,
  carbG: null,
  fatG: null,
  periodizationEnabled: false,
  referenceUtss: null,
  carbGramsPerUtss: null,
  recoveryEnabled: false,
  recoveryProteinBumpFrac: null,
  preloadCarbGramsPerUtss: null,
  preloadDaysAhead: null,
  phaseAware: false,
  maxCarbDeltaG: null,
  effectiveFrom: "2026-06-01",
};

function renderDialog(current: NutritionTarget | null, onClose = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui: ReactNode = <TargetsDialog open current={current} onClose={onClose} />;
  render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
  return { onClose };
}

describe("TargetsDialog", () => {
  beforeEach(() => vi.clearAllMocks());

  it("seeds fields from the current target and saves parsed values", async () => {
    const user = userEvent.setup();
    vi.mocked(api.nutrition.setTarget).mockResolvedValue(CURRENT);
    const { onClose } = renderDialog(CURRENT);

    expect(screen.getByTestId("input-target-calories")).toHaveValue(2000);

    await user.clear(screen.getByTestId("input-target-calories"));
    await user.type(screen.getByTestId("input-target-calories"), "2200");
    await user.click(screen.getByTestId("button-save-targets"));

    await waitFor(() => expect(api.nutrition.setTarget).toHaveBeenCalledTimes(1));
    expect(api.nutrition.setTarget).toHaveBeenCalledWith(
      expect.objectContaining({ calories: 2200, proteinG: 150, carbG: null, fatG: null }),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("disables save when no field is set", () => {
    renderDialog(null);
    expect(screen.getByTestId("button-save-targets")).toBeDisabled();
  });

  it("persists the adaptive (recovery + phase) knobs when periodisation is on", async () => {
    const user = userEvent.setup();
    const periodized: NutritionTarget = {
      ...CURRENT,
      carbG: 250,
      periodizationEnabled: true,
      referenceUtss: 50,
      carbGramsPerUtss: 2.5,
      recoveryEnabled: true,
      phaseAware: true,
    };
    vi.mocked(api.nutrition.setTarget).mockResolvedValue(periodized);
    renderDialog(periodized);

    // Both the load and the adaptive toggles seed on from the saved target.
    expect(screen.getByTestId("switch-periodize")).toBeChecked();
    expect(screen.getByTestId("switch-adaptive")).toBeChecked();

    await user.click(screen.getByTestId("button-save-targets"));

    await waitFor(() => expect(api.nutrition.setTarget).toHaveBeenCalledTimes(1));
    expect(api.nutrition.setTarget).toHaveBeenCalledWith(
      expect.objectContaining({
        periodizationEnabled: true,
        recoveryEnabled: true,
        phaseAware: true,
        preloadCarbGramsPerUtss: expect.any(Number),
        preloadDaysAhead: expect.any(Number),
      }),
    );
  });

  // CL33 (CODEBASE_ANALYSIS_2026-10-03): the slope, cap and pre-load derive
  // from the carb baseline, so a new baseline must not copy the old ones.
  it("re-bases the periodisation knobs onto a new carb baseline", async () => {
    const user = userEvent.setup();
    // The defaults for a 400 g baseline at the assumed 50 UTSS reference.
    const periodized: NutritionTarget = {
      ...CURRENT,
      carbG: 400,
      periodizationEnabled: true,
      referenceUtss: 50,
      carbGramsPerUtss: 4,
      recoveryEnabled: true,
      recoveryProteinBumpFrac: 0.15,
      preloadCarbGramsPerUtss: 2,
      preloadDaysAhead: 1,
      phaseAware: true,
      maxCarbDeltaG: 300,
    };
    vi.mocked(api.nutrition.setTarget).mockResolvedValue(periodized);
    renderDialog(periodized);

    await user.clear(screen.getByTestId("input-target-carbG"));
    await user.type(screen.getByTestId("input-target-carbG"), "150");
    await user.click(screen.getByTestId("button-save-targets"));

    await waitFor(() => {
      expect(api.nutrition.setTarget).toHaveBeenCalledTimes(1);
    });
    expect(api.nutrition.setTarget).toHaveBeenCalledWith(
      expect.objectContaining({
        carbG: 150,
        referenceUtss: 50,
        carbGramsPerUtss: 1.5,
        preloadCarbGramsPerUtss: 0.8,
        maxCarbDeltaG: 112.5,
        recoveryProteinBumpFrac: 0.15,
        preloadDaysAhead: 1,
      }),
    );
  });
});
