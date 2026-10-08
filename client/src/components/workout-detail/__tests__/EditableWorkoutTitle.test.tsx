import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

import { EditableWorkoutTitle } from "../EditableWorkoutTitle";

function renderTitle(overrides: Partial<ComponentProps<typeof EditableWorkoutTitle>> = {}) {
  const onSave = vi.fn();
  render(
    <EditableWorkoutTitle
      title="Strength"
      fallbackTitle="Workout"
      onSave={onSave}
      testIdPrefix="title"
      {...overrides}
    />,
  );
  return { onSave };
}

describe("EditableWorkoutTitle", () => {
  it("opens edit mode and saves a trimmed title", () => {
    const { onSave } = renderTitle();

    fireEvent.click(screen.getByTestId("title-edit"));
    const input = screen.getByTestId("title-input");
    fireEvent.change(input, { target: { value: "  Engine day  " } });
    fireEvent.click(screen.getByTestId("title-save"));

    expect(onSave).toHaveBeenCalledWith("Engine day");
    expect(screen.getByTestId("title-text")).toHaveTextContent("Strength");
  });

  it("saves with Enter", async () => {
    const user = userEvent.setup();
    const { onSave } = renderTitle();

    await user.click(screen.getByTestId("title-edit"));
    await user.clear(screen.getByTestId("title-input"));
    await user.type(screen.getByTestId("title-input"), "Tempo{Enter}");

    expect(onSave).toHaveBeenCalledWith("Tempo");
  });

  it("cancels with Escape", async () => {
    const user = userEvent.setup();
    const { onSave } = renderTitle();

    await user.click(screen.getByTestId("title-edit"));
    await user.clear(screen.getByTestId("title-input"));
    await user.type(screen.getByTestId("title-input"), "Changed{Escape}");

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByTestId("title-text")).toHaveTextContent("Strength");
  });

  it("cancels with Escape inside a sheet without closing the sheet (U23)", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const onSave = vi.fn();
    render(
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogTitle>Log workout</DialogTitle>
          <DialogDescription>Sheet around the title editor</DialogDescription>
          <EditableWorkoutTitle
            title="Strength"
            fallbackTitle="Workout"
            onSave={onSave}
            testIdPrefix="title"
          />
        </DialogContent>
      </Dialog>,
    );

    await user.click(screen.getByTestId("title-edit"));
    await user.type(screen.getByTestId("title-input"), "Changed{Escape}");

    expect(onOpenChange).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByTestId("title-text")).toHaveTextContent("Strength");

    // Once the edit is closed, Escape dismisses the sheet as before.
    await user.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("disables save for blank titles", async () => {
    const user = userEvent.setup();
    renderTitle();

    await user.click(screen.getByTestId("title-edit"));
    await user.clear(screen.getByTestId("title-input"));

    expect(screen.getByTestId("title-save")).toHaveAttribute("aria-disabled", "true");
  });

  it("ignores unchanged titles", async () => {
    const user = userEvent.setup();
    const { onSave } = renderTitle();

    await user.click(screen.getByTestId("title-edit"));
    await user.click(screen.getByTestId("title-save"));

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByTestId("title-text")).toHaveTextContent("Strength");
  });

  it("disables controls while saving", async () => {
    const user = userEvent.setup();
    renderTitle({ isSaving: true });

    expect(screen.getByTestId("title-edit")).toHaveAttribute("aria-disabled", "true");
    await user.click(screen.getByTestId("title-edit"));

    expect(screen.queryByTestId("title-input")).not.toBeInTheDocument();
  });
});
