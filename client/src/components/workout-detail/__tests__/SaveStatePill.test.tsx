import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SaveStatePill } from "../SaveStatePill";

describe("SaveStatePill", () => {
  it("shows the saving state while a write is in flight", () => {
    render(<SaveStatePill state={{ isSaving: true, lastSavedAt: null }} />);
    const pill = screen.getByTestId("save-state-pill");
    expect(pill).toHaveAttribute("data-state", "saving");
    expect(pill).toHaveTextContent("Saving");
  });

  it("shows the saved flash after a successful save", () => {
    render(<SaveStatePill state={{ isSaving: false, lastSavedAt: 1000 }} />);
    const pill = screen.getByTestId("save-state-pill");
    expect(pill).toHaveAttribute("data-state", "saved");
    expect(pill).toHaveTextContent("Saved");
  });

  it("shows an assertive error when the latest save failed", () => {
    render(
      <SaveStatePill state={{ isSaving: false, lastSavedAt: 1000, lastSaveErrorAt: 2000 }} />,
    );
    const pill = screen.getByTestId("save-state-pill");
    expect(pill).toHaveAttribute("data-state", "error");
    expect(pill).toHaveAttribute("aria-live", "assertive");
    expect(pill).toHaveTextContent("Couldn't save");
  });

  it("surfaces the error even when nothing has saved yet", () => {
    render(<SaveStatePill state={{ isSaving: false, lastSavedAt: null, lastSaveErrorAt: 500 }} />);
    expect(screen.getByTestId("save-state-pill")).toHaveAttribute("data-state", "error");
  });

  it("clears the error once a newer save succeeds", () => {
    render(
      <SaveStatePill state={{ isSaving: false, lastSavedAt: 3000, lastSaveErrorAt: 2000 }} />,
    );
    expect(screen.getByTestId("save-state-pill")).toHaveAttribute("data-state", "saved");
  });

  it("prefers the in-flight saving state over a prior error", () => {
    render(
      <SaveStatePill state={{ isSaving: true, lastSavedAt: 1000, lastSaveErrorAt: 2000 }} />,
    );
    expect(screen.getByTestId("save-state-pill")).toHaveAttribute("data-state", "saving");
  });

  it("renders nothing when idle with no save history", () => {
    render(<SaveStatePill state={{ isSaving: false, lastSavedAt: null }} />);
    expect(screen.queryByTestId("save-state-pill")).toBeNull();
  });
});
