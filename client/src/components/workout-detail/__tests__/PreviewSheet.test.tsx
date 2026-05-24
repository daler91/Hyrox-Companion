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
    mobileFullHeight,
    title,
    description,
  }: {
    children: ReactNode;
    mobileFullHeight?: boolean;
    title: ReactNode;
    description?: ReactNode;
  }) => (
    <section data-testid="responsive-sheet" data-mobile-full-height={String(!!mobileFullHeight)}>
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
  EmbeddedWorkoutCoachChat: ({
    backButtonText,
    className,
    isHidden,
    onBack,
  }: {
    backButtonText?: string;
    className?: string;
    isHidden?: boolean;
    onBack: () => void;
  }) => (
    <div
      data-testid="embedded-workout-coach-chat"
      data-panel-view={String((className ?? "").includes("rounded-none"))}
      hidden={isHidden}
    >
      <button type="button" onClick={onBack} data-testid="embedded-workout-coach-chat-back">
        {backButtonText}
      </button>
    </div>
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

  it("renames a future workout title from the sheet header", async () => {
    const user = userEvent.setup();
    const onRenameTitle = vi.fn();

    render(
      <PreviewSheet
        entry={{ ...baseEntry, planDayId: "day-1" }}
        onClose={vi.fn()}
        onRenameTitle={onRenameTitle}
      />,
    );

    await user.click(screen.getByTestId("workout-title-entry-1-edit"));
    await user.clear(screen.getByTestId("workout-title-entry-1-input"));
    await user.type(screen.getByTestId("workout-title-entry-1-input"), "  Future run  ");
    await user.click(screen.getByTestId("workout-title-entry-1-save"));

    expect(onRenameTitle).toHaveBeenCalledWith(
      expect.objectContaining({ id: "entry-1" }),
      "Future run",
    );
  });

  it("shows the mobile coach panel instead of workout details", async () => {
    const user = userEvent.setup();
    viewportState.isMobile = true;
    const onShowWorkoutDetails = vi.fn();

    render(
      <PreviewSheet
        entry={baseEntry}
        onClose={vi.fn()}
        coachChatOpen
        coachChatNonce={1}
        mobileCoachPanelOpen
        onShowWorkoutDetails={onShowWorkoutDetails}
      />,
    );

    expect(screen.getByTestId("preview-details-entry-1")).toHaveAttribute("hidden");
    expect(screen.getByTestId("responsive-sheet")).toHaveAttribute(
      "data-mobile-full-height",
      "true",
    );
    expect(screen.getByTestId("embedded-workout-coach-chat")).not.toHaveAttribute("hidden");
    expect(screen.getByTestId("embedded-workout-coach-chat")).toHaveAttribute(
      "data-panel-view",
      "true",
    );
    expect(screen.getByTestId("embedded-workout-coach-chat-back")).toHaveTextContent(
      "Workout details",
    );

    await user.click(screen.getByTestId("embedded-workout-coach-chat-back"));

    expect(onShowWorkoutDetails).toHaveBeenCalledTimes(1);
  });

  it("keeps the mobile coach chat mounted while showing workout details", async () => {
    const user = userEvent.setup();
    viewportState.isMobile = true;
    const onShowCoachPanel = vi.fn();

    render(
      <PreviewSheet
        entry={baseEntry}
        onClose={vi.fn()}
        coachChatOpen
        coachChatNonce={1}
        mobileCoachPanelOpen={false}
        onShowCoachPanel={onShowCoachPanel}
      />,
    );

    expect(screen.getByTestId("preview-details-entry-1")).not.toHaveAttribute("hidden");
    expect(screen.getByTestId("responsive-sheet")).toHaveAttribute(
      "data-mobile-full-height",
      "false",
    );
    expect(screen.getByTestId("embedded-workout-coach-chat")).toHaveAttribute("hidden");

    await user.click(screen.getByTestId("preview-return-to-coach-entry-1"));

    expect(onShowCoachPanel).toHaveBeenCalledTimes(1);
  });
});
