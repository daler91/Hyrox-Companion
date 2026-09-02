import type { TimelineEntry } from '@shared/schema';

export function sortAndWindowTimelineEntries(
  entries: TimelineEntry[],
  limit?: number,
  offset?: number,
): TimelineEntry[] {
  entries.sort((a, b) => {
    if (b.date < a.date) return -1;
    if (b.date > a.date) return 1;
    return 0;
  });

  if (limit === undefined) return entries;
  const start = offset || 0;
  return entries.slice(start, start + limit);
}

export interface TimelinePageWindow {
  entries: TimelineEntry[];
  /**
   * Exclusive upper date bound for the next page (`?before=`), or null when
   * the page reached the end of the athlete's history.
   */
  nextCursor: string | null;
}

/**
 * Cut one page out of a date-desc sorted merge (P3).
 *
 * The page never splits a calendar date when more entries follow, so the last
 * date on the page is an exact exclusive bound for the next request. Two
 * signals say "more follows": entries left in the merge beyond the window, or
 * a source query that hit its SQL cap (`sourceTruncated`), in which case the
 * merge's own last date may itself be incomplete and is dropped as well. The
 * one pathological shape, a window made of a single date with more of that
 * date beyond it, keeps the window whole and moves on; a page that large on
 * one day is not a real timeline.
 */
export function windowTimelinePage(
  entries: TimelineEntry[],
  start: number,
  limit: number,
  sourceTruncated: boolean,
): TimelinePageWindow {
  const end = start + limit;
  const hasMore = entries.length > end || sourceTruncated;
  if (!hasMore) return { entries: entries.slice(start), nextCursor: null };

  const cut = Math.min(end, entries.length);
  if (cut <= start) return { entries: [], nextCursor: null };

  const boundaryDate = entries[cut - 1].date;
  const boundaryStraddles = cut < entries.length ? entries[cut].date === boundaryDate : sourceTruncated;
  let pageEnd = cut;
  if (boundaryStraddles) {
    let firstOfGroup = cut - 1;
    while (firstOfGroup > start && entries[firstOfGroup - 1].date === boundaryDate) firstOfGroup--;
    if (firstOfGroup > start) pageEnd = firstOfGroup;
  }
  const page = entries.slice(start, pageEnd);
  return { entries: page, nextCursor: page.length > 0 ? page[page.length - 1].date : null };
}
