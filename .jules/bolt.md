## 2024-05-18 - Optimized chaining methods
**Learning:** Chained array iteration methods like `.map().filter().reduce()` are common but create unnecessary intermediate array allocations, reducing performance. Single `for...of` loops that maintain multiple pieces of state can execute in one pass (O(N)) instead of O(3N).
**Action:** Always scan for chained iteration methods that are easily combined into a single pass when optimizing data aggregation logic, and add comments explaining the optimization.
## 2024-05-17 - Fast Object Sorting
**Learning:** Calling `JSON.stringify` inside an array `.sort()` comparator results in O(N log N) serializations, severely impacting performance for large arrays, exacerbated further when chained with `localeCompare`.
**Action:** Use a Schwartzian transform (decorate-sort-undecorate) to pre-calculate the serialized key string in a `.map()`, sort with standard `<`/`>` string comparison, and extract the original item.
