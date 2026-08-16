import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WeeklyReviewPrompt } from "../WeeklyReviewPrompt";

const mocks = vi.hoisted<{ user?: { id: string } }>(() => ({ user: { id: "u1" } }));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: mocks.user }) }));

// Mon 2026-06-22 08:00 local — inside the window, looking back at the week
// that opened Mon 2026-06-15.
const MONDAY_MORNING = new Date("2026-06-22T08:00:00");
const WEEK_START = "2026-06-15";

describe("WeeklyReviewPrompt", () => {
  beforeEach(() => {
    mocks.user = { id: "u1" };
    globalThis.localStorage.clear();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(MONDAY_MORNING);
  });

  afterEach(() => vi.useRealTimers());

  it("links to the review for the week that just closed", () => {
    render(<WeeklyReviewPrompt />);

    expect(screen.getByTestId("weekly-review-prompt")).toBeInTheDocument();
    expect(screen.getByTestId("weekly-review-prompt-open").closest("a")).toHaveAttribute(
      "href",
      `/review?week=${WEEK_START}`,
    );
  });

  it("says the week is still closing on Sunday evening", () => {
    vi.setSystemTime(new Date("2026-06-21T20:00:00"));
    render(<WeeklyReviewPrompt />);

    expect(screen.getByTestId("weekly-review-prompt")).toHaveTextContent("wrapping up");
  });

  it("renders nothing mid-week", () => {
    vi.setSystemTime(new Date("2026-06-18T20:00:00"));
    render(<WeeklyReviewPrompt />);

    expect(screen.queryByTestId("weekly-review-prompt")).not.toBeInTheDocument();
  });

  it("stays dismissed for the rest of the week", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<WeeklyReviewPrompt />);

    await user.click(screen.getByTestId("weekly-review-prompt-dismiss"));
    expect(screen.queryByTestId("weekly-review-prompt")).not.toBeInTheDocument();

    // Tuesday, same target week: a dismissal the athlete has to repeat daily
    // is not a dismissal.
    unmount();
    vi.setSystemTime(new Date("2026-06-23T08:00:00"));
    render(<WeeklyReviewPrompt />);
    expect(screen.queryByTestId("weekly-review-prompt")).not.toBeInTheDocument();
  });

  it("returns for the next week", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<WeeklyReviewPrompt />);
    await user.click(screen.getByTestId("weekly-review-prompt-dismiss"));
    unmount();

    vi.setSystemTime(new Date("2026-06-29T08:00:00"));
    render(<WeeklyReviewPrompt />);

    expect(screen.getByTestId("weekly-review-prompt")).toBeInTheDocument();
  });

  it("renders nothing without a signed-in user to remember the dismissal", () => {
    mocks.user = undefined;
    render(<WeeklyReviewPrompt />);

    expect(screen.queryByTestId("weekly-review-prompt")).not.toBeInTheDocument();
  });
});
