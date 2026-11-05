import "@testing-library/jest-dom/vitest";

import type { TimelineEntry } from "@shared/schema";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { WorkoutStravaStats } from "../timeline-workout-card/WorkoutStravaStats";

function entry(overrides: Record<string, unknown>): TimelineEntry {
  return {
    id: "e1",
    date: "2026-09-08",
    type: "logged",
    status: "completed",
    focus: "Run",
    mainWorkout: "8 km",
    source: "strava",
    stravaActivityId: "9001",
    ...overrides,
  } as unknown as TimelineEntry;
}

describe("WorkoutStravaStats", () => {
  it("renders nothing for an entry with no Strava link", () => {
    const { container } = render(
      <WorkoutStravaStats entry={entry({ source: "manual", stravaActivityId: null, calories: 300 })} distanceUnit="km" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing for a Strava entry with no device stats", () => {
    const { container } = render(<WorkoutStravaStats entry={entry({})} distanceUnit="km" />);
    expect(container.firstChild).toBeNull();
  });

  it("shows stats on a manual log enriched by a linked Strava activity", () => {
    render(
      <WorkoutStravaStats
        entry={entry({ source: "manual", stravaActivityId: "9002", calories: 420 })}
        distanceUnit="km"
      />,
    );
    expect(screen.getByTestId("text-calories-e1")).toHaveTextContent("420 cal");
  });

  it("renders each present stat and hides absent ones, with decorative icons hidden from AT", () => {
    const { container } = render(
      <WorkoutStravaStats
        entry={entry({ calories: 500, avgWatts: 210, avgCadence: 171.6, sufferScore: 55 })}
        distanceUnit="km"
      />,
    );
    expect(screen.getByTestId("text-calories-e1")).toHaveTextContent("500 cal");
    expect(screen.getByTestId("text-power-e1")).toHaveTextContent("210W");
    expect(screen.getByTestId("text-cadence-e1")).toHaveTextContent("172");
    expect(screen.getByTestId("text-effort-e1")).toHaveTextContent("Effort: 55");
    expect(screen.queryByTestId("text-speed-e1")).toBeNull();
    for (const svg of container.querySelectorAll("svg")) {
      expect(svg).toHaveAttribute("aria-hidden", "true");
    }
  });

  it("omits speed for a non-positive average speed even though it is a device stat", () => {
    render(<WorkoutStravaStats entry={entry({ calories: 100, avgSpeed: -1 })} distanceUnit="km" />);
    expect(screen.getByTestId("text-calories-e1")).toBeInTheDocument();
    expect(screen.queryByTestId("text-speed-e1")).toBeNull();
  });

  it("shows speed when positive", () => {
    render(<WorkoutStravaStats entry={entry({ avgSpeed: 3 })} distanceUnit="km" />);
    expect(screen.getByTestId("text-speed-e1")).toBeInTheDocument();
  });
});
