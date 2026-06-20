## 2026-05-18 - Avoid O(N log N) JSON.stringify in array sorts
**Learning:** Calling `JSON.stringify()` inside a `.sort()` comparator executes the expensive serialization operation O(N log N) times, which can degrade performance even on medium-sized arrays. Combining this with `localeCompare` amplifies the overhead and can introduce environment-dependent determinism issues.
**Action:** Use a Schwartzian transform (decorate-sort-undecorate) to pre-compute stringified keys in O(N) time before sorting. Use standard explicit string comparison (`<`, `>`) on the keys instead of `localeCompare` for safe, deterministic, and much faster sorting.
Learned to replace N+1 sequential database inserts in loops with bulk array inserts using flatMap in batch functions, significantly reducing latency and execution time by ~40x on large collections.
## 2024-11-21 - Redundant Date instantiation in ORM timestamp fields
**Learning:** When retrieving `timestamp` fields via Drizzle ORM, the values are already parsed into native JavaScript `Date` objects. Wrapping them in `new Date()` inside an array `.sort()` comparator creates unnecessary object allocations and incurs a measurable O(N log N) garbage collection overhead.
**Action:** Call `.getTime()` directly on the `Date` objects returned by the ORM (e.g., `a.createdAt.getTime()`) rather than re-instantiating them.
## 2026-06-14 - Use Sets instead of array.includes() inside loops
**Learning:** Calling `Array.includes()` (an O(N) operation) inside a loop creates an O(N*M) time complexity bottleneck. In functions processing large arrays or nested arrays (like iterating through `exerciseSets` and checking against a predefined `allStations` array), this can significantly slow down execution.
**Action:** Convert the static target array into a `Set` outside the loop and use `Set.has()` (an O(1) operation) inside the loop to drop the overall time complexity to O(N+M).
## 2026-06-15 - Avoid Math.max with array spread
**Learning:** Using `Math.max(default, ...array.map(fn))` or `Math.min()` with the spread operator on a mapped array allocates an unnecessary intermediate array and can throw a 'Maximum call stack size exceeded' error if the data array is very large. It also incurs an O(N) memory allocation overhead.
**Action:** Replace `Math.max` and `Math.min` spread calls with an O(N) linear scan using a `for...of` loop to find the extremum safely and efficiently.
## 2026-06-17 - Fast Date Parsing
**Learning:** Instantiating `new Date(dateStr).getTime()` just to get a numerical timestamp incurs significant overhead compared to using `Date.parse(dateStr)`. In areas like Analytics where date differences are computed extensively (e.g. over hundreds of movement patterns and muscle mappings), this simple replacement yields a ~60% speedup.
**Action:** Always prefer `Date.parse(str)` when only the epoch timestamp is needed, avoiding intermediate object allocation.
## 2026-06-20 - Array method chain optimization
**Learning:** Chaining array methods like `.map()`, `.filter()`, and `.reduce()` creates intermediate arrays that add to garbage collection overhead and degrade performance. Finding the maximum value in an array using `Math.max(...array)` with the spread operator can also cause stack overflow errors on large arrays.
**Action:** Replace chained array iterations and spread operators with a single `for...of` loop that computes the result in one `O(N)` pass with `O(1)` extra memory.
