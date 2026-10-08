import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import FloatingActionButton from "../FloatingActionButton";

// U18 (CODEBASE_ANALYSIS_2026-10-03): the FAB declared aria-controls="coach-panel"
// while no element had that id. TimelineCoachPanels gives the open panel that
// id (asserted in TimelineCoachPanels.test.tsx), so the FAB points at it only
// while the panel is open.
describe("FloatingActionButton coach toggle", () => {
  it("does not reference the coach panel while it is closed", () => {
    render(
      <FloatingActionButton
        coachPanelOpen={false}
        onCoachToggle={vi.fn()}
        onLogWorkout={vi.fn()}
      />,
    );

    const fab = screen.getByTestId("button-coach-fab");
    expect(fab).toHaveAttribute("aria-expanded", "false");
    expect(fab).not.toHaveAttribute("aria-controls");
  });

  it("points at the open coach panel", () => {
    render(<FloatingActionButton coachPanelOpen onCoachToggle={vi.fn()} onLogWorkout={vi.fn()} />);

    const fab = screen.getByTestId("button-coach-fab");
    expect(fab).toHaveAttribute("aria-expanded", "true");
    expect(fab).toHaveAttribute("aria-controls", "coach-panel");
  });
});
