import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ResponsiveSheet } from "../responsive-sheet";

const viewportState = vi.hoisted(() => ({ isMobile: true }));

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => viewportState.isMobile,
}));

describe("ResponsiveSheet", () => {
  it("keeps full-height mobile content in a flex column so nested panels can scroll", () => {
    render(
      <ResponsiveSheet
        open
        onOpenChange={vi.fn()}
        title="Workout"
        description="Workout coach"
        mobileFullHeight
      >
        <div>Coach panel body</div>
      </ResponsiveSheet>,
    );

    expect(screen.getByText("Coach panel body").parentElement).toHaveClass(
      "flex",
      "min-h-0",
      "flex-1",
      "flex-col",
      "overflow-hidden",
    );
  });

  describe("swipe to dismiss (phone)", () => {
    const touch = (clientY: number) => ({ pointerType: "touch", button: 0, clientY });

    function renderSheet(onOpenChange = vi.fn(), beforeDismiss?: () => boolean) {
      render(
        <ResponsiveSheet
          open
          onOpenChange={onOpenChange}
          beforeDismiss={beforeDismiss}
          title="Workout"
        >
          <div>Body</div>
        </ResponsiveSheet>,
      );
      return { onOpenChange, grab: screen.getByTestId("sheet-grab-zone") };
    }

    it("closes when the header is dragged down past the threshold", () => {
      const { onOpenChange, grab } = renderSheet();

      fireEvent.pointerDown(grab, touch(100));
      fireEvent.pointerMove(window, { clientY: 200 });
      fireEvent.pointerMove(window, { clientY: 260 });
      fireEvent.pointerUp(window, { clientY: 260 });

      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it("snaps back instead of closing on a short drag", () => {
      const { onOpenChange, grab } = renderSheet();
      const content = screen.getByRole("dialog");

      fireEvent.pointerDown(grab, touch(100));
      fireEvent.pointerMove(window, { clientY: 140 });
      expect(content.style.transform).toBe("translateY(40px)");
      fireEvent.pointerUp(window, { clientY: 140 });

      expect(onOpenChange).not.toHaveBeenCalled();
      expect(content.style.transform).toBe("");
    });

    it("treats a tap on the header as a tap, not a drag", () => {
      const { onOpenChange, grab } = renderSheet();
      const content = screen.getByRole("dialog");

      fireEvent.pointerDown(grab, touch(100));
      fireEvent.pointerMove(window, { clientY: 103 });
      fireEvent.pointerUp(window, { clientY: 103 });

      expect(content.style.transform).toBe("");
      expect(onOpenChange).not.toHaveBeenCalled();
    });

    it("leaves mouse drags alone so desktop-style pointers use the close button", () => {
      const { onOpenChange, grab } = renderSheet();

      fireEvent.pointerDown(grab, { pointerType: "mouse", button: 0, clientY: 100 });
      fireEvent.pointerMove(window, { clientY: 400 });
      fireEvent.pointerUp(window, { clientY: 400 });

      expect(onOpenChange).not.toHaveBeenCalled();
    });

    // U2 (CODEBASE_ANALYSIS_2026-10-03): a sheet holding unsaved input vetoes
    // the dismissal to ask first; the dragged sheet must not stay half-down.
    it("stays open and snaps back when beforeDismiss vetoes the swipe", () => {
      const beforeDismiss = vi.fn(() => false);
      const { onOpenChange, grab } = renderSheet(vi.fn(), beforeDismiss);
      const content = screen.getByRole("dialog");

      fireEvent.pointerDown(grab, touch(100));
      fireEvent.pointerMove(window, { clientY: 260 });
      fireEvent.pointerUp(window, { clientY: 260 });

      expect(beforeDismiss).toHaveBeenCalledTimes(1);
      expect(onOpenChange).not.toHaveBeenCalled();
      expect(content.style.transform).toBe("");
    });

    it("closes on the swipe when beforeDismiss allows it", () => {
      const beforeDismiss = vi.fn(() => true);
      const { onOpenChange, grab } = renderSheet(vi.fn(), beforeDismiss);

      fireEvent.pointerDown(grab, touch(100));
      fireEvent.pointerMove(window, { clientY: 260 });
      fireEvent.pointerUp(window, { clientY: 260 });

      expect(beforeDismiss).toHaveBeenCalledTimes(1);
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  describe.each([
    ["phone sheet", true],
    ["desktop dialog", false],
  ])("beforeDismiss on the %s", (_label, isMobile) => {
    afterEach(() => {
      viewportState.isMobile = true;
    });

    function renderGuarded(beforeDismiss: () => boolean) {
      viewportState.isMobile = isMobile;
      const onOpenChange = vi.fn();
      render(
        <ResponsiveSheet
          open
          onOpenChange={onOpenChange}
          beforeDismiss={beforeDismiss}
          title="Workout"
        >
          <div>Body</div>
        </ResponsiveSheet>,
      );
      return onOpenChange;
    }

    it("keeps the sheet open when it vetoes Escape", () => {
      const beforeDismiss = vi.fn(() => false);
      const onOpenChange = renderGuarded(beforeDismiss);

      fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

      expect(beforeDismiss).toHaveBeenCalledTimes(1);
      expect(onOpenChange).not.toHaveBeenCalled();
    });

    it("keeps the sheet open when it vetoes the close button", () => {
      const beforeDismiss = vi.fn(() => false);
      const onOpenChange = renderGuarded(beforeDismiss);

      fireEvent.click(screen.getByRole("button", { name: /close/i }));

      expect(beforeDismiss).toHaveBeenCalledTimes(1);
      expect(onOpenChange).not.toHaveBeenCalled();
    });

    it("closes on Escape when it allows the dismissal", () => {
      const onOpenChange = renderGuarded(() => true);

      fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });
});
