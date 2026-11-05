import "@testing-library/jest-dom/vitest";

import type { TrainingOverview } from "@shared/schema";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MuscleHeatMapCard } from "../MuscleHeatMapCard";

type Coverage = TrainingOverview["muscleGroupCoverage"][number];

function makeMuscle(overrides: Partial<Coverage> & Pick<Coverage, "muscle" | "label">): Coverage {
  return {
    bodyRegion: "upper",
    sessionCount: 0,
    totalSets: 0,
    lastTrained: null,
    daysSince: null,
    ...overrides,
  };
}

describe("MuscleHeatMapCard", () => {
  it("shows every heat level as visible text in the legend, not only as a tooltip", () => {
    render(<MuscleHeatMapCard muscles={[makeMuscle({ muscle: "chest", label: "Chest" })]} />);

    for (const label of [
      "No set volume",
      "Light set volume",
      "Moderate set volume",
      "High set volume",
      "Peak set volume",
    ]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(screen.getByText("Less")).toBeInTheDocument();
    expect(screen.getByText("More")).toBeInTheDocument();
  });

  it("scales each tile's heat level against the busiest muscle", () => {
    render(
      <MuscleHeatMapCard
        muscles={[
          makeMuscle({ muscle: "quads", label: "Quads", bodyRegion: "lower", totalSets: 20, sessionCount: 4, daysSince: 1 }),
          makeMuscle({ muscle: "chest", label: "Chest", totalSets: 10, sessionCount: 2, daysSince: 2 }),
          makeMuscle({ muscle: "biceps", label: "Biceps", totalSets: 2, sessionCount: 1, daysSince: 3 }),
          makeMuscle({ muscle: "calves", label: "Calves", bodyRegion: "lower" }),
        ]}
      />,
    );

    expect(within(screen.getByTestId("muscle-tile-quads")).getByText("Peak set volume")).toBeInTheDocument();
    expect(within(screen.getByTestId("muscle-tile-chest")).getByText("Moderate set volume")).toBeInTheDocument();
    expect(within(screen.getByTestId("muscle-tile-biceps")).getByText("Light set volume")).toBeInTheDocument();
    expect(within(screen.getByTestId("muscle-tile-calves")).getByText("No set volume")).toBeInTheDocument();
  });

  it("renders nothing when there is no muscle coverage", () => {
    const { container } = render(<MuscleHeatMapCard muscles={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("groups tiles under their body region headings", () => {
    render(
      <MuscleHeatMapCard
        muscles={[
          makeMuscle({ muscle: "chest", label: "Chest", bodyRegion: "upper", totalSets: 3 }),
          makeMuscle({ muscle: "quads", label: "Quads", bodyRegion: "lower", totalSets: 6 }),
        ]}
      />,
    );
    const grid = screen.getByTestId("muscle-heat-map-grid");
    const upper = within(grid).getByRole("heading", { name: "Upper body" }).closest("section")!;
    const lower = within(grid).getByRole("heading", { name: "Lower body" }).closest("section")!;
    expect(within(upper).getByTestId("muscle-tile-chest")).toBeInTheDocument();
    expect(within(upper).queryByTestId("muscle-tile-quads")).toBeNull();
    expect(within(lower).getByTestId("muscle-tile-quads")).toBeInTheDocument();
  });
});
