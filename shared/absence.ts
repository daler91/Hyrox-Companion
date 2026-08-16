/**
 * Declared absences — the dates an athlete has already told us they were not
 * training, and why.
 *
 * Server-only today (the timeline resolves this per request and ships the
 * answer as `TimelineEntry.excused`), but kept in `shared` and free of imports
 * so a client surface can use it later without dragging the drizzle graph into
 * the browser bundle — the invariant `script/bundle-check.ts` exists to
 * protect. Do not import from `@shared/schema` here: a value-import from the
 * barrel would break that the moment the client picks this up.
 */

/** The shape this needs from a timeline annotation. Dates are `YYYY-MM-DD`. */
export interface AbsenceRange {
  readonly startDate: string;
  readonly endDate: string;
}

/**
 * Whether `date` falls inside one of the athlete's declared absences.
 *
 * Every annotation type counts. `injury`, `illness`, `travel` and `rest` are
 * all the athlete saying "I know I wasn't training, and here is why" — which is
 * the entire reason the feature exists. Splitting them into excusable and
 * inexcusable would draw a line the athlete cannot see and never agreed to.
 *
 * `YYYY-MM-DD` orders lexically exactly as it orders chronologically, so this
 * needs no `Date` parsing and belongs to no timezone — the caller has already
 * resolved both sides to the athlete's own local calendar.
 */
export function isDateExcused(date: string, ranges: readonly AbsenceRange[]): boolean {
  return ranges.some((range) => range.startDate <= date && date <= range.endDate);
}
