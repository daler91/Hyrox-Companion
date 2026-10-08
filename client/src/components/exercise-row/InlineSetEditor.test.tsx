import type { ExerciseSet } from "@shared/schema";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { InlineSetEditor } from "./InlineSetEditor";

const baseSet = {
  id: "set-1",
  exerciseName: "wall_balls",
  customLabel: null,
  category: "functional",
  setNumber: 1,
  reps: 10,
  weight: 6,
  distance: null,
  time: null,
  notes: null,
  plannedReps: null,
  plannedWeight: null,
  plannedDistance: null,
  plannedTime: null,
} as ExerciseSet;

describe("InlineSetEditor field commit flow", () => {
  it("keeps rapid typing local and commits only the final value on blur", () => {
    const onUpdateSet = vi.fn();
    render(
      <InlineSetEditor
        sets={[baseSet]}
        exerciseName="wall_balls"
        customLabel={null}
        category="functional"
        weightUnit="kg"
        onUpdateSet={onUpdateSet}
        onAddSet={vi.fn()}
        onDeleteSet={vi.fn()}
      />,
    );

    const input = screen.getByTestId("input-reps-set-1");
    fireEvent.change(input, { target: { value: "1" } });
    fireEvent.change(input, { target: { value: "12" } });
    fireEvent.change(input, { target: { value: "123" } });

    expect(input).toHaveValue("123");
    expect(onUpdateSet).not.toHaveBeenCalled();

    fireEvent.blur(input);

    expect(onUpdateSet).toHaveBeenCalledTimes(1);
    expect(onUpdateSet).toHaveBeenCalledWith("set-1", { reps: 123 });
  });

  it("commits the current draft when pressing Enter", () => {
    const onUpdateSet = vi.fn();
    render(
      <InlineSetEditor
        sets={[baseSet]}
        exerciseName="wall_balls"
        customLabel={null}
        category="functional"
        weightUnit="kg"
        onUpdateSet={onUpdateSet}
        onAddSet={vi.fn()}
        onDeleteSet={vi.fn()}
      />,
    );

    const input = screen.getByTestId("input-weight-set-1");
    fireEvent.change(input, { target: { value: "7.5" } });

    expect(onUpdateSet).not.toHaveBeenCalled();

    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    expect(onUpdateSet).toHaveBeenCalledTimes(1);
    expect(onUpdateSet).toHaveBeenCalledWith("set-1", { weight: 7.5 });
  });

  it("does not visually blank during blur reconciliation when external value is temporarily empty", () => {
    const onUpdateSet = vi.fn();
    const { rerender } = render(
      <InlineSetEditor
        sets={[baseSet]}
        exerciseName="wall_balls"
        customLabel={null}
        category="functional"
        weightUnit="kg"
        onUpdateSet={onUpdateSet}
        onAddSet={vi.fn()}
        onDeleteSet={vi.fn()}
      />,
    );

    const input = screen.getByTestId("input-reps-set-1");
    fireEvent.change(input, { target: { value: "42" } });
    fireEvent.blur(input);

    expect(onUpdateSet).toHaveBeenCalledWith("set-1", { reps: 42 });
    expect(input).toHaveValue("42");

    rerender(
      <InlineSetEditor
        sets={[{ ...baseSet, reps: null }]}
        exerciseName="wall_balls"
        customLabel={null}
        category="functional"
        weightUnit="kg"
        onUpdateSet={onUpdateSet}
        onAddSet={vi.fn()}
        onDeleteSet={vi.fn()}
      />,
    );

    expect(screen.getByTestId("input-reps-set-1")).toHaveValue("42");

    rerender(
      <InlineSetEditor
        sets={[{ ...baseSet, reps: 42 }]}
        exerciseName="wall_balls"
        customLabel={null}
        category="functional"
        weightUnit="kg"
        onUpdateSet={onUpdateSet}
        onAddSet={vi.fn()}
        onDeleteSet={vi.fn()}
      />,
    );

    expect(screen.getByTestId("input-reps-set-1")).toHaveValue("42");
  });

  it("displays mile-scale stored feet as miles and patches stored feet on edit", () => {
    const onUpdateSet = vi.fn();
    render(
      <InlineSetEditor
        sets={[{
          ...baseSet,
          exerciseName: "easy_run",
          category: "running",
          reps: null,
          weight: null,
          distance: 15840,
          plannedDistance: 16404,
        }]}
        exerciseName="easy_run"
        customLabel={null}
        category="running"
        weightUnit="lbs"
        distanceUnit="miles"
        onUpdateSet={onUpdateSet}
        onAddSet={vi.fn()}
        onDeleteSet={vi.fn()}
        showPlannedDiffs
      />,
    );

    expect(screen.getByText("Distance")).toBeInTheDocument();
    expect(screen.queryByText("Distance (ft)")).not.toBeInTheDocument();
    expect(screen.getByTestId("input-distance-set-1")).toHaveValue("3");
    expect(screen.getByTestId("unit-distance-set-1")).toHaveTextContent("mi");
    expect(screen.getByTestId("planned-distance-set-1")).toHaveTextContent("planned 5000 m");

    fireEvent.change(screen.getByTestId("input-distance-set-1"), { target: { value: "3.1" } });
    fireEvent.blur(screen.getByTestId("input-distance-set-1"));

    expect(onUpdateSet).toHaveBeenCalledWith("set-1", { distance: 16368 });
  });

  it("does not rewrite rounded mile displays on blur without edits", () => {
    const onUpdateSet = vi.fn();
    render(
      <InlineSetEditor
        sets={[{
          ...baseSet,
          exerciseName: "easy_run",
          category: "running",
          reps: null,
          weight: null,
          distance: 15845,
        }]}
        exerciseName="easy_run"
        customLabel={null}
        category="running"
        weightUnit="lbs"
        distanceUnit="miles"
        onUpdateSet={onUpdateSet}
        onAddSet={vi.fn()}
        onDeleteSet={vi.fn()}
      />,
    );

    const input = screen.getByTestId("input-distance-set-1");
    expect(input).toHaveValue("3");

    fireEvent.blur(input);

    expect(onUpdateSet).not.toHaveBeenCalled();
  });

  it("shows planned distance diffs when stored values round to the same display value", () => {
    render(
      <InlineSetEditor
        sets={[{
          ...baseSet,
          exerciseName: "easy_run",
          category: "running",
          reps: null,
          weight: null,
          distance: 15840,
          plannedDistance: 15845,
        }]}
        exerciseName="easy_run"
        customLabel={null}
        category="running"
        weightUnit="lbs"
        distanceUnit="miles"
        onUpdateSet={vi.fn()}
        onAddSet={vi.fn()}
        onDeleteSet={vi.fn()}
        showPlannedDiffs
      />,
    );

    expect(screen.getByTestId("input-distance-set-1")).toHaveValue("3");
    expect(screen.getByTestId("planned-distance-set-1")).toHaveTextContent("planned 3 mi");
  });

  it("edits a kg-stamped row in pounds for a lb athlete and writes pounds back (finding D2)", () => {
    const onUpdateSet = vi.fn();
    render(
      <InlineSetEditor
        sets={[{
          ...baseSet,
          exerciseName: "back_squat",
          category: "strength",
          reps: 5,
          weight: 100,
          plannedWeight: 90,
          weightUnit: "kg",
        }]}
        exerciseName="back_squat"
        customLabel={null}
        category="strength"
        weightUnit="lbs"
        onUpdateSet={onUpdateSet}
        onAddSet={vi.fn()}
        onDeleteSet={vi.fn()}
        showPlannedDiffs
      />,
    );

    const input = screen.getByTestId("input-weight-set-1");
    expect(input).toHaveValue("220");
    expect(screen.getByTestId("planned-weight-set-1")).toHaveTextContent("planned 198 lbs");

    fireEvent.change(input, { target: { value: "225" } });
    fireEvent.blur(input);

    // The PATCH is in the athlete's unit; the server re-stamps the row as lbs.
    expect(onUpdateSet).toHaveBeenCalledWith("set-1", { weight: 225 });
  });

  it("shows a feet-stamped distance in metres for a km athlete", () => {
    render(
      <InlineSetEditor
        sets={[{
          ...baseSet,
          exerciseName: "easy_run",
          category: "running",
          reps: null,
          weight: null,
          distance: 1312,
          distanceUnit: "ft",
        }]}
        exerciseName="easy_run"
        customLabel={null}
        category="running"
        weightUnit="kg"
        distanceUnit="km"
        onUpdateSet={vi.fn()}
        onAddSet={vi.fn()}
        onDeleteSet={vi.fn()}
      />,
    );

    expect(screen.getByTestId("input-distance-set-1")).toHaveValue("400");
    expect(screen.getByTestId("unit-distance-set-1")).toHaveTextContent("m");
  });
});

/**
 * A cell save is fire-and-forget: the debounced PATCH lands ~350ms later, the
 * mutation patches the cache optimistically, and a failure rolls that patch
 * back. The field has to tell those two "the stored value equals what it was
 * before I typed" moments apart, or a rejected edit sits in the input looking
 * saved.
 */
describe("InlineSetEditor failed-save reconciliation", () => {
  /** Render the row (stored reps: 10), type `reps` into the cell and blur. */
  function typeReps(reps: number) {
    const onUpdateSet = vi.fn();
    const editor = (set: ExerciseSet) => (
      <InlineSetEditor
        sets={[set]}
        exerciseName="wall_balls"
        customLabel={null}
        category="functional"
        weightUnit="kg"
        onUpdateSet={onUpdateSet}
        onAddSet={vi.fn()}
        onDeleteSet={vi.fn()}
      />
    );
    const { rerender } = render(editor(baseSet));
    const input = () => screen.getByTestId("input-reps-set-1");
    fireEvent.change(input(), { target: { value: String(reps) } });
    fireEvent.blur(input());
    return {
      onUpdateSet,
      input,
      /** What the row carries after a cache write — the save, or its rollback. */
      storedRepsBecome: (stored: number) => rerender(editor({ ...baseSet, reps: stored })),
    };
  }

  it("keeps the typed value while the debounced save is still out", () => {
    const { input, storedRepsBecome } = typeReps(42);

    // The PATCH hasn't fired, so the row still carries the pre-edit value.
    // That is not a rollback and must not clear what the athlete typed.
    storedRepsBecome(10);

    expect(input()).toHaveValue("42");
  });

  it("returns to the stored value when the save fails and the optimistic write is rolled back", () => {
    const { onUpdateSet, input, storedRepsBecome } = typeReps(42);
    expect(onUpdateSet).toHaveBeenCalledWith("set-1", { reps: 42 });

    // The mutation patches the cache optimistically...
    storedRepsBecome(42);
    expect(input()).toHaveValue("42");

    // ...then the request fails and the patch is rolled back. 42 was never
    // stored, so the field must stop showing it.
    storedRepsBecome(10);

    expect(input()).toHaveValue("10");
  });

  it("honours another device reverting the value back to what it was before the edit", () => {
    const { input, storedRepsBecome } = typeReps(42);
    storedRepsBecome(42);

    // 42 saved, then the phone sets it back to 10. Comparing against the
    // pre-edit value alone would alias this onto "nothing changed".
    storedRepsBecome(10);

    expect(input()).toHaveValue("10");
  });
});

/**
 * CL7 (CODEBASE_ANALYSIS_2026-10-03): the cell was a `type="number"` input,
 * which reports a decimal comma ("62,5") as "", and the blur then committed
 * that "" as a clear of the stored value while the cell still showed 62,5.
 */
describe("InlineSetEditor number entry", () => {
  function renderEditor(set: ExerciseSet = baseSet) {
    const onUpdateSet = vi.fn();
    render(
      <InlineSetEditor
        sets={[set]}
        exerciseName={set.exerciseName}
        customLabel={null}
        category={set.category}
        weightUnit="kg"
        onUpdateSet={onUpdateSet}
        onAddSet={vi.fn()}
        onDeleteSet={vi.fn()}
      />,
    );
    return onUpdateSet;
  }

  function enter(field: string, value: string) {
    const input = screen.getByTestId(`input-${field}-set-1`);
    fireEvent.change(input, { target: { value } });
    fireEvent.blur(input);
    return input;
  }

  it("saves a decimal comma as a decimal point", () => {
    const onUpdateSet = renderEditor();

    const input = enter("weight", "62,5");

    expect(onUpdateSet).toHaveBeenCalledWith("set-1", { weight: 62.5 });
    expect(input).toHaveValue("62.5");
  });

  it("keeps the stored value instead of clearing it when the entry can't be read", () => {
    const onUpdateSet = renderEditor();

    const input = enter("weight", "6O");

    expect(onUpdateSet).not.toHaveBeenCalled();
    expect(input).toHaveValue("6");
  });

  it("does not guess at a comma that could be a thousands separator", () => {
    const onUpdateSet = renderEditor({
      ...baseSet,
      exerciseName: "skierg",
      category: "functional",
      reps: null,
      weight: null,
      distance: 500,
    });

    // 1 m or 1000 m? Neither is safe to store, so the cell keeps 500.
    const input = enter("distance", "1,000");

    expect(onUpdateSet).not.toHaveBeenCalled();
    expect(input).toHaveValue("500");
  });

  it("keeps the stored reps when the entry is not a whole number of at least one", () => {
    const onUpdateSet = renderEditor();

    expect(enter("reps", "8.5")).toHaveValue("10");
    expect(enter("reps", "-3")).toHaveValue("10");
    expect(onUpdateSet).not.toHaveBeenCalled();
  });

  it("still clears the stored value when the athlete empties the cell", () => {
    const onUpdateSet = renderEditor();

    enter("weight", "");

    expect(onUpdateSet).toHaveBeenCalledWith("set-1", { weight: null });
  });
});

/**
 * CL8 (CODEBASE_ANALYSIS_2026-10-03): LogSheet and ReviewSurface debounce set
 * patches, so `set.notes` does not move while the athlete types. The notes
 * box used to reset itself to that unchanged prop after every keystroke.
 */
describe("InlineSetEditor set notes", () => {
  function editor(set: ExerciseSet, onUpdateSet = vi.fn()) {
    return (
      <InlineSetEditor
        sets={[set]}
        exerciseName="wall_balls"
        customLabel={null}
        category="functional"
        weightUnit="kg"
        onUpdateSet={onUpdateSet}
        onAddSet={vi.fn()}
        onDeleteSet={vi.fn()}
      />
    );
  }

  it("keeps every keystroke while a debounced owner has not saved yet", async () => {
    const user = userEvent.setup();
    const onUpdateSet = vi.fn();
    render(editor(baseSet, onUpdateSet));

    await user.click(screen.getByTestId("button-toggle-note-set-1"));
    const notes = screen.getByTestId("input-notes-set-1");
    await user.type(notes, "felt heavy");

    expect(notes).toHaveValue("felt heavy");
    expect(onUpdateSet).toHaveBeenLastCalledWith("set-1", { notes: "felt heavy" });
  });

  it("keeps typing when the debounced save lands mid-sentence", async () => {
    const user = userEvent.setup();
    const onUpdateSet = vi.fn();
    const { rerender } = render(editor(baseSet, onUpdateSet));

    await user.click(screen.getByTestId("button-toggle-note-set-1"));
    const notes = screen.getByTestId("input-notes-set-1");
    await user.type(notes, "felt");
    // The debounce fires and the cache takes "felt" while the athlete is
    // still typing the rest of the note.
    await user.type(notes, " hea");
    rerender(editor({ ...baseSet, notes: "felt" }, onUpdateSet));
    await user.type(notes, "vy");

    expect(notes).toHaveValue("felt heavy");
    expect(onUpdateSet).toHaveBeenLastCalledWith("set-1", { notes: "felt heavy" });
  });

  it("adopts a note changed elsewhere while the athlete is not editing it", () => {
    const { rerender } = render(editor({ ...baseSet, notes: "first" }));
    expect(screen.getByTestId("input-notes-set-1")).toHaveValue("first");

    rerender(editor({ ...baseSet, notes: "from the phone" }));

    expect(screen.getByTestId("input-notes-set-1")).toHaveValue("from the phone");
  });
});

// U13 (CODEBASE_ANALYSIS_2026-10-03): four per-set fields needed 340px+ in one
// fixed column each, pushing the note and remove buttons off a 260-290px sheet.
describe("InlineSetEditor narrow layout", () => {
  function renderFourFields() {
    render(
      <InlineSetEditor
        sets={[{ ...baseSet, exerciseName: "walking_lunges", category: "conditioning" }]}
        exerciseName="walking_lunges"
        customLabel={null}
        category="conditioning"
        weightUnit="kg"
        onUpdateSet={vi.fn()}
        onAddSet={vi.fn()}
        onDeleteSet={vi.fn()}
      />,
    );
  }

  it("puts the fields in one wrapping grid so they flow onto a second line", () => {
    renderFourFields();
    const fieldGrid = screen.getByTestId("input-reps-set-1").closest("[style]");

    expect(fieldGrid).toHaveStyle({
      gridTemplateColumns: "repeat(auto-fit, minmax(min(3.75rem, 100%), 1fr))",
    });
    for (const field of ["distance", "reps", "time", "weight"]) {
      expect(fieldGrid).toContainElement(screen.getByTestId(`input-${field}-set-1`));
    }
    expect(fieldGrid).not.toContainElement(screen.getByTestId("button-remove-set-set-1"));
  });

  it("keeps the note and remove buttons at the 44px mobile touch target", () => {
    renderFourFields();

    for (const testId of ["button-toggle-note-set-1", "button-remove-set-set-1"]) {
      const button = screen.getByTestId(testId);
      expect(button).toHaveClass("h-11", "w-11");
      expect(button).not.toHaveClass("size-7");
    }
  });
});
