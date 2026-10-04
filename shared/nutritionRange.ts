/**
 * Most days a /block or /summary-range window may cover, inclusive. Both build
 * one point per day synchronously, and an unbounded span let one request stall
 * or crash the instance (PF1, CODEBASE_ANALYSIS_2026-10-03). Two years: double
 * the longest fixed window a client asks for (the Analytics Fuelling tab's
 * 366-day "All time"). The Timeline's visible window has no fixed length, so
 * the Timeline narrows its request to this many days around today
 * (client/src/pages/timeline/fuellingWindow.ts).
 *
 * Its own module, not shared/schema, so the client can read it without the
 * @shared/schema barrel pulling drizzle into its bundle (script/bundle-check.ts).
 */
export const NUTRITION_RANGE_MAX_DAYS = 731;
