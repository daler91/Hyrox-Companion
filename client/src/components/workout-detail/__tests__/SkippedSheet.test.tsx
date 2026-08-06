import type { TimelineEntry } from "@shared/schema";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { SkippedSheet } from "../SkippedSheet";
import {
  expectWorkoutTitleRename,
  renameWorkoutTitleFromHeader,
} from "./workoutTitleTestHelpers";

vi.mock("@/components/ui/responsive-sheet", () => ({
  ResponsiveSheet: ({ children, title }: { children: ReactNode; title: ReactNode }) => (
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
    const onRenameTitle = vi.fn();

    render(
      <SkippedSheet
        entry={skippedEntry}
        onClose={vi.fn()}
        onRenameTitle={onRenameTitle}
      />,
    );

    renameWorkoutTitleFromHeader("workout-title-entry-1", "  Skipped engine  ");

    expectWorkoutTitleRename(onRenameTitle, "entry-1", "Skipped engine");
  });

  it("hides the delete action when no onDelete handler is wired up", () => {
    render(<SkippedSheet entry={skippedEntry} onClose={vi.fn()} />);

    expect(screen.queryByTestId("skipped-delete-entry-1")).not.toBeInTheDocument();
  });

  it("asks for confirmation before deleting, and deletes on confirm", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();

    render(<SkippedSheet entry={skippedEntry} onClose={vi.fn()} onDelete={onDelete} />);

    await user.click(screen.getByTestId("skipped-delete-entry-1"));
    // The click only opens the dialog — it must not delete right away.
    expect(onDelete).not.toHaveBeenCalled();
    expect(await screen.findByTestId("skipped-confirm-delete-entry-1")).toBeInTheDocument();

    await user.click(screen.getByTestId("skipped-confirm-delete-entry-1"));

    expect(onDelete).toHaveBeenCalledWith(skippedEntry);
  });

  it("closes the dialog without deleting when cancelled", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();

    render(<SkippedSheet entry={skippedEntry} onClose={vi.fn()} onDelete={onDelete} />);

    await user.click(screen.getByTestId("skipped-delete-entry-1"));
    await user.click(await screen.findByTestId("skipped-cancel-delete-entry-1"));

    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.queryByTestId("skipped-confirm-delete-entry-1")).not.toBeInTheDocument();
  });
});
