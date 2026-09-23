import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ScheduleStep } from "../ScheduleStep";

describe("ScheduleStep", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 23, 12)); // Wednesday 23 Sep 2026
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("states the start and adds no note for a Monday", () => {
    render(<ScheduleStep startDate={new Date(2026, 8, 28)} onStartDateChange={vi.fn()} />);
    expect(screen.getByText("Your plan will start on Monday, September 28, 2026")).toBeInTheDocument();
    expect(screen.queryByTestId("text-week-one-note")).not.toBeInTheDocument();
  });

  // Sessions are never placed before the start (onboarding audit C3), so a
  // midweek pick says which week-1 sessions it leaves off.
  it("says what a midweek start leaves off the calendar", () => {
    render(<ScheduleStep startDate={new Date(2026, 8, 24)} onStartDateChange={vi.fn()} />);
    expect(screen.getByTestId("text-week-one-note")).toHaveTextContent(
      "starting on a Thursday leaves week 1's Monday to Wednesday sessions off your calendar",
    );
  });

  it("lets today be chosen but not yesterday (audit L1)", () => {
    render(<ScheduleStep startDate={new Date(2026, 8, 24)} onStartDateChange={vi.fn()} />);
    const day = (n: number) =>
      screen
        .getAllByRole("button")
        .find((button) => button.closest("td")?.getAttribute("data-day") === `2026-09-${n}`);
    expect(day(23)).toBeEnabled();
    expect(day(22)).toBeDisabled();
  });
});
