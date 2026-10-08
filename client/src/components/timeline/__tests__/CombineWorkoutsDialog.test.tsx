import type { TimelineEntry } from "@shared/schema";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { CombineWorkoutsDialog } from "../combine-workouts-dialog";

function entry(id: string, focus: string, mainWorkout: string): TimelineEntry {
  return {
    id,
    date: "2026-05-01",
    type: "logged",
    status: "completed",
    focus,
    mainWorkout,
    accessory: null,
    notes: null,
    workoutLogId: `wl-${id}`,
    duration: 30,
  };
}

function renderDialog() {
  const onConfirm = vi.fn();
  render(
    <CombineWorkoutsDialog
      open
      onOpenChange={vi.fn()}
      entry1={entry("a", "Manual run", "5 km")}
      entry2={entry("b", "Strava run", "5.1 km")}
      onConfirm={onConfirm}
      isPending={false}
    />,
  );
  return { onConfirm, user: userEvent.setup() };
}

describe("CombineWorkoutsDialog", () => {
  // Radix's radio measures its hidden input; jsdom has no ResizeObserver.
  beforeAll(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      },
    );
  });
  afterAll(() => {
    vi.unstubAllGlobals();
  });

  // U17 (CODEBASE_ANALYSIS_2026-10-03): the three groups share option labels,
  // so each needs its field heading as its accessible name.
  it("names each field's radio group after its heading", () => {
    renderDialog();

    for (const name of ["Focus", "Main Workout", "Notes"]) {
      const group = screen.getByRole("radiogroup", { name });
      expect(within(group).getAllByRole("radio")).toHaveLength(4);
    }
  });

  it("merges with the sources chosen per field", async () => {
    const { onConfirm, user } = renderDialog();

    const focus = screen.getByRole("radiogroup", { name: "Focus" });
    await user.click(within(focus).getByRole("radio", { name: "Workout 2" }));
    await user.click(screen.getByTestId("button-confirm-combine"));

    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ date: "2026-05-01", focus: "Strava run", mainWorkout: "5 km\n---\n5.1 km", duration: 60 }),
    );
  });
});
