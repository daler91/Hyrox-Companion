import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TimelineCoachPanels } from "../TimelineCoachPanels";

// The coach module arrives only when the test opens this gate, so the loading
// state can be seen. The tests share one module load and run in order, so the
// suite opts out of shuffling: the closed-panel test must run before any test
// that opens the panel and loads the module.
const gate = vi.hoisted(() => {
  const handlers: { release?: () => void } = {};
  const released = new Promise<void>((resolve) => {
    handlers.release = resolve;
  });
  return { released, handlers, loads: { count: 0 } };
});

vi.mock("@/components/CoachPanel", async () => {
  gate.loads.count += 1;
  await gate.released;
  return {
    CoachPanel: () => (
      <div data-testid="coach-panel-body">
        <textarea aria-label="Message the coach" />
      </div>
    ),
  };
});

vi.mock("@/components/coach/AIConsentDialog", () => ({
  AIConsentDialog: () => null,
}));

function renderPanels(coachOpen: boolean) {
  render(
    <TimelineCoachPanels
      coachOpen={coachOpen}
      isMobile
      isWorkoutSurfaceOpen={false}
      timelineData={[]}
      isNewUser={false}
      onCoachClose={vi.fn()}
      showAIConsent={false}
      onAIConsentAccept={vi.fn()}
      onAIConsentDecline={vi.fn()}
    />,
  );
}

// PF8 (CODEBASE_ANALYSIS_2026-10-03): the Timeline chunk loaded CoachPanel,
// and the markdown stack with it, although the panel starts closed.
describe("TimelineCoachPanels lazy coach panel (PF8)", { shuffle: false }, () => {
  it("loads no coach code while the panel is closed", () => {
    renderPanels(false);

    expect(gate.loads.count).toBe(0);
  });

  it("opens as a focused dialog with a loading state, then shows the coach", async () => {
    renderPanels(true);

    const dialog = screen.getByRole("dialog", { name: "AI Coach" });
    expect(dialog).toContainElement(screen.getByRole("status"));
    expect(screen.getByRole("status")).toHaveTextContent("Loading the coach");
    await waitFor(() => {
      expect(dialog.contains(document.activeElement)).toBe(true);
    });

    await act(async () => {
      gate.handlers.release?.();
      await gate.released;
    });

    expect(await screen.findByTestId("coach-panel-body")).toBeInTheDocument();
    expect(screen.queryByText("Loading the coach")).not.toBeInTheDocument();
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(gate.loads.count).toBe(1);
  });
});
