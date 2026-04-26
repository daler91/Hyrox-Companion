## 2024-11-20 - Pre-calculate array aggregations in useMemo
 **Learning:** In React components with large datasets, calling O(n) operations like `Array.prototype.some` and `Array.prototype.reduce` multiple times during every render (especially inside the returned JSX) can cause significant performance bottlenecks and slow down rendering.
 **Action:** Pre-calculate these array aggregations inside a `useMemo` hook using a single `O(n)` traversal (e.g., a single `for` loop) and return the aggregated values. This significantly reduces render time for large datasets and avoids unnecessary recalculations.

## 2024-11-20 - Extract static array operations out of React render
**Learning:** In React components, performing O(N) operations like `Object.entries()` followed by `.map()` and `.filter()` directly inside the component body or even inside `useMemo` is inefficient if the source array (`EXERCISE_DEFINITIONS`) and filter criteria are entirely static.
**Action:** Move static array allocations and filtering entirely outside of the component body. This ensures the array is calculated exactly once upon module load, preventing unnecessary re-evaluations and allocations on every render.

## 2025-03-17 - Optimize duplicate O(N) loops in useMemo hooks
**Learning:** In complex form components with `useMemo` hooks calculating state (like block counts and indices), maintaining separate loops for counting and index-tracking causes unnecessary O(2N) array traversals and redundant object allocations (like `runningCounts`).
**Action:** Consolidate multiple sequential `for` loops inside `useMemo` into a single loop when tracking dependent state. This changes the traversal complexity to strict O(N) and removes unneeded memory allocations.

## 2026-03-19 - Fast Date Sorting Optimization
**Learning:** Native JS `Date` instantiations (`new Date(str).getTime()`) and `localeCompare` are shockingly slow when used inside `Array.prototype.sort()` for large arrays. For ISO 8601 formatted date strings (like `YYYY-MM-DD`), standard string comparison (`<`, `>`) is computationally much cheaper, avoids memory allocation for new objects, and correctly preserves chronological sort order.
**Action:** Always prefer native string comparison `(a, b) => (b < a ? -1 : b > a ? 1 : 0)` over `localeCompare` or `Date` parsing when sorting arrays of YYYY-MM-DD string dates.

## 2024-05-27 - Fast String Date Comparison Optimization
**Learning:** Using `localeCompare()` for sorting ISO 8601 or YYYY-MM-DD formatted date strings introduces unnecessary overhead. For strings strictly formatted as YYYY-MM-DD, a direct structural string comparison (using operators `<` and `>`) produces the exact same result significantly faster, especially within `Array.prototype.sort()` over large arrays.
**Action:** When sorting dates represented as zero-padded standard formats (like YYYY-MM-DD), use standard string comparison operators (`<`, `>`) instead of `localeCompare` to avoid the performance penalty of localizing strings unnecessarily. To satisfy SonarCloud typescript:S3358, write out `if (b < a) return -1; if (b > a) return 1; return 0;` explicitly rather than nesting ternaries.

## 2026-03-20 - Fast Drizzle ORM Multi-Table Updates
**Learning:** In Drizzle ORM (PostgreSQL), running `.update(table).where(inArray(table.foreign_id, db.select({ id: other_table.id }).from(other_table)))` causes the database to execute a slower nested subquery (N+1 bottleneck) during `UPDATE` operations, significantly slowing down backend performance.
**Action:** Replace `inArray` subqueries with direct relational joins using Drizzle's `.from(other_table)` method in `.update()` queries. Format: `db.update(table).set(...).from(other_table).where(and(eq(table.id, ...), eq(table.foreign_id, other_table.id)))`. Remember to update test mocks to include `from` in the method chain when writing unit tests.

## 2026-03-21 - Consolidate Batch Conditional Updates in Drizzle
**Learning:** Executing sequential database updates in a loop (N+1 pattern) when processing batch logs for different users introduces significant network latency and transaction overhead. Even when using optimized joins, multiple roundtrips to the database are measurably slower than a single bulk operation.
**Action:** To optimize batch conditional updates, collect user-specific authorization and selection criteria into an array of `and()` expressions and execute a single `UPDATE` query using `or(...conditions)` in the `.where()` clause. This reduces the operation to a single database roundtrip while maintaining strict row-level authorization.

## 2024-05-28 - Combine sequential array mapping and filtering
**Learning:** Performing `Array.prototype.map()` followed by `Array.prototype.filter()` results in two O(N) traversals of the array and allocates an intermediate array object that is immediately garbage collected. This is an inefficient pattern, especially when executed frequently (e.g. during render cycles or in high-traffic backend endpoints).
**Action:** Combine sequential mapping and filtering operations into a single O(N) `Array.prototype.reduce()` traversal or a `for...of` loop. This avoids redundant memory allocations and improves runtime performance.

## 2026-03-25 - Avoid O(N) array method allocations within frequent UI loops
**Learning:** Extracting data using chained higher-order array methods like `.map()` which then contain internal loops with `.every()` creates significant memory allocation pressure and excess garbage collection. This happens because these functions instantiate new arrays and anonymous callback functions for every single element processed. When doing this for frequently updated UI components (like drag-and-drop workout editors formatting summaries on change), it causes visible stuttering.
**Action:** Replace `Array.prototype.map` containing `.every` with a single standard `for...of` loop. Allocate a generic array string builder (`const summaries: string[] = []; summaries.push(...)`) and use a standard `for` loop with a `break;` condition instead of `.every()`. This prevents anonymous function allocations entirely and avoids unnecessary O(N) array copies, greatly reducing React hook execution time.## 2026-04-01 - Avoid Multiple O(N) Array Passes during Map Construction\n**Learning:** Constructing a Map using  before passing it into  and then calling  creates excessive intermediate arrays and executes multiple O(N) traversals, unnecessarily straining garbage collection and CPU.\n**Action:** Iterate manually via a `for...of` loop, directly appending items to a locally instantiated `Map` to consolidate iterations and bypass temporary array allocations.

## 2026-04-01 - Avoid Multiple O(N) Array Passes during Map Construction
**Learning:** Constructing a Map using `.filter().map()` before passing it into `new Map(...)` and then calling `Array.from(map.values())` creates excessive intermediate arrays and executes multiple O(N) traversals, unnecessarily straining garbage collection and CPU.
**Action:** Iterate manually via a `for...of` loop, directly appending items to a locally instantiated `Map` to consolidate iterations and bypass temporary array allocations.

## 2026-04-08 - Module-level Caching for React Array Reference Stability
**Learning:** In React, functions like `getFields` that map static keys to arrays and execute on every render (using `.filter()`) allocate new array references constantly. This not only burdens the garbage collector but, more importantly, breaks React memoization in child components that receive these arrays as props, causing unnecessary cascading re-renders.
**Action:** Use a module-scoped `Map` to cache the computed arrays keyed by their static inputs (e.g., `exerciseName`). Also, ensure fallback returns (like default fields) are extracted into module-level `const` arrays. This guarantees true reference stability across all component re-renders while eliminating O(N) recalculations.

## 2026-04-24 - Avoid Multi-Pass Array Traversals
**Learning:** Chaining array methods like `.filter().map()` or `.map().filter().map()` causes the JavaScript engine to iterate over the array multiple times, creating temporary arrays at each step. This adds unnecessary memory allocation and garbage collection overhead, which can degrade performance in hot paths or with large data sets.
**Action:** Replace multiple sequential array methods with a single `for...of` loop or a `.reduce()` when aggregating or transforming data to ensure only one pass is made over the array.
## 2026-04-25 - Drizzle ORM Batch Operations Avoid N+1
**Learning:** In heavily looped backend batch functions (like `processBatchChunk`), executing an individual delete/insert database transaction in a loop causes significant connection overhead. Gathering parameters and using Drizzle ORM's `inArray` combined with bulk inserts (`insert().values(array)`) reduces queries to O(1).
**Action:** When a loop iterates over external IO or database calls, always accumulate results in memory first, then fire a single batch command outside the loop.

## 2026-04-26 - Module-level React Array Caching for getFields
**Learning:** Returning fresh array references derived from `.filter()` or inline literal arrays (e.g., `['reps', 'weight']`) on every call to configuration helper functions like `getFields(exerciseName)` breaks React memoization. When these arrays are passed to child components or dependency arrays, they cause complete re-renders of list items (like `ExerciseRow` and `InlineSetEditor`) even when state hasn't conceptually changed.
**Action:** Use a module-level `Map` cache and module-scoped `DEFAULT_FIELDS` constants to securely memoize and return the same memory references for static configurations. Replace `.filter` with `for...of` internally to remove multiple O(N) Array passes.
