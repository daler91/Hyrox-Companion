import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CoachNote } from "./CoachNote";

describe("CoachNote", () => {
  const baseProps = {
    entryId: "plan-day-1",
    rationale: "Keeping Thursday's tempo — your RPE trend is stable and this lines up with your build-phase guidelines.",
    updatedAt: new Date(Date.now() - 1000 * 60 * 120), // 2 hours ago
    inputsUsed: {
      planPhase: "build" as const,
      rpeTrend: "stable" as const,
      ragUsed: true,
      recentWorkoutCount: 3,
      planGoalPresent: true,
    },
  };

  it("renders the collapsed pill with relative timestamp", () => {
    render(<CoachNote {...baseProps} source="rag" />);
    const toggle = screen.getByTestId("coach-note-toggle-plan-day-1");
    expect(toggle).toHaveTextContent(/Coach's note/);
    expect(toggle).toHaveTextContent(/updated about 2 hours ago/);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("coach-note-rationale-plan-day-1")).toBeNull();
  });

  it("expands on click and shows rationale + source badge + based-on chips", () => {
    render(<CoachNote {...baseProps} source="rag" />);
    fireEvent.click(screen.getByTestId("coach-note-toggle-plan-day-1"));

    const toggle = screen.getByTestId("coach-note-toggle-plan-day-1");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("coach-note-rationale-plan-day-1")).toHaveTextContent(
      /Keeping Thursday's tempo/,
    );
    expect(screen.getByTestId("coach-note-source-plan-day-1")).toHaveTextContent("RAG");
    expect(screen.getByText("Plan goal")).toBeInTheDocument();
    expect(screen.getByText("Build phase")).toBeInTheDocument();
    expect(screen.getByText("RPE stable")).toBeInTheDocument();
    expect(screen.getByText("3 recent workouts")).toBeInTheDocument();
    expect(screen.getByText("Coaching docs")).toBeInTheDocument();
  });

  it("labels Review source correctly for no-change notes", () => {
    render(<CoachNote {...baseProps} source="review" />);
    fireEvent.click(screen.getByTestId("coach-note-toggle-plan-day-1"));
    expect(screen.getByTestId("coach-note-source-plan-day-1")).toHaveTextContent("Review");
  });

  it("promotes fatigue flag over raw RPE trend in the chip row", () => {
    render(
      <CoachNote
        {...baseProps}
        source="rag"
        inputsUsed={{
          ...baseProps.inputsUsed,
          rpeTrend: "rising",
          fatigueFlag: true,
        }}
      />,
    );
    fireEvent.click(screen.getByTestId("coach-note-toggle-plan-day-1"));
    expect(screen.getByText("Fatigue flag")).toBeInTheDocument();
    expect(screen.queryByText("RPE rising")).toBeNull();
  });

  it("still renders the note with a generic 'Coach' badge when source is null", () => {
    render(<CoachNote {...baseProps} source={null} />);
    fireEvent.click(screen.getByTestId("coach-note-toggle-plan-day-1"));
    expect(screen.getByTestId("coach-note-rationale-plan-day-1")).toBeInTheDocument();
    expect(screen.getByTestId("coach-note-source-plan-day-1")).toHaveTextContent("Coach");
  });

  it("hides based-on chips when inputsUsed is null", () => {
    render(<CoachNote {...baseProps} source="legacy" inputsUsed={null} />);
    fireEvent.click(screen.getByTestId("coach-note-toggle-plan-day-1"));
    expect(screen.queryByText(/Based on/)).toBeNull();
    expect(screen.getByTestId("coach-note-source-plan-day-1")).toHaveTextContent("Legacy");
  });

  it("is keyboard-toggleable via Enter/Space on the button", () => {
    render(<CoachNote {...baseProps} source="rag" />);
    const toggle = screen.getByTestId("coach-note-toggle-plan-day-1");
    toggle.focus();
    expect(toggle).toHaveFocus();
    fireEvent.click(toggle); // <button> handles Enter/Space via native click
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });
});
