import type { EnergyBalanceSummary } from "@shared/schema";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { EnergyBalanceCard } from "./EnergyBalanceCard";

function makeEnergy(overrides: Partial<EnergyBalanceSummary> = {}): EnergyBalanceSummary {
  return {
    inKcal: 2500,
    outKcal: 2676,
    balanceKcal: -176,
    bmrKcal: 1730,
    activeKcal: 600,
    basis: "measured",
    reasonCodes: ["measured_active_kcal"],
    explanation: "Energy out = BMR 1730 kcal × 1.2 (daily living) + 600 kcal measured training.",
    ...overrides,
  };
}

describe("EnergyBalanceCard", () => {
  it("shows in/out/balance with the measured-device label", () => {
    render(<EnergyBalanceCard energy={makeEnergy()} />);

    expect(screen.getByTestId("energy-in")).toHaveTextContent("2500");
    expect(screen.getByTestId("energy-out")).toHaveTextContent("2676");
    expect(screen.getByTestId("energy-balance")).toHaveTextContent("-176");
    expect(screen.getByTestId("energy-basis")).toHaveTextContent(
      "Training burn measured by your device",
    );
  });

  it("labels the static fallback as estimated and signs a surplus", () => {
    render(
      <EnergyBalanceCard
        energy={makeEnergy({ basis: "estimated", outKcal: 2682, balanceKcal: 120 })}
      />,
    );

    expect(screen.getByTestId("energy-basis")).toHaveTextContent(
      "Estimated from your activity level",
    );
    expect(screen.getByTestId("energy-balance")).toHaveTextContent("+120");
  });

  it("renders nothing when the server omitted the energy block", () => {
    render(<EnergyBalanceCard energy={null} />);

    expect(screen.queryByTestId("energy-balance-card")).not.toBeInTheDocument();
  });
});
