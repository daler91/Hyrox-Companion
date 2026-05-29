import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { getCardClasses, getStatusBadge, isRaceDayEntry } from "./utils";

describe("race-day timeline helpers", () => {
  it("matches the race-day marker case-insensitively but not other 'race' focuses", () => {
    expect(isRaceDayEntry("Race Day")).toBe(true);
    expect(isRaceDayEntry(" race day ")).toBe(true);
    expect(isRaceDayEntry("RACE DAY")).toBe(true);
    // Must NOT collide with workout focuses that merely contain "race".
    expect(isRaceDayEntry("Race Pace")).toBe(false);
    expect(isRaceDayEntry("Race Simulation")).toBe(false);
    expect(isRaceDayEntry(null)).toBe(false);
    expect(isRaceDayEntry("")).toBe(false);
  });

  it("renders a distinct Race Day badge for a race-day entry", () => {
    render(<>{getStatusBadge("planned", "Race Day")}</>);
    expect(screen.getByTestId("badge-race-day")).toHaveTextContent("Race Day");
  });

  it("renders the normal status badge for a non-race focus", () => {
    render(<>{getStatusBadge("planned", "Race Pace")}</>);
    expect(screen.queryByTestId("badge-race-day")).toBeNull();
    expect(screen.getByText("Planned")).toBeInTheDocument();
  });

  it("applies distinct card styling to race-day entries only", () => {
    expect(getCardClasses(false, false, "planned", "Race Day")).toContain("amber");
    expect(getCardClasses(false, false, "planned", "Tempo Run")).not.toContain("amber");
  });
});
