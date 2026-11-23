import type { TimelineEntry } from "@shared/schema";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ComponentProps, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installRadixPointerMocks } from "@/test/support/radixPointerMocks";

import { MoveEntryMenu } from "./MoveEntryMenu";

installRadixPointerMocks();

// Wednesday 14 Oct 2026, midday local time.
const TODAY = "2026-10-14";
const TOMORROW = "2026-10-15";
const NEXT_WEEK = "2026-10-21";

const dragAttributes = {
  role: "button",
  tabIndex: 0,
  "aria-disabled": false,
  "aria-pressed": undefined,
  "aria-roledescription": "draggable",
  "aria-describedby": "dnd-describedby",
} as ComponentProps<typeof MoveEntryMenu>["dragAttributes"];

function plannedOn(date: string): TimelineEntry {
  return {
    id: "plan-pd-1",
    date,
    type: "planned",
    status: "planned",
    focus: "Threshold run",
    mainWorkout: "5 x 1 km",
    accessory: null,
    notes: null,
    planDayId: "pd-1",
  };
}

function loggedOn(date: string): TimelineEntry {
  return { ...plannedOn(date), status: "completed", workoutLogId: "log-1" };
}

function Harness({ entry, onMove }: Readonly<{ entry: TimelineEntry; onMove: (date: string) => void }>) {
  const [movePickerOpen, setMovePickerOpen] = useState(false);
  return (
    <MoveEntryMenu
      entry={entry}
      isMoving={false}
      isDragging={false}
      movePickerOpen={movePickerOpen}
      setMovePickerOpen={setMovePickerOpen}
      onMove={onMove}
      dragListeners={undefined}
      dragAttributes={dragAttributes}
    />
  );
}

function renderMenu(entry: TimelineEntry) {
  const onMove = vi.fn();
  render(<Harness entry={entry} onMove={onMove} />);
  return { onMove, user: userEvent.setup() };
}

async function openMenu(user: ReturnType<typeof userEvent.setup>, entry: TimelineEntry) {
  await user.click(screen.getByTestId(`move-menu-${entry.id}`));
  return await screen.findByTestId(`move-pick-date-${entry.id}`);
}

async function openPicker(user: ReturnType<typeof userEvent.setup>, entry: TimelineEntry) {
  await user.click(await openMenu(user, entry));
  return await screen.findByTestId(`move-date-input-${entry.id}`);
}

// The quick jumps and the logged-workout clamp had no tests of their own
// (CC-moveMenu, REFACTORING_REVIEW 2026-09-23).
describe("MoveEntryMenu quick jumps", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 14, 12));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ["today", "move-today", TODAY],
    ["tomorrow", "move-tomorrow", TOMORROW],
    ["next week", "move-next-week", NEXT_WEEK],
  ])("moves a planned session to %s", async (_name, testIdPrefix, target) => {
    const entry = plannedOn("2026-10-10");
    const { onMove, user } = renderMenu(entry);

    await openMenu(user, entry);
    await user.click(screen.getByTestId(`${testIdPrefix}-${entry.id}`));

    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove).toHaveBeenCalledWith(target);
  });

  it.each([
    ["today", TODAY, "move-today"],
    ["tomorrow", TOMORROW, "move-tomorrow"],
    ["next week", NEXT_WEEK, "move-next-week"],
  ])("leaves out the jump to %s for a session already on it", async (_name, date, hiddenPrefix) => {
    const entry = plannedOn(date);
    const { user } = renderMenu(entry);

    await openMenu(user, entry);

    expect(screen.queryByTestId(`${hiddenPrefix}-${entry.id}`)).not.toBeInTheDocument();
    const shown = ["move-today", "move-tomorrow", "move-next-week"].filter((prefix) => prefix !== hiddenPrefix);
    for (const prefix of shown) {
      expect(screen.getByTestId(`${prefix}-${entry.id}`)).toBeInTheDocument();
    }
  });

  // A logged workout can't be dated past tomorrow (workoutDateNotFuture), so
  // a week ahead is never offered.
  it("never offers next week for a logged workout", async () => {
    const entry = loggedOn("2026-10-10");
    const { user } = renderMenu(entry);

    await openMenu(user, entry);

    expect(screen.getByTestId(`move-today-${entry.id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`move-tomorrow-${entry.id}`)).toBeInTheDocument();
    expect(screen.queryByTestId(`move-next-week-${entry.id}`)).not.toBeInTheDocument();
  });
});

describe("MoveEntryMenu picked date clamp", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 14, 12));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("caps a logged workout's picked date at tomorrow", async () => {
    const entry = loggedOn("2026-10-10");
    const { onMove, user } = renderMenu(entry);
    const input = await openPicker(user, entry);
    const confirm = screen.getByTestId(`move-date-confirm-${entry.id}`);

    expect(input).toHaveAttribute("max", TOMORROW);
    fireEvent.change(input, { target: { value: "2026-10-16" } });
    expect(confirm).toBeDisabled();

    fireEvent.change(input, { target: { value: TOMORROW } });
    expect(confirm).toBeEnabled();
    await user.click(confirm);

    expect(onMove).toHaveBeenCalledWith(TOMORROW);
  });

  it("leaves a planned session's picked date open-ended", async () => {
    const entry = plannedOn("2026-10-10");
    const { onMove, user } = renderMenu(entry);
    const input = await openPicker(user, entry);

    expect(input).not.toHaveAttribute("max");
    fireEvent.change(input, { target: { value: "2026-11-30" } });
    await user.click(screen.getByTestId(`move-date-confirm-${entry.id}`));

    expect(onMove).toHaveBeenCalledWith("2026-11-30");
  });
});
