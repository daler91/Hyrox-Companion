import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { installRadixPointerMocks } from "@/test/support/radixPointerMocks";

import { WorkoutEffortNotes } from "../WorkoutEffortNotes";

installRadixPointerMocks();

describe("WorkoutEffortNotes", () => {
  it("shows the tapped RPE instantly even when the parent prop lags", async () => {
    const onRpeChange = vi.fn();
    // rpe stays null across renders — mirrors ReviewSurface, whose
    // server-bound RPE prop only updates once the PATCH resolves.
    render(
      <WorkoutEffortNotes
        rpe={null}
        onRpeChange={onRpeChange}
        note=""
        onNoteChange={vi.fn()}
      />,
    );

    const user = userEvent.setup();
    await user.click(screen.getByTestId("button-rpe-7"));

    expect(onRpeChange).toHaveBeenCalledWith(7);
    expect(screen.getByTestId("text-rpe-label")).toHaveTextContent("Hard");
  });

  it("adopts the RPE value when the parent prop changes", () => {
    const { rerender } = render(
      <WorkoutEffortNotes
        rpe={null}
        onRpeChange={vi.fn()}
        note=""
        onNoteChange={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("text-rpe-label")).not.toBeInTheDocument();

    rerender(
      <WorkoutEffortNotes
        rpe={5}
        onRpeChange={vi.fn()}
        note=""
        onNoteChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId("text-rpe-label")).toHaveTextContent("Moderate");
  });

  it("fires note changes on every keystroke for local consumers", async () => {
    const onNoteChange = vi.fn();
    render(
      <WorkoutEffortNotes
        rpe={null}
        onRpeChange={vi.fn()}
        note=""
        onNoteChange={onNoteChange}
      />,
    );

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Notes"), "ok");

    expect(onNoteChange).toHaveBeenLastCalledWith("ok");
  });
});
