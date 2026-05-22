import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AcwrTrendChart } from "./AcwrTrendChart";

describe("AcwrTrendChart", () => {
  it("renders current ACWR status and restriction rationale", () => {
    render(
      <AcwrTrendChart
        trainingLoad={{
          currentUtss: 118,
          acuteAvg: 95,
          chronicAvg: 60,
          acwr: 1.58,
          zone: "danger",
          flaggedVectors: ["posterior_chain"],
          activeRestrictions: [
            {
              id: "posterior_chain_velocity_lock",
              label: "Posterior chain velocity lock",
              severity: "danger",
              expiresOn: "2026-05-23",
              vector: "posterior_chain",
              rationale: "Recent hamstring/glute/back load conflicts with hills.",
            },
          ],
          downshiftRationale: "Recent hamstring/glute/back load conflicts with hills.",
          trend: [{ date: "2026-05-22", utss: 118, acwr: 1.58, zone: "danger" }],
        }}
      />,
    );

    expect(screen.getByTestId("acwr-trend-card")).toHaveTextContent("Training Load Governor");
    expect(screen.getByText("Danger load")).toBeInTheDocument();
    expect(screen.getByText(/UTSS 118 - ACWR 1.58/)).toBeInTheDocument();
    expect(screen.getByText(/Recent hamstring\/glute\/back load/)).toBeInTheDocument();
  });
});
