import { addDaysToISODate, dayDiff } from "@shared/dateUtils";
import { NUTRITION_RANGE_MAX_DAYS } from "@shared/nutritionRange";

/**
 * A date range for /nutrition/summary-range held to the server's span cap. The
 * Timeline's range (renderedFuellingWindow) follows the rows on screen, but
 * nothing bounds its length — two sessions rendered side by side can be years
 * apart after a break — and the server rejects a span over
 * NUTRITION_RANGE_MAX_DAYS (PF1, CODEBASE_ANALYSIS_2026-10-03), and a rejected
 * request would drop every chip.
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

/**
 * Days the fuelling request snaps out to at each end, on a fixed grid, so
 * scrolling within a block asks for the same range and does not refetch.
 */
export const FUELLING_BLOCK_DAYS = 28;
// A Monday, so every block runs Monday to Sunday four weeks later.
const FUELLING_BLOCK_EPOCH = "2001-01-01";

function fuellingBlockStart(date: string): string {
  const blocks = Math.floor(dayDiff(FUELLING_BLOCK_EPOCH, date) / FUELLING_BLOCK_DAYS);
  return addDaysToISODate(FUELLING_BLOCK_EPOCH, blocks * FUELLING_BLOCK_DAYS);
}

/** One Timeline row: its date and the entries on it (none for an annotation-only row). */
type TimelineRow = readonly [date: string, entries: readonly unknown[]];

/** The dates of the rendered rows that bound the range: session rows, and today. */
function renderedChipDates(
  rows: readonly TimelineRow[],
  renderedIndexes: readonly number[],
  today: string,
): string[] {
  const dates: string[] = [];
  for (const index of renderedIndexes) {
    const row = rows.at(index);
    if (row) {
      const [date, entries] = row;
      if (entries.length > 0 || date === today) dates.push(date);
    }
  }
  return dates;
}

/**
 * The range the Timeline asks /nutrition/summary-range for: the rows the
 * virtualizer actually renders (`renderedIndexes` into `rows`), snapped out to
 * whole FUELLING_BLOCK_DAYS blocks, then held to the server's cap by
 * fuellingRangeWindow.
 *
 * It spanned every visible group, oldest to newest, annotation-only rows
 * included, so show-all or "Load older" asked for years of food entries and a
 * training-load computation for a few chips on screen, and refetched at every
 * change at either end. Annotation-only rows still get a chip when they fall
 * inside the range; they no longer stretch it, so a note years out cannot.
 * Today counts as a session row: its chip is the day's intake so far.
 * PF7 (CODEBASE_ANALYSIS_2026-10-03)
 */
export function renderedFuellingWindow(
  rows: readonly TimelineRow[],
  renderedIndexes: readonly number[],
  today: string,
): { from: string; to: string } {
  const dates = renderedChipDates(rows, renderedIndexes, today).sort((left, right) =>
    left.localeCompare(right),
  );
  const oldest = dates.at(0);
  const newest = dates.at(-1);
  if (oldest === undefined || newest === undefined) return { from: "", to: "" };
  return fuellingRangeWindow(
    fuellingBlockStart(oldest),
    addDaysToISODate(fuellingBlockStart(newest), FUELLING_BLOCK_DAYS - 1),
    today,
  );
}
