import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CoachPrescriptionCollapsible, type PrescriptionField } from "../CoachPrescriptionCollapsible";

const SAVE_DEBOUNCE_MS = 600;

/**
 * Owner that behaves like LogSheet's plan-day wiring: every save lands in the
 * cache optimistically, so the `mainWorkout` prop follows what was saved.
 */
function MirroringOwner({ onSave }: { readonly onSave: (field: PrescriptionField, value: string) => void }) {
  const [mainWorkout, setMainWorkout] = useState("5x500m row");
  return (
    <CoachPrescriptionCollapsible
      mainWorkout={mainWorkout}
      accessory=""
      notes=""
      defaultOpen
      onSaveField={(field, value) => {
        onSave(field, value);
        if (field === "mainWorkout") setMainWorkout(value);
      }}
    />
  );
}

const textarea = () => screen.getByTestId("prescription-textarea-mainWorkout");
const collapse = () => fireEvent.click(screen.getByTestId("coach-prescription-toggle"));

/**
 * CL1 (CODEBASE_ANALYSIS_2026-10-03): the textarea used to flush on unmount
 * from a closure captured at mount, so collapsing the panel (or closing the
 * sheet) after an autosave PATCHed the mount-time text back over the edit.
 */
describe("CoachPrescriptionCollapsible unmount flush", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not write the mount-time text back when collapsed after an autosave", () => {
    const onSave = vi.fn();
    render(<MirroringOwner onSave={onSave} />);

    fireEvent.change(textarea(), { target: { value: "5x500m row @ 2:00" } });
    act(() => {
      vi.advanceTimersByTime(SAVE_DEBOUNCE_MS);
    });
    expect(onSave.mock.calls).toEqual([["mainWorkout", "5x500m row @ 2:00"]]);

    collapse();

    expect(screen.queryByTestId("prescription-textarea-mainWorkout")).not.toBeInTheDocument();
    expect(onSave.mock.calls).toEqual([["mainWorkout", "5x500m row @ 2:00"]]);
  });

  it("flushes only the latest unsaved text when collapsed inside the debounce window", () => {
    const onSave = vi.fn();
    render(<MirroringOwner onSave={onSave} />);

    fireEvent.change(textarea(), { target: { value: "5x500m row @" } });
    fireEvent.change(textarea(), { target: { value: "5x500m row @ 2:05" } });
    collapse();
    act(() => {
      vi.advanceTimersByTime(SAVE_DEBOUNCE_MS);
    });

    expect(onSave.mock.calls).toEqual([["mainWorkout", "5x500m row @ 2:05"]]);
  });

  it("does not revert a blur-saved edit when the editor unmounts", () => {
    // A logged workout's timeline-backed prop never catches up with the save,
    // so the prop stays at the mount-time text throughout.
    const onSave = vi.fn();
    const { unmount } = render(
      <CoachPrescriptionCollapsible
        mainWorkout="Easy 5k"
        accessory=""
        notes=""
        defaultOpen
        onSaveField={onSave}
      />,
    );

    fireEvent.change(textarea(), { target: { value: "Easy 5k, felt good" } });
    fireEvent.blur(textarea());
    expect(onSave.mock.calls).toEqual([["mainWorkout", "Easy 5k, felt good"]]);

    unmount();
    act(() => {
      vi.advanceTimersByTime(SAVE_DEBOUNCE_MS);
    });

    expect(onSave.mock.calls).toEqual([["mainWorkout", "Easy 5k, felt good"]]);
  });
});
