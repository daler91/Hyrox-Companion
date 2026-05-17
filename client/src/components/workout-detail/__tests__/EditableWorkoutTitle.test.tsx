import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

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
  it("opens edit mode and saves a trimmed title", async () => {
    const user = userEvent.setup();
    const { onSave } = renderTitle();

    await user.click(screen.getByTestId("title-edit"));
    const input = screen.getByTestId("title-input");
    await user.clear(input);
    await user.type(input, "  Engine day  ");
    await user.click(screen.getByTestId("title-save"));

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

  it("disables save for blank titles", async () => {
    const user = userEvent.setup();
    renderTitle();

    await user.click(screen.getByTestId("title-edit"));
    await user.clear(screen.getByTestId("title-input"));

    expect(screen.getByTestId("title-save")).toBeDisabled();
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

    expect(screen.getByTestId("title-edit")).toBeDisabled();
    await user.click(screen.getByTestId("title-edit"));

    expect(screen.queryByTestId("title-input")).not.toBeInTheDocument();
  });
});
