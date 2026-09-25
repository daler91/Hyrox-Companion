import "@testing-library/jest-dom/vitest";

import { bodySystemOverview, legSpikeOverview } from "@shared/bodySystemLoadTestFixtures";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { describe, expect, it } from "vitest";

import { BodySystemLoadCard } from "../BodySystemLoadCard";

describe("BodySystemLoadCard", () => {
  it("leads with the divergence the single load number hides", () => {
    render(<BodySystemLoadCard bodySystemLoad={legSpikeOverview()} />);

    expect(screen.getByTestId("body-system-divergence")).toHaveTextContent(
      "Leg muscle load is at a six-week high (100% above your usual week), while aerobic and running impact loads are normal.",
    );
  });

  it("gives every system its own tile, status and comparison with its usual week", () => {
    render(<BodySystemLoadCard bodySystemLoad={legSpikeOverview()} />);

    const legs = screen.getByTestId("body-system-leg_muscle");
    expect(within(legs).getByText("Leg muscle")).toBeInTheDocument();
    expect(within(legs).getByTestId("body-system-value-leg_muscle")).toHaveTextContent("1,080");
    expect(within(legs).getByText("Very high")).toBeInTheDocument();
    expect(within(legs).getByText("6-week high")).toBeInTheDocument();
    expect(within(legs).getByTestId("body-system-detail-leg_muscle")).toHaveTextContent(
      "+100% vs your usual week (540). Previous peak 540",
    );

    const aerobic = screen.getByTestId("body-system-aerobic");
    expect(within(aerobic).getByText("Normal")).toBeInTheDocument();
    expect(within(aerobic).queryByText("6-week high")).not.toBeInTheDocument();

    expect(
      within(screen.getByTestId("body-system-upper_pull")).getByText("Too little load to compare"),
    ).toBeInTheDocument();
  });

  it("describes each system's six weeks for screen readers", () => {
    render(<BodySystemLoadCard bodySystemLoad={legSpikeOverview()} />);

    expect(screen.getByTestId("body-system-bars-leg_muscle")).toHaveAccessibleName(
      /Leg muscle load over six weeks\. .*This week: 1,080\./,
    );
  });

  it("draws the usual week only where there is one", () => {
    render(
      <BodySystemLoadCard
        bodySystemLoad={bodySystemOverview({
          running_impact: {
            status: "insufficient_data",
            baseline: null,
            ratio: null,
            weekly: [null, null, null, null, 200, 240],
          },
        })}
      />,
    );

    expect(screen.getByTestId("body-system-usual-aerobic")).toBeInTheDocument();
    expect(screen.queryByTestId("body-system-usual-running_impact")).not.toBeInTheDocument();
    expect(
      within(screen.getByTestId("body-system-running_impact")).getByText("Building baseline"),
    ).toBeInTheDocument();
  });

  it("offers every value as a table", async () => {
    const user = userEvent.setup();
    render(<BodySystemLoadCard bodySystemLoad={legSpikeOverview()} />);

    await user.click(screen.getByTestId("body-system-table-toggle"));

    const table = within(screen.getByTestId("body-system-table")).getByRole("table");
    const legsRow = within(table).getByRole("row", { name: /Leg muscle/ });
    expect(legsRow).toHaveTextContent("1,080");
    expect(legsRow).toHaveTextContent("Very high, 6-week high");
    expect(screen.getByTestId("body-system-table-toggle")).toHaveAttribute("aria-expanded", "true");
  });

  it("says when the split rests on estimates or leaves sessions out", () => {
    render(
      <BodySystemLoadCard
        bodySystemLoad={legSpikeOverview({
          sessionCount: 20,
          estimatedSessions: 4,
          unattributedSessions: 1,
          unscoredSessions: 2,
        })}
      />,
    );

    expect(screen.getByText(/4 of 20 sessions had no RPE or duration logged/)).toBeInTheDocument();
    expect(
      screen.getByText("1 session couldn't be split because no exercises were logged."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("2 sessions have no duration or exercises and aren't counted."),
    ).toBeInTheDocument();
  });

  it("shows no headline when every system is within its usual range", () => {
    render(<BodySystemLoadCard bodySystemLoad={bodySystemOverview()} />);

    expect(screen.getByTestId("body-system-load-card")).toBeInTheDocument();
    expect(screen.queryByTestId("body-system-divergence")).not.toBeInTheDocument();
  });

  it("renders nothing until some system carries load", () => {
    const empty = {
      current: 0,
      baseline: null,
      ratio: null,
      previousPeak: null,
      weekly: [null, null, null, null, null, 0],
    };
    const { container } = render(
      <BodySystemLoadCard
        bodySystemLoad={bodySystemOverview({
          aerobic: empty,
          running_impact: empty,
          leg_muscle: empty,
          upper_pull: empty,
        })}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("has no detectable accessibility violations, as tiles or as a table", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <BodySystemLoadCard bodySystemLoad={legSpikeOverview({ estimatedSessions: 2 })} />,
    );
    expect(await axe(container)).toHaveNoViolations();

    await user.click(screen.getByTestId("body-system-table-toggle"));
    expect(await axe(container)).toHaveNoViolations();
  });
});
