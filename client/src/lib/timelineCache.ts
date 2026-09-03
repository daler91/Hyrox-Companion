import type { TimelineEntry } from "@shared/schema";
import type { InfiniteData } from "@tanstack/react-query";

/** One `GET /api/v1/timeline` page: the body plus the `X-Next-Cursor` header. */
export interface TimelinePage {
  entries: TimelineEntry[];
  /** Exclusive `before=` bound for the next older page; null at the end of history. */
  nextCursor: string | null;
}

/**
 * Shape of the timeline query cache since paging (P3): an infinite query whose
 * pages are contiguous, newest first. Everything that reads or patches the
 * timeline cache goes through the two helpers below so the page structure is
 * an implementation detail of this module.
 */
export type TimelineCache = InfiniteData<TimelinePage, string | null>;

/** Flat, newest-first view of every loaded page. */
export function flattenTimelineCache(cache: TimelineCache | undefined): TimelineEntry[] {
  if (!cache) return [];
  return cache.pages.flatMap((page) => page.entries);
}

/**
 * Apply an entries transform (map or filter) to every loaded page. Pages whose
 * entries come back as the same array are reused, so an updater that returns
 * its input untouched leaves the cache object identity alone.
 */
export function mapTimelineCache(
  cache: TimelineCache | undefined,
  transform: (entries: TimelineEntry[]) => TimelineEntry[],
): TimelineCache | undefined {
  if (!cache) return cache;
  let changed = false;
  const pages = cache.pages.map((page) => {
    const entries = transform(page.entries);
    if (entries === page.entries) return page;
    changed = true;
    return { ...page, entries };
  });
  return changed ? { ...cache, pages } : cache;
}
