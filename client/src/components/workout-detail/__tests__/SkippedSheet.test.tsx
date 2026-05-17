import type { TimelineEntry } from "@shared/schema";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { SkippedSheet } from "../SkippedSheet";

vi.mock("@/components/ui/responsive-sheet", () => ({
  ResponsiveSheet: ({
    children,
    title,
  }: {
    children: ReactNode;
    title: ReactNode;
  }) => (
    <section>
      <h1>{title}</h1>
      {children}
    </section>
  ),
}));

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));

vi.mock("@/hooks/useUnitPreferences", () => ({
  useUnitPreferences: () => ({ distanceUnit: "m", weightUnit: "kg" }),
}));

vi.mock("../EmbeddedWorkoutCoachChat", () => ({
  buildWorkoutCoachSeedMessage: () => "Seeded coach prompt",
  EmbeddedWorkoutCoachChat: () => <div data-testid="embedded-workout-coach-chat" />,
}));

const skippedEntry = {
  id: "entry-1",
  date: "2026-05-09",
  status: "skipped",
  focus: "Skipped strength",
  mainWorkout: "5x5 squat",
  accessory: null,
  notes: null,
  planDayId: "day-1",
} as TimelineEntry;

describe("SkippedSheet", () => {
  it("renames a skipped workout title from the sheet header", async () => {
    const user = userEvent.setup();
    const onRenameTitle = vi.fn();

    render(
      <SkippedSheet
        entry={skippedEntry}
        onClose={vi.fn()}
        onRenameTitle={onRenameTitle}
      />,
    );

    await user.click(screen.getByTestId("workout-title-entry-1-edit"));
    await user.clear(screen.getByTestId("workout-title-entry-1-input"));
    await user.type(screen.getByTestId("workout-title-entry-1-input"), "  Skipped engine  ");
    await user.click(screen.getByTestId("workout-title-entry-1-save"));

    expect(onRenameTitle).toHaveBeenCalledWith(
      expect.objectContaining({ id: "entry-1" }),
      "Skipped engine",
    );
  });
});
