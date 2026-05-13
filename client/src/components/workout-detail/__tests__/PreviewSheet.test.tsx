import type { TimelineEntry } from "@shared/schema";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PreviewSheet } from "../PreviewSheet";

const viewportState = vi.hoisted(() => ({ isMobile: false }));

vi.mock("@/components/ui/responsive-sheet", () => ({
  ResponsiveSheet: ({
    children,
    title,
    description,
  }: {
    children: ReactNode;
    title: ReactNode;
    description?: ReactNode;
  }) => (
    <section>
      <h1>{title}</h1>
      {description ? <p>{description}</p> : null}
      {children}
    </section>
  ),
}));

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => viewportState.isMobile,
}));

vi.mock("@/hooks/useUnitPreferences", () => ({
  useUnitPreferences: () => ({ distanceUnit: "m", weightLabel: "kg" }),
}));

vi.mock("../EmbeddedWorkoutCoachChat", () => ({
  buildWorkoutCoachSeedMessage: () => "Seeded coach prompt",
  EmbeddedWorkoutCoachChat: ({ autoScrollIntoView }: { autoScrollIntoView?: boolean }) => (
    <div
      data-testid="embedded-workout-coach-chat"
      data-auto-scroll={String(autoScrollIntoView)}
    />
  ),
}));

const baseEntry = {
  id: "entry-1",
  date: "2026-05-09",
  focus: "Long Run",
  mainWorkout: "Easy Run 10000m",
  accessory: null,
  aiRationale: null,
  exerciseSets: [],
} as unknown as TimelineEntry;

describe("PreviewSheet", () => {
  beforeEach(() => {
    viewportState.isMobile = false;
  });

  it("renders Edit workout and calls the future edit handler", async () => {
    const user = userEvent.setup();
    const onEditWorkout = vi.fn();

    render(<PreviewSheet entry={baseEntry} onClose={vi.fn()} onEditWorkout={onEditWorkout} />);

    expect(screen.queryByText("Log this now")).not.toBeInTheDocument();
    const editButton = screen.getByTestId("preview-edit-workout-entry-1");
    expect(editButton).toHaveTextContent("Edit workout");

    await user.click(editButton);

    expect(onEditWorkout).toHaveBeenCalledWith(baseEntry);
  });

  it("requests auto-scroll for embedded coach chat on mobile", () => {
    viewportState.isMobile = true;

    render(
      <PreviewSheet
        entry={baseEntry}
        onClose={vi.fn()}
        coachChatOpen
        coachChatNonce={1}
      />,
    );

    expect(screen.getByTestId("embedded-workout-coach-chat")).toHaveAttribute(
      "data-auto-scroll",
      "true",
    );
  });
});
