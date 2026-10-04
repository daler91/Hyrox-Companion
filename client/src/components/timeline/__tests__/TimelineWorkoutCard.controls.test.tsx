import type { TimelineEntry } from "@shared/schema";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { addDays, format } from "date-fns";
import { describe, expect, it, vi } from "vitest";

import { installRadixPointerMocks } from "@/test/support/radixPointerMocks";

import TimelineWorkoutCard from "../timeline-workout-card";

installRadixPointerMocks();

// A future planned session with a plan day and a move handler, so the card
// renders every child control it can carry: the complete button, the drag
// handle and the move menu. The a11y suite's fixture has none of them, which
// is how a card-level key handler swallowing their keys went unnoticed
// (U1, CODEBASE_ANALYSIS_2026-10-03).
const ENTRY_DATE = format(addDays(new Date(), 3), "yyyy-MM-dd");
const planned = {
  id: "plan-pd-1",
  date: ENTRY_DATE,
  type: "planned",
  status: "planned",
  focus: "Threshold run",
  mainWorkout: "5 x 1 km at threshold",
  accessory: null,
  notes: null,
  planDayId: "pd-1",
} as TimelineEntry;

function renderCard() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        queryFn: () => Promise.resolve({ weightUnit: "kg", distanceUnit: "km" }),
      },
    },
  });
  queryClient.setQueryData(["/api/v1/preferences"], { weightUnit: "kg", distanceUnit: "km" });
  const onClick = vi.fn();
  const onMarkComplete = vi.fn();
  const onMove = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <TimelineWorkoutCard
        entry={planned}
        onClick={onClick}
        onMarkComplete={onMarkComplete}
        onMove={onMove}
      />
    </QueryClientProvider>,
  );
  return { onClick, onMarkComplete, onMove, user: userEvent.setup() };
}

async function openDatePicker(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId("move-menu-plan-pd-1"));
  await user.click(await screen.findByTestId("move-pick-date-plan-pd-1"));
  return await screen.findByTestId("move-date-input-plan-pd-1");
}

describe("TimelineWorkoutCard child controls (U1)", () => {
  it("lets Enter on the complete button complete the session instead of opening the card", async () => {
    const { onClick, onMarkComplete, user } = renderCard();

    screen.getByTestId("button-complete-plan-pd-1").focus();
    await user.keyboard("{Enter}");

    expect(onMarkComplete).toHaveBeenCalledWith(planned);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("lets Space on the complete button complete the session instead of opening the card", async () => {
    const { onClick, onMarkComplete, user } = renderCard();

    screen.getByTestId("button-complete-plan-pd-1").focus();
    await user.keyboard(" ");

    expect(onMarkComplete).toHaveBeenCalledWith(planned);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("leaves Space and Enter on the drag handle to the keyboard reschedule", () => {
    const { onClick } = renderCard();
    const handle = screen.getByTestId("drag-handle-plan-pd-1");

    // fireEvent returns false when a handler called preventDefault.
    expect(fireEvent.keyDown(handle, { key: " " })).toBe(true);
    expect(fireEvent.keyDown(handle, { key: "Enter" })).toBe(true);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("opens the move menu from the keyboard without opening the card", async () => {
    const { onClick, user } = renderCard();

    screen.getByTestId("move-menu-plan-pd-1").focus();
    await user.keyboard("{Enter}");

    expect(await screen.findByTestId("move-pick-date-plan-pd-1")).toBeInTheDocument();
    expect(onClick).not.toHaveBeenCalled();
  });

  it("still opens the card on Enter and Space pressed on the card itself", () => {
    const { onClick } = renderCard();
    const card = screen.getByTestId("card-timeline-entry-plan-pd-1");

    fireEvent.keyDown(card, { key: "Enter" });
    fireEvent.keyDown(card, { key: " " });

    expect(onClick).toHaveBeenCalledTimes(2);
  });
});

describe("TimelineWorkoutCard Pick date dialog (CL11)", () => {
  it("does not move the session on each input event while a date is being typed", async () => {
    const { onMove, onClick, user } = renderCard();
    const input = await openDatePicker(user);

    // A desktop date input fires change per keystroke: typing the year "2026"
    // passes through 0002, 0020 and 0202 on the way.
    fireEvent.change(input, { target: { value: "0002-04-12" } });
    fireEvent.change(input, { target: { value: "0202-04-12" } });

    expect(onMove).not.toHaveBeenCalled();
    expect(screen.getByTestId("move-date-dialog-plan-pd-1")).toBeInTheDocument();
    expect(screen.getByTestId("move-date-confirm-plan-pd-1")).toBeDisabled();
    expect(onClick).not.toHaveBeenCalled();
  });

  it("does not move the session when the arrow keys step the date", async () => {
    const { onMove, user } = renderCard();
    const input = await openDatePicker(user);

    fireEvent.change(input, { target: { value: format(addDays(new Date(), 4), "yyyy-MM-dd") } });

    expect(onMove).not.toHaveBeenCalled();
  });

  it("moves the session once, to the chosen date, on an explicit confirm", async () => {
    const { onMove, onClick, user } = renderCard();
    const input = await openDatePicker(user);
    const target = format(addDays(new Date(), 5), "yyyy-MM-dd");

    fireEvent.change(input, { target: { value: target } });
    await user.click(screen.getByTestId("move-date-confirm-plan-pd-1"));

    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove).toHaveBeenCalledWith(planned, target);
    expect(screen.queryByTestId("move-date-dialog-plan-pd-1")).not.toBeInTheDocument();
    expect(onClick).not.toHaveBeenCalled();
  });

  it("confirms with Enter in the date field without opening the card", async () => {
    const { onMove, onClick, user } = renderCard();
    const input = await openDatePicker(user);
    const target = format(addDays(new Date(), 6), "yyyy-MM-dd");

    fireEvent.change(input, { target: { value: target } });
    input.focus();
    await user.keyboard("{Enter}");

    expect(onMove).toHaveBeenCalledWith(planned, target);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("keeps confirm disabled for the session's own date and for a cleared field", async () => {
    const { onMove, user } = renderCard();
    const input = await openDatePicker(user);
    const dialog = screen.getByTestId("move-date-dialog-plan-pd-1");

    expect(within(dialog).getByTestId("move-date-confirm-plan-pd-1")).toBeDisabled();
    fireEvent.change(input, { target: { value: "" } });
    expect(within(dialog).getByTestId("move-date-confirm-plan-pd-1")).toBeDisabled();

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(onMove).not.toHaveBeenCalled();
    expect(screen.queryByTestId("move-date-dialog-plan-pd-1")).not.toBeInTheDocument();
  });
});
