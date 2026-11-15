import { addDaysToISODate, dayDiff } from "./dateUtils";

/**
 * Most days a /block or /summary-range window may cover, inclusive. Both build
 * one point per day synchronously, and an unbounded span let one request stall
 * or crash the instance (PF1, CODEBASE_ANALYSIS_2026-10-03). Two years: double
 * the longest fixed window a client asks for (the Analytics Fuelling tab's
 * 366-day "All time"). The Timeline's visible window has no fixed length, so
 * /summary-range narrows a wider request to this many days around today
 * (`clampNutritionRange`) rather than refusing it.
 *
 * Its own module, not shared/schema, so the client can read it without the
 * @shared/schema barrel pulling drizzle into its bundle (script/bundle-check.ts).
 */
export const NUTRITION_RANGE_MAX_DAYS = 731;

/**
 * [from]..[to] held to NUTRITION_RANGE_MAX_DAYS: a wider range is narrowed to
 * the cap, centred on [today] where the range reaches far enough each side,
 * and otherwise kept to its nearer end. Days outside it go unserved.
 */
export function clampNutritionRange(from: string, to: string, today: string): { from: string; to: string } {
  const span = dayDiff(from, to) + 1;
  if (span <= NUTRITION_RANGE_MAX_DAYS) return { from, to };
  const centred = dayDiff(from, today) - Math.floor((NUTRITION_RANGE_MAX_DAYS - 1) / 2);
  const offset = Math.min(Math.max(centred, 0), span - NUTRITION_RANGE_MAX_DAYS);
  const start = addDaysToISODate(from, offset);
  return { from: start, to: addDaysToISODate(start, NUTRITION_RANGE_MAX_DAYS - 1) };
}
