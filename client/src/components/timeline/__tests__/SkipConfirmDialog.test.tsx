import type { TimelineEntry } from "@shared/schema";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMockTimelineEntry } from "../../../../../test/factories";
import SkipConfirmDialog from "../SkipConfirmDialog";

function makeEntry(overrides: Partial<TimelineEntry> = {}): TimelineEntry {
  return createMockTimelineEntry({
    planDayId: "pd-1",
    status: "planned",
    focus: "Threshold intervals",
    ...overrides,
  });
}

describe("SkipConfirmDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips with no reason when the athlete just confirms", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <SkipConfirmDialog entry={makeEntry()} onOpenChange={vi.fn()} onConfirm={onConfirm} />,
    );

    await user.click(screen.getByTestId("button-confirm-skip"));

    // The reason is optional; confirming without one is a first-class outcome.
    expect(onConfirm).toHaveBeenCalledWith(null);
  });

  it("passes the selected reason through on confirm", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <SkipConfirmDialog entry={makeEntry()} onOpenChange={vi.fn()} onConfirm={onConfirm} />,
    );

    await user.click(screen.getByTestId("skip-reason-injured"));
    await user.click(screen.getByTestId("button-confirm-skip"));

    expect(onConfirm).toHaveBeenCalledWith("injured");
  });

  it("lets a chip be deselected back to no reason", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <SkipConfirmDialog entry={makeEntry()} onOpenChange={vi.fn()} onConfirm={onConfirm} />,
    );

    const chip = screen.getByTestId("skip-reason-ill");
    await user.click(chip);
    expect(chip).toHaveAttribute("aria-pressed", "true");

    await user.click(chip);
    expect(chip).toHaveAttribute("aria-pressed", "false");

    await user.click(screen.getByTestId("button-confirm-skip"));
    expect(onConfirm).toHaveBeenCalledWith(null);
  });

  it("reschedules instead of skipping when a move is chosen", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onMove = vi.fn();
    const onOpenChange = vi.fn();
    const entry = makeEntry();
    render(
      <SkipConfirmDialog
        entry={entry}
        onOpenChange={onOpenChange}
        onConfirm={onConfirm}
        onMove={onMove}
      />,
    );

    await user.click(screen.getByTestId("skip-move-tomorrow"));

    expect(onMove).toHaveBeenCalledWith(entry, expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
    // Moving is an alternative to skipping, not an addition to it.
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("hides the move affordance when rescheduling isn't wired up", () => {
    render(
      <SkipConfirmDialog entry={makeEntry()} onOpenChange={vi.fn()} onConfirm={vi.fn()} />,
    );

    expect(screen.queryByTestId("skip-move-tomorrow")).not.toBeInTheDocument();
  });

  it("clears a reason picked for a previous session", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const { rerender } = render(
      <SkipConfirmDialog entry={makeEntry()} onOpenChange={vi.fn()} onConfirm={onConfirm} />,
    );

    await user.click(screen.getByTestId("skip-reason-ill"));

    // The dialog stays mounted across sessions, so the draft must not leak.
    rerender(
      <SkipConfirmDialog
        entry={makeEntry({ planDayId: "pd-2", focus: "Long run" })}
        onOpenChange={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    expect(screen.getByTestId("skip-reason-ill")).toHaveAttribute("aria-pressed", "false");
  });
});
