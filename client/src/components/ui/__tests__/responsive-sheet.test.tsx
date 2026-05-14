import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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
});
