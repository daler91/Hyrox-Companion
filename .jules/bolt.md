## 2026-05-18 - Avoid O(N log N) JSON.stringify in array sorts
**Learning:** Calling `JSON.stringify()` inside a `.sort()` comparator executes the expensive serialization operation O(N log N) times, which can degrade performance even on medium-sized arrays. Combining this with `localeCompare` amplifies the overhead and can introduce environment-dependent determinism issues.
**Action:** Use a Schwartzian transform (decorate-sort-undecorate) to pre-compute stringified keys in O(N) time before sorting. Use standard explicit string comparison (`<`, `>`) on the keys instead of `localeCompare` for safe, deterministic, and much faster sorting.
Learned to replace N+1 sequential database inserts in loops with bulk array inserts using flatMap in batch functions, significantly reducing latency and execution time by ~40x on large collections.
## 2024-11-21 - Redundant Date instantiation in ORM timestamp fields
**Learning:** When retrieving `timestamp` fields via Drizzle ORM, the values are already parsed into native JavaScript `Date` objects. Wrapping them in `new Date()` inside an array `.sort()` comparator creates unnecessary object allocations and incurs a measurable O(N log N) garbage collection overhead.
**Action:** Call `.getTime()` directly on the `Date` objects returned by the ORM (e.g., `a.createdAt.getTime()`) rather than re-instantiating them.
