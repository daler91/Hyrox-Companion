import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CoachPanelStats } from "../CoachPanelStats";

const STATS = {
  workoutsThisWeek: 4,
  completedThisWeek: 2,
  plannedUpcoming: 3,
  completionRate: 75,
  currentStreak: 5,
};

// CL59 (CODEBASE_ANALYSIS_2026-10-03): the counts come from the timeline as
// loaded, under its plan filter, yet screen readers heard an "all-time" rate.
// The rate now covers the last 4 weeks, and says so on screen as well.
describe("CoachPanelStats", () => {
  it("names the timeline shown as the scope of its counts, not all time", () => {
    render(<CoachPanelStats stats={STATS} />);

    expect(
      screen.getByText("75% completion rate over the last 4 weeks on the timeline shown"),
    ).toBeInTheDocument();
    expect(screen.getByText("4 workouts this week on the timeline shown")).toBeInTheDocument();
    expect(screen.getByText("2 completed this week on the timeline shown")).toBeInTheDocument();
    expect(screen.getByText("3 upcoming planned on the timeline shown")).toBeInTheDocument();
    expect(screen.queryByText(/all-time/)).not.toBeInTheDocument();
  });

  it("shows the rate's 4-week window in its visible label", () => {
    render(<CoachPanelStats stats={STATS} />);

    expect(screen.getByText("4wk rate")).toBeInTheDocument();
    expect(screen.getByText("75%")).toBeInTheDocument();
  });

  it("says nothing came due in the window when there is no rate", () => {
    render(<CoachPanelStats stats={{ ...STATS, completionRate: null }} />);

    expect(screen.getByText("—")).toBeInTheDocument();
    expect(
      screen.getByText(
        "No completion rate: nothing came due in the last 4 weeks on the timeline shown",
      ),
    ).toBeInTheDocument();
  });

  it("leaves the server's streak unscoped", () => {
    render(<CoachPanelStats stats={STATS} />);

    expect(screen.getByText("5 day streak")).toBeInTheDocument();
  });
});
