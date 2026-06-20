import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { HealthMetricsCard } from "./HealthMetricsCard";

describe("HealthMetricsCard", () => {
  it("renders the HR/power inputs with current values", () => {
    render(
      <HealthMetricsCard
        restingHr="48"
        maxHr="190"
        ftp="280"
        onRestingHrChange={vi.fn()}
        onMaxHrChange={vi.fn()}
        onFtpChange={vi.fn()}
      />,
    );

    expect(screen.getByTestId("input-resting-hr")).toHaveValue(48);
    expect(screen.getByTestId("input-max-hr")).toHaveValue(190);
    expect(screen.getByTestId("input-ftp")).toHaveValue(280);
  });

  it("emits raw input strings on change so partial typing is preserved", () => {
    const onRestingHrChange = vi.fn();
    render(
      <HealthMetricsCard
        restingHr=""
        maxHr=""
        ftp=""
        onRestingHrChange={onRestingHrChange}
        onMaxHrChange={vi.fn()}
        onFtpChange={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByTestId("input-resting-hr"), { target: { value: "55" } });
    expect(onRestingHrChange).toHaveBeenCalledWith("55");
  });
});
