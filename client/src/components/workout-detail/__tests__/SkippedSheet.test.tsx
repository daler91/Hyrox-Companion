import type { TimelineEntry } from "@shared/schema";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, it, vi } from "vitest";

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

    await renameWorkoutTitleFromHeader("workout-title-entry-1", "  Skipped engine  ");

    expectWorkoutTitleRename(onRenameTitle, "entry-1", "Skipped engine");
  });
});
