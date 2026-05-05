## 2024-05-18 - Optimized chaining methods
**Learning:** Chained array iteration methods like `.map().filter().reduce()` are common but create unnecessary intermediate array allocations, reducing performance. Single `for...of` loops that maintain multiple pieces of state can execute in one pass (O(N)) instead of O(3N).
**Action:** Always scan for chained iteration methods that are easily combined into a single pass when optimizing data aggregation logic, and add comments explaining the optimization.
