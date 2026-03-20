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
