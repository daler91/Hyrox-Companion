import { addDaysToISODate, dayDiff } from "@shared/dateUtils";
import { NUTRITION_RANGE_MAX_DAYS, nutritionRangeSchema } from "@shared/schema";
import { describe, expect, it } from "vitest";

import {
  FUELLING_BLOCK_DAYS,
  fuellingRangeWindow,
  renderedFuellingWindow,
} from "../fuellingWindow";

const TODAY = "2026-10-03";
const days = (from: string, to: string) => dayDiff(from, to) + 1;

// PF1 (CODEBASE_ANALYSIS_2026-10-03): /summary-range rejects a span over
// NUTRITION_RANGE_MAX_DAYS, and the Timeline's visible window has no length
// bound, so a wide window would lose every fuelling chip to a 400.
describe("fuellingRangeWindow", () => {
  it("passes a window within the cap through unchanged", () => {
    expect(fuellingRangeWindow("2026-09-20", "2026-10-17", TODAY)).toEqual({
      from: "2026-09-20",
      to: "2026-10-17",
    });
    const atCap = addDaysToISODate("2025-01-01", NUTRITION_RANGE_MAX_DAYS - 1);
    expect(fuellingRangeWindow("2025-01-01", atCap, TODAY)).toEqual({ from: "2025-01-01", to: atCap });
  });

  it("leaves an empty window empty so the query stays disabled", () => {
    expect(fuellingRangeWindow("", "", TODAY)).toEqual({ from: "", to: "" });
  });

  it.each([
    // Back after a two-year break: the 7 most recent past groups reach 2024.
    ["a long gap in the recent past groups", "2024-03-01", "2026-10-10"],
    // Show-all past plus a few "Load older" pages.
    ["several years of history", "2019-01-07", "2026-10-10"],
    // An annotation far ahead when there are fewer than 7 future groups.
    ["a far-future annotation", "2026-09-26", "2029-05-01"],
    ["a mistyped annotation date", "2026-09-26", "9999-12-31"],
    ["both ends far off", "0202-05-01", "2999-01-01"],
  ])("narrows a window wider than the cap (%s) to one the server accepts", (_label, oldest, newest) => {
    expect(nutritionRangeSchema.safeParse({ from: oldest, to: newest }).success).toBe(false);

    const { from, to } = fuellingRangeWindow(oldest, newest, TODAY);

    expect(nutritionRangeSchema.safeParse({ from, to }).success).toBe(true);
    expect(days(from, to)).toBe(NUTRITION_RANGE_MAX_DAYS);
    expect(from >= oldest && to <= newest).toBe(true);
    expect(from <= TODAY && TODAY <= to).toBe(true);
  });

  it("centres the window on today when the visible window reaches far enough both ways", () => {
    const { from, to } = fuellingRangeWindow("2020-01-01", "2030-01-01", TODAY);
    expect(dayDiff(from, TODAY)).toBe(dayDiff(TODAY, to));
  });

  it("keeps the newest days when the visible window ends soon after today", () => {
    expect(fuellingRangeWindow("2020-01-01", "2026-10-10", TODAY)).toEqual({
      from: addDaysToISODate("2026-10-10", -(NUTRITION_RANGE_MAX_DAYS - 1)),
      to: "2026-10-10",
    });
  });

  it("keeps the oldest days when the visible window starts soon before today", () => {
    expect(fuellingRangeWindow("2026-09-26", "2030-01-01", TODAY)).toEqual({
      from: "2026-09-26",
      to: addDaysToISODate("2026-09-26", NUTRITION_RANGE_MAX_DAYS - 1),
    });
  });
});

// PF7 (CODEBASE_ANALYSIS_2026-10-03): the range ran from the oldest visible
// group to the newest, annotation-only rows included, so show-all or "Load
// older" fetched years of entries for the few chips on screen.
describe("renderedFuellingWindow", () => {
  const session = [{ id: "w" }];
  // Ascending, as the Timeline lays its rows out.
  const rows: [string, unknown[]][] = [
    ["2019-05-01", []], // an old note
    ["2021-03-10", session],
    ["2021-03-20", session],
    ["2026-09-29", session],
    ["2026-10-01", session],
    [TODAY, []], // a rest day: today's row
    ["2026-10-05", session],
    ["2026-10-12", session],
    ["2029-05-01", []], // a note years ahead
  ];
  const everyRow = [...rows.keys()];

  it("covers the rendered session rows, not the annotation-only rows around them", () => {
    expect(renderedFuellingWindow(rows, everyRow.slice(3), TODAY)).toEqual({
      from: "2026-09-07",
      to: "2026-11-01",
    });
  });

  it("asks only for the rows the virtualizer renders", () => {
    expect(renderedFuellingWindow(rows, [1, 2], TODAY)).toEqual({
      from: "2021-03-01",
      to: "2021-03-28",
    });
  });

  it("snaps to whole Monday-to-Sunday blocks, so scrolling inside one asks for the same range", () => {
    const range = renderedFuellingWindow(rows, [3, 4], TODAY);

    expect(renderedFuellingWindow(rows, [4, 5], TODAY)).toEqual(range);
    expect(days(range.from, range.to)).toBe(FUELLING_BLOCK_DAYS);
    expect(new Date(`${range.from}T00:00:00Z`).getUTCDay()).toBe(1);
  });

  it("counts today's row though it holds no session", () => {
    expect(renderedFuellingWindow(rows, [5], TODAY)).toEqual({
      from: "2026-09-07",
      to: "2026-10-04",
    });
  });

  it("asks for nothing when only annotation rows render, or none do", () => {
    expect(renderedFuellingWindow(rows, [0, 8], TODAY)).toEqual({ from: "", to: "" });
    expect(renderedFuellingWindow(rows, [], TODAY)).toEqual({ from: "", to: "" });
  });

  it("still holds rendered rows years apart to the server's cap", () => {
    const { from, to } = renderedFuellingWindow(rows, [1, 2, 3], TODAY);

    expect(nutritionRangeSchema.safeParse({ from, to }).success).toBe(true);
    expect(to).toBe("2026-10-04");
  });
});
