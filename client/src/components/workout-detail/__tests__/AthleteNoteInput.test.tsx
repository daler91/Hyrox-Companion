import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AthleteNoteInput } from "../AthleteNoteInput";

/**
 * The note textarea holds free text the athlete is actively typing, so a
 * prop change must never overwrite an in-progress edit. It used to resync
 * unconditionally from `value`, which meant a failed save — whose rollback
 * reverts the cached workout — silently deleted everything typed since the
 * debounce last fired.
 */
describe("AthleteNoteInput", () => {
  it("keeps an in-progress edit when the upstream value changes under it", async () => {
    const user = userEvent.setup();
    // Starts empty, as a fresh note does.
    const { rerender } = render(<AthleteNoteInput value="" onSave={vi.fn()} mode="form" />);

    const textarea = screen.getByLabelText("Notes");
    await user.type(textarea, "felt strong but the last round was ugly");

    // The debounce fired partway through and the cache took the optimistic
    // value, so the prop now changes to a THIRD string while the athlete is
    // still typing. The unconditional resync adopted it and destroyed the
    // rest of the sentence.
    rerender(<AthleteNoteInput value="felt strong" onSave={vi.fn()} mode="form" />);

    expect(textarea).toHaveValue("felt strong but the last round was ugly");
  });

  it("adopts a new upstream value when the draft is untouched", () => {
    const { rerender } = render(
      <AthleteNoteInput value="first note" onSave={vi.fn()} mode="form" />,
    );
    expect(screen.getByLabelText("Notes")).toHaveValue("first note");

    // Opening the dialog on a different workout must still swap the text.
    rerender(<AthleteNoteInput value="a different workout" onSave={vi.fn()} mode="form" />);

    expect(screen.getByLabelText("Notes")).toHaveValue("a different workout");
  });
});
