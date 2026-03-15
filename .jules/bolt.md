## 2024-11-20 - Pre-calculate array aggregations in useMemo
 **Learning:** In React components with large datasets, calling O(n) operations like `Array.prototype.some` and `Array.prototype.reduce` multiple times during every render (especially inside the returned JSX) can cause significant performance bottlenecks and slow down rendering.
 **Action:** Pre-calculate these array aggregations inside a `useMemo` hook using a single `O(n)` traversal (e.g., a single `for` loop) and return the aggregated values. This significantly reduces render time for large datasets and avoids unnecessary recalculations.

## 2024-11-20 - Extract static array operations out of React render
**Learning:** In React components, performing O(N) operations like `Object.entries()` followed by `.map()` and `.filter()` directly inside the component body or even inside `useMemo` is inefficient if the source array (`EXERCISE_DEFINITIONS`) and filter criteria are entirely static.
**Action:** Move static array allocations and filtering entirely outside of the component body. This ensures the array is calculated exactly once upon module load, preventing unnecessary re-evaluations and allocations on every render.
