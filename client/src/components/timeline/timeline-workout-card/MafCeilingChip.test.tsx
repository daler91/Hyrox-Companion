import type { ExerciseSet, TimelineEntry } from "@shared/schema";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAuth } from "@/hooks/useAuth";

import { MafCeilingChip } from "./MafCeilingChip";

vi.mock("@/hooks/useAuth", () => ({ useAuth: vi.fn() }));

type AuthUser = { trainingStyleId?: string | null; mafHr?: number | null };

function mockUser(user: AuthUser | null) {
  vi.mocked(useAuth).mockReturnValue({ user } as ReturnType<typeof useAuth>);
}

function setOf(exerciseName: string): ExerciseSet {
  return { id: `set-${exerciseName}`, exerciseName, setNumber: 1 } as ExerciseSet;
}

function makeEntry(over: Partial<TimelineEntry> = {}): TimelineEntry {
  return {
    id: "entry-1",
    date: "2026-06-10",
    type: "planned",
    status: "planned",
    focus: "Easy aerobic",
    mainWorkout: "40 min easy",
    accessory: null,
    notes: null,
    planDayId: "day-1",
    exerciseSets: [setOf("easy_run")],
    ...over,
  };
}

describe("MafCeilingChip", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser({ trainingStyleId: "maf_method", mafHr: 145 });
  });

  it("shows the ceiling on a planned running session", () => {
    render(<MafCeilingChip entry={makeEntry()} />);
    expect(screen.getByTestId("maf-ceiling-chip-entry-1")).toHaveTextContent("MAF ceiling 145 bpm");
  });

  it("stays a focusable button whose name carries the whole explanation", () => {
    // The chip shares ExplanationTooltip's trigger with the info-icon callers.
    // Only a real interactive element may take focus (Sonar S6845), and the
    // explanation has to be reachable without a mouse, so both survive the
    // shared component rather than being re-established per caller.
    render(<MafCeilingChip entry={makeEntry()} />);
    const chip = screen.getByTestId("maf-ceiling-chip-entry-1");
    expect(chip.tagName).toBe("BUTTON");
    expect(chip).toHaveAccessibleName(/MAF aerobic ceiling is 145 bpm/);
    // No `subject` prefix: the chip's own text already names the number.
    expect(chip).toHaveAccessibleName(/^Your MAF/);
  });

  it("counts every running exercise, not just the common ones", () => {
    // run_1k was absent from the hard-coded running list this replaced.
    render(<MafCeilingChip entry={makeEntry({ exerciseSets: [setOf("run_1k")] })} />);
    expect(screen.getByTestId("maf-ceiling-chip-entry-1")).toBeInTheDocument();
  });

  it("stays off a session with no running work", () => {
    render(<MafCeilingChip entry={makeEntry({ exerciseSets: [setOf("back_squat")] })} />);
    expect(screen.queryByTestId("maf-ceiling-chip-entry-1")).not.toBeInTheDocument();
  });

  it("stays off when the focus text mentions a run but nothing was parsed", () => {
    // focus is free LLM text; matching on it would put an HR ceiling on
    // whatever the model happened to write.
    render(<MafCeilingChip entry={makeEntry({ focus: "Easy run chat", exerciseSets: [] })} />);
    expect(screen.queryByTestId("maf-ceiling-chip-entry-1")).not.toBeInTheDocument();
  });

  it("stays off for an athlete who doesn't train to MAF", () => {
    mockUser({ trainingStyleId: "balanced_default", mafHr: 145 });
    render(<MafCeilingChip entry={makeEntry()} />);
    expect(screen.queryByTestId("maf-ceiling-chip-entry-1")).not.toBeInTheDocument();
  });

  it("stays off when no ceiling has been computed", () => {
    mockUser({ trainingStyleId: "maf_method", mafHr: null });
    render(<MafCeilingChip entry={makeEntry()} />);
    expect(screen.queryByTestId("maf-ceiling-chip-entry-1")).not.toBeInTheDocument();
  });

  it("stays off when signed out", () => {
    mockUser(null);
    render(<MafCeilingChip entry={makeEntry()} />);
    expect(screen.queryByTestId("maf-ceiling-chip-entry-1")).not.toBeInTheDocument();
  });
});
