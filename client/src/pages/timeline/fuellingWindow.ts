import { addDaysToISODate, dayDiff } from "@shared/dateUtils";
import { NUTRITION_RANGE_MAX_DAYS } from "@shared/nutritionRange";

/**
 * The date range the Timeline asks /nutrition/summary-range for: its visible
 * window, oldest to newest group. Nothing bounds that window — a long gap in
 * the 7 most recent past groups, "Load older" pages, a far-off annotation — but
 * the server rejects a span over NUTRITION_RANGE_MAX_DAYS (PF1,
 * CODEBASE_ANALYSIS_2026-10-03), and a rejected request would drop every chip.
 * So a wider window is narrowed to the cap, centred on `today` where the window
 * reaches far enough each side, and otherwise kept to its nearer end. Days
 * outside it just get no chip.
 */
export function fuellingRangeWindow(
  oldest: string,
  newest: string,
  today: string,
): { from: string; to: string } {
  // "" leaves the query disabled; there is nothing to narrow.
  if (!oldest || !newest) return { from: oldest, to: newest };
  const span = dayDiff(oldest, newest) + 1;
  if (span <= NUTRITION_RANGE_MAX_DAYS) return { from: oldest, to: newest };

  const centred = dayDiff(oldest, today) - Math.floor((NUTRITION_RANGE_MAX_DAYS - 1) / 2);
  const offset = Math.min(Math.max(centred, 0), span - NUTRITION_RANGE_MAX_DAYS);
  const from = addDaysToISODate(oldest, offset);
  return { from, to: addDaysToISODate(from, NUTRITION_RANGE_MAX_DAYS - 1) };
}
