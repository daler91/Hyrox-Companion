import { ANALYTICS_CACHE_TTL_MS } from "../constants";

/**
 * In-process request coalescing + TTL cache backing the analytics routes.
 *
 * Lives here rather than inside `routes/analytics.ts` so write paths can reach
 * `invalidateAnalyticsCachesForUser` without importing the router (and the
 * import cycle that would create). The routes own the *fetchers*; this module
 * owns the *storage* they cache into.
 */

const CACHE_TTL_MS = ANALYTICS_CACHE_TTL_MS;
const MAX_CACHE_SIZE = 500;

export interface CacheEntry<T> {
  promise: Promise<T>;
  timestamp: number;
}

function evictStale<T extends { timestamp: number }>(
  map: Map<string, T>,
  ttl: number,
  maxSize: number,
): void {
  const now = Date.now();
  // First pass: remove expired entries
  for (const [key, entry] of map) {
    if (now - entry.timestamp >= ttl) map.delete(key);
  }
  // Second pass: if still over limit, drop oldest
  while (map.size > maxSize) {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    for (const [key, entry] of map) {
      if (entry.timestamp < oldestTime) {
        oldestTime = entry.timestamp;
        oldestKey = key;
      }
    }
    if (oldestKey) map.delete(oldestKey);
    else break;
  }
}

/**
 * Every cache created through `createCoalescedCache`, so a single user's
 * entries can be dropped across all of them on write.
 */
const registeredCaches: Map<string, { timestamp: number }>[] = [];

/**
 * Collapses concurrent requests for the same (userId, from, to) into a single
 * storage call and caches the result for up to `CACHE_TTL_MS` to absorb rapid
 * refetches from the Analytics tabs. On fetch failure the entry is evicted so
 * the next request retries immediately.
 */
export function createCoalescedCache<T>(
  cache: Map<string, CacheEntry<T>>,
  keyPrefix: string,
  fetcher: (userId: string, from?: string, to?: string) => Promise<T>,
): (userId: string, from?: string, to?: string) => Promise<T> {
  registeredCaches.push(cache);
  return (userId, from, to) => {
    const cacheKey = `${keyPrefix}${userId}-${from ?? "none"}-${to ?? "none"}`;
    const now = Date.now();

    const entry = cache.get(cacheKey);
    if (entry && now - entry.timestamp < CACHE_TTL_MS) {
      return entry.promise;
    }

    const promise = fetcher(userId, from, to).catch((error: unknown) => {
      cache.delete(cacheKey);
      throw error;
    });
    cache.set(cacheKey, { promise, timestamp: now });
    evictStale(cache, CACHE_TTL_MS, MAX_CACHE_SIZE);
    return promise;
  };
}

/**
 * Drop every cached analytics slice belonging to one athlete.
 *
 * Called after writes that change the sets those slices are computed from —
 * without it, editing a set left the Analytics tabs serving pre-edit numbers
 * for up to the full TTL while the workout's own screens showed the new value,
 * which reads as "my change didn't save".
 *
 * Deliberately narrow: this clears THIS process's maps. With more than one app
 * instance the others keep serving their own copies until the TTL expires, so
 * the TTL remains the correctness backstop and this is a latency improvement on
 * top of it. Every cache key embeds the user id after its prefix, and the maps
 * are capped at 500 entries, so the scan is trivial.
 */
export function invalidateAnalyticsCachesForUser(userId: string): void {
  for (const cache of registeredCaches) {
    for (const key of cache.keys()) {
      // Keys are `${prefix}${userId}-${from}-${to}`; prefixes never contain a
      // user id, so an includes() check cannot collide across users.
      if (key.includes(userId)) cache.delete(key);
    }
  }
}
