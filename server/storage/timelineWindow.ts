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
