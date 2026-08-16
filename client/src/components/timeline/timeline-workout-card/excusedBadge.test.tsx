import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { getStatusBadge } from "./utils";

describe("declared-absence status badge", () => {
  it("replaces the status badge on an excused day", () => {
    // The server only sets `excused` on a day that would otherwise have read
    // "Missed", so this is the whole point: no red badge for a week the
    // athlete already explained.
    render(<>{getStatusBadge("planned", "Strength", true)}</>);

    expect(screen.getByTestId("badge-excused")).toHaveTextContent("Not counted");
    expect(screen.queryByText("Missed")).toBeNull();
    expect(screen.queryByText("Planned")).toBeNull();
  });

  it("leaves an ordinary day's badge alone", () => {
    render(<>{getStatusBadge("missed", "Strength", undefined)}</>);

    expect(screen.queryByTestId("badge-excused")).toBeNull();
    expect(screen.getByText("Missed")).toBeInTheDocument();
  });

  it("does not outrank the race-day badge", () => {
    // Race day short-circuits first. An athlete who booked travel over their
    // own race has a bigger problem than a badge, but the race is still the
    // more informative thing to show.
    render(<>{getStatusBadge("planned", "Race Day", true)}</>);

    expect(screen.getByTestId("badge-race-day")).toBeInTheDocument();
    expect(screen.queryByTestId("badge-excused")).toBeNull();
  });
});
