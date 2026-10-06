import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { TimelineCoachPanels } from "../TimelineCoachPanels";

vi.mock("@/components/CoachPanel", () => ({
  CoachPanel: ({ onClose }: { readonly onClose: () => void }) => (
    <div data-testid="coach-panel-body">
      <button type="button" onClick={onClose}>
        Close coach panel
      </button>
      <textarea aria-label="Message the coach" />
    </div>
  ),
}));

vi.mock("@/components/coach/AIConsentDialog", () => ({
  AIConsentDialog: () => null,
}));

interface RenderOptions {
  readonly coachOpen?: boolean;
  readonly isMobile?: boolean;
  readonly isWorkoutSurfaceOpen?: boolean;
}

/** The timeline behind the panel, with the FAB that opened it. */
function renderPanels(options: RenderOptions = {}) {
  const onCoachClose = vi.fn();
  const returnFocusRef = createRef<HTMLButtonElement>();
  const props = {
    coachOpen: options.coachOpen ?? true,
    isMobile: options.isMobile ?? true,
    isWorkoutSurfaceOpen: options.isWorkoutSurfaceOpen ?? false,
    timelineData: [],
    isNewUser: false,
    onCoachClose,
    returnFocusRef,
    showAIConsent: false,
    onAIConsentAccept: vi.fn(),
    onAIConsentDecline: vi.fn(),
  };
  const ui = (overrides: RenderOptions = {}) => (
    <>
      <button type="button" ref={returnFocusRef} data-testid="coach-fab">
        AI Coach
      </button>
      <button type="button">Timeline card</button>
      <TimelineCoachPanels {...props} {...overrides} />
    </>
  );
  const utils = render(ui());
  return {
    ...utils,
    onCoachClose,
    returnFocusRef,
    rerenderWith: (o: RenderOptions) => {
      utils.rerender(ui(o));
    },
  };
}

/** Whether keyboard focus is somewhere inside `container`. */
function holdsFocus(container: Element): boolean {
  return container.contains(document.activeElement);
}

describe("TimelineCoachPanels mobile overlay (U4)", () => {
  it("is announced as a modal dialog named for the coach", async () => {
    renderPanels();

    const dialog = screen.getByRole("dialog", { name: "AI Coach" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toContainElement(await screen.findByTestId("coach-panel-body"));
    expect(dialog).toHaveAttribute("id", "coach-panel");
  });

  it("moves focus into the panel when it opens", async () => {
    renderPanels();

    await waitFor(() => {
      expect(holdsFocus(screen.getByRole("dialog", { name: "AI Coach" }))).toBe(true);
    });
  });

  it("keeps Tab inside the panel instead of reaching the timeline behind it", async () => {
    const user = userEvent.setup();
    renderPanels();
    const dialog = screen.getByRole("dialog", { name: "AI Coach" });
    await waitFor(() => {
      expect(holdsFocus(dialog)).toBe(true);
    });

    for (let i = 0; i < 4; i += 1) {
      await user.tab();
      expect(holdsFocus(dialog)).toBe(true);
    }
  });

  it("hides the timeline behind it from assistive tech", () => {
    renderPanels();

    expect(screen.queryByRole("button", { name: "Timeline card" })).not.toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    const { onCoachClose } = renderPanels();
    await waitFor(() => {
      expect(holdsFocus(screen.getByRole("dialog", { name: "AI Coach" }))).toBe(true);
    });

    await user.keyboard("{Escape}");

    expect(onCoachClose).toHaveBeenCalled();
  });

  it("returns focus to the FAB when it closes", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { rerenderWith, returnFocusRef } = renderPanels();
      await waitFor(() => {
        expect(holdsFocus(screen.getByRole("dialog", { name: "AI Coach" }))).toBe(true);
      });

      rerenderWith({ coachOpen: false });
      // Radix hands focus back on the tick after the content unmounts.
      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(document.activeElement).toBe(returnFocusRef.current);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stays mounted but hidden while a workout surface is open, so a chat stream survives", async () => {
    const { rerenderWith } = renderPanels();
    const body = await screen.findByTestId("coach-panel-body");

    rerenderWith({ isWorkoutSurfaceOpen: true });

    expect(screen.getByTestId("coach-panel-body")).toBe(body);
    expect(screen.getByTestId("coach-panel-mobile-sheet")).toHaveClass("hidden");
  });

  it("keeps the desktop side panel a plain landmark-free column", async () => {
    renderPanels({ isMobile: false });

    expect(await screen.findByTestId("coach-panel-body")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

