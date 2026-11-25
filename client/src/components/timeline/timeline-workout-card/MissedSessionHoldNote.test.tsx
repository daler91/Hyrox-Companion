import "@testing-library/jest-dom/vitest";

import type { CoachMissedSessionHold, TimelineEntry } from "@shared/schema";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { describeHoldReason, MissedSessionHoldNote } from "./MissedSessionHoldNote";

const squatHold: CoachMissedSessionHold = {
  kind: "missed",
  date: "2026-10-13",
  changes: [{ exercise: "back_squat", kind: "hold", from: 102.5, to: 100, unit: "kg" }],
};

function entry(overrides: Partial<TimelineEntry> = {}): TimelineEntry {
  return {
    id: "plan-1",
    date: "2026-10-20",
    type: "planned",
    status: "planned",
    focus: "Lower Strength",
    mainWorkout: "A) Back Squat 5x5 @ 100 kg",
    accessory: null,
    notes: null,
    planDayId: "pd-1",
    aiInputsUsed: { missedSessionHold: squatHold },
    ...overrides,
  };
}

describe("MissedSessionHoldNote", () => {
  it("says, without being opened, which missed session the loads were held for and what moved", () => {
    render(<MissedSessionHoldNote entry={entry()} />);

    expect(screen.getByTestId("missed-session-hold-plan-1")).toHaveTextContent(
      "Adjusted after the session you missed on Tue 13 Oct · Back Squat: 102.5 → 100 kg",
    );
  });

  it("names the first few lifts of a long list", () => {
    const changes = ["back_squat", "bench_press", "deadlift", "overhead_press", "bent_over_row"].map(
      (exercise) => ({ exercise, kind: "hold" as const, from: 60, to: 57.5, unit: "kg" }),
    );
    render(<MissedSessionHoldNote entry={entry({ aiInputsUsed: { missedSessionHold: { ...squatHold, changes } } })} />);

    const note = screen.getByTestId("missed-session-hold-plan-1");
    expect(note).toHaveTextContent("Back Squat: 60 → 57.5 kg · Bench Press: 60 → 57.5 kg · Deadlift: 60 → 57.5 kg · and 2 more");
    expect(note).not.toHaveTextContent("Overhead Press");
  });

  it("says nothing on a session with no hold, or one that is no longer to come", () => {
    const { rerender } = render(<MissedSessionHoldNote entry={entry({ aiInputsUsed: { planPhase: "build" } })} />);
    expect(screen.queryByTestId("missed-session-hold-plan-1")).toBeNull();

    rerender(<MissedSessionHoldNote entry={entry({ aiInputsUsed: null })} />);
    expect(screen.queryByTestId("missed-session-hold-plan-1")).toBeNull();

    for (const status of ["completed", "missed", "skipped"] as const) {
      rerender(<MissedSessionHoldNote entry={entry({ status })} />);
      expect(screen.queryByTestId("missed-session-hold-plan-1")).toBeNull();
    }
  });
});

describe("describeHoldReason", () => {
  it("says skipped for a skip", () => {
    expect(describeHoldReason({ ...squatHold, kind: "skipped" })).toBe(
      "Adjusted after the session you skipped on Tue 13 Oct",
    );
  });

  it("never calls a session inside a declared absence a miss", () => {
    const reason = describeHoldReason({ ...squatHold, kind: "excused" });
    expect(reason).toBe("Adjusted for the session not done on Tue 13 Oct");
    expect(reason).not.toMatch(/miss/i);
  });

  it("leaves the day out rather than print a date it cannot read", () => {
    expect(describeHoldReason({ ...squatHold, date: "soon" })).toBe("Adjusted after the session you missed");
  });
});
