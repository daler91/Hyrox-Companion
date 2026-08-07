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

## 2026-06-25 - Avoid Math.max(...array) in loops on dynamic arrays

**Learning:** Using `Math.max(...array)` inside a function that parses large sets of data, or on dynamically generated arrays (like those populated in `accumulateSetMetrics`), incurs unnecessary memory allocation overhead for intermediate arrays and risks 'Maximum call stack size exceeded' errors if the dataset grows too large.
**Action:** Track extremum values iteratively within the original processing loop (e.g., using a `maxLoad` variable inside the main `for...of` loop) to maintain O(1) space complexity and eliminate the risk of call stack overflows, rather than collecting all values into an array just to compute the max later.

## 2026-06-26 - Reduce memory overhead from Array.prototype.reduce() in tight loops

**Learning:** Using `Array.prototype.reduce()` to sum or calculate objects (e.g. nutrition macro totals) where the callback instantiates and returns a new object on every single iteration creates significant garbage collection overhead, particularly if called frequently during component re-renders.
**Action:** Replace `reduce()` with an O(N) single-pass `for...of` loop using scoped local variables or a single mutable accumulator object. This drops intermediate object allocations from O(N) to O(1) and eliminates the functional callback overhead per iteration, producing identical results with much less memory pressure.

## 2026-07-09 - Avoid slice and reduce in data processing functions

**Learning:** Using `Array.prototype.slice()` and `.reduce()` to compute aggregates (like averages over array halves) allocates intermediate arrays and incurs unnecessary memory overhead. This is especially impactful in data-heavy components like `ExerciseProgressionCharts`.
**Action:** Replace `slice` and `reduce` with standard `for` loops utilizing start and end index bounds to compute aggregates in a single pass with O(1) space complexity.

## 2026-07-10 - Consolidate redundant array loops

**Learning:** Replacing a single `.map()` or `.reduce()` with a `for` loop is often rejected during code review as an unreadable micro-optimization with no measurable impact. The real performance win comes from identifying multiple iterations over the same data.
**Action:** Always prioritize consolidating multiple redundant iterations over the same array (e.g., two `.reduce()` calls computing different aggregates, like `totalWorkouts` and `totalDuration` in `analyticsService.ts`) into a single `for...of` loop. This tangibly reduces time complexity from O(2N) to O(N).

## 2026-07-19 - Invalid date string parsing and object allocation overhead

**Learning:** Using `new Date(localizedString).getTime()` (like '10:30 AM') within frontend sorting functions can produce `NaN` (Invalid Date), subtly breaking logic while also incurring garbage collection overhead. Additionally, backend fields already parsed by Drizzle ORM as `Date` objects should never be wrapped again in `new Date()`. When only needing numerical comparisons for ISO-8601 strings (YYYY-MM-DD), `Date.parse()` avoids intermediate object allocation.
**Action:** Use raw numerical timestamps (`createdAtMs`) generated at creation instead of parsing localized strings. Call `.getTime()` directly on Drizzle's Date objects. Prefer `Date.parse(str)` over `new Date(str).getTime()` for string dates to reduce memory allocation overhead.

## 2026-08-01 - Avoid chained `.map().filter()` during fast-typing searches

**Learning:** Using chained array iteration methods like `.map().filter()` creates unnecessary intermediate array allocations and causes multiple O(N) traversals. In components like `ExerciseSelector` that update on every keystroke during a search, this overhead becomes pronounced and degrades the responsiveness of the UI.
**Action:** Replace `.map().filter()` chains with a single `for...of` loop and manually push to a result array. This reduces memory pressure by skipping intermediate object allocations and drops time complexity to a single O(N) pass.

## 2026-07-25 - Avoid Premature Micro-optimizations on Small Arrays

**Learning:** Combining chained array methods (like `.filter().map()`) into a single imperative loop is a standard algorithmic optimization (reducing O(2N) to O(N)). However, in React components where the array represents a small subset of local state (e.g., sets within a single exercise block, typically N < 10), the performance gain is essentially zero and unmeasurable. The reviewer pushback highlighted that replacing declarative data transformation patterns with stateful loops degrades code readability for no tangible benefit, violating the rule against unmeasurable micro-optimizations.
**Action:** When identifying array iteration inefficiencies, explicitly evaluate the expected size of N. Only convert declarative chains to imperative loops if the arrays are large enough to cause measurable bottlenecks, or if the chain is called excessively inside a hot render path. For small local state arrays, prioritize code readability over theoretical O(N) reductions.

## 2026-07-27 - [Optimize Date Parsing]

**Learning:** Using `typeof value === 'string' ? Date.parse(value) : value.getTime()` inside commonly called helper functions avoids redundant intermediate `Date` object allocation when parsing ISO string payloads from JSON APIs, reducing overhead.
**Action:** When a function accepts `string | Date`, explicitly use `Date.parse(str)` instead of `new Date(str).getTime()` if only the numerical timestamp is required.

## 2026-08-01 - Drizzle relational `findMany` + in-memory ownership filter = cross-user table scan

**Learning:** Several storage helpers fetched rows by a shared key (date/status), pulled the parent via `with: { plan: {...} }`, and only then filtered ownership in memory (`d.plan?.userId === userId`). Because ownership lives on the _parent_ table, the relational query has no user predicate at all — so a single user's request reads **every** user's rows for that key. It scales with total user count rather than the caller's own data, and it hides in plain sight because the returned result is still correct. Worst case is per-user cron jobs (`getMissedWorkoutsForDate` runs one job per user per day → O(users²) rows across the daily run).
**Action:** When a table is user-scoped only through a parent FK, never express ownership as a post-fetch `.filter()`. Use `db.select().from(child).innerJoin(parent, eq(child.parentId, parent.id)).where(and(eq(parent.userId, userId), ...))` — the pattern `getWeeklyStats` in `server/storage/analytics.ts` already used. Check that `child.parentId` is `.notNull()` first: that makes the inner join provably row-equivalent to the old relational query, so the change is pure perf with no behaviour delta. Grep for `.userId === userId` inside `.filter()` to find more of these.

## 2026-08-02 - An already-fixed N+1 pattern can survive right next to its own fix

**Learning:** `runAnalyticsRecomputeScan` (server/services/analyticsRecomputeScheduler.ts) batches its user lookup with an explicit "avoid N+1" comment, but the sibling function it calls per user, `enqueueStaleRecomputes`, still issued 4 sequential `storage.analyticsResults.get(userId, feature)` calls (one per `ANALYTICS_FEATURES` entry) — an N+1 hiding one call frame below a fix for the exact same bug class, in the same file, on the same loop. Don't assume a file is clean just because it has a "batched to avoid N+1" comment nearby; the fix may not have been applied all the way down the call chain.
**Action:** When scanning a hot loop for N+1s, follow every function it calls (not just the immediate `await`s) and check each one for its own per-item DB round trip. Fixed by adding `AnalyticsResultsStorage.getMany(userIds)` (single `inArray` query) and restructuring the scan to fetch each local-midnight batch's rows once into a `Map<userId, Map<feature, row>>` before the per-user loop, instead of querying per (user, feature) pair.

## 2026-08-03 - Converting an N+1 loop-with-try/catch to a batch fetch can silently widen a failure-isolation guarantee

**Learning:** `runNutritionReminderCron` (server/services/nutrition/reminders.ts) re-fetched each opted-in user with a sequential `storage.users.getUser(id)` call inside a per-user `try/catch`, purely to close a narrow "opted out between scan and send" race — an N+1 identical in shape to the already-fixed ones, but with a subtlety: the per-user `try/catch` also happened to isolate a hard failure in that user's fetch from starving the rest of the batch. Naively batching the fetch with `storage.users.getUsers(ids)` moves that call outside the per-user loop, so a fetch-level failure would now abort the whole tick instead of just one user. It was only safe to do here because the caller (`server/cron.ts`) already wraps the whole cron function in its own try/catch, so a batch failure degrades to "0 reminders sent this tick, retried next hour" — the exact same worst-case outcome as before (when a full DB outage made every sequential `getUser` call fail anyway).
**Action:** Before collapsing a per-item fetch loop into one batched query, check what the per-item `try/catch` was actually protecting against: downstream processing failures (safe to keep isolated, batching the fetch doesn't touch this) vs. the fetch call itself (check whether a caller-level catch already provides an equivalent fallback before removing the per-item isolation). If no outer catch exists, keep the batch fetch inside its own try/catch that logs and returns a safe empty/zero result rather than letting it throw uncaught.

## 2026-08-07 - `new RegExp()` inside a per-suggestion text-cleanup loop

**Learning:** `postProcessSuggestionText` (server/services/aiSafety.ts) is called once per text field (recommendation + rationale) for every AI coach suggestion, but rebuilt six `new RegExp(pattern.source, "gi")` instances from their static source strings on every call instead of reusing compiled patterns — a hot-path regex-recompilation cost that's easy to miss because the array of patterns themselves are already module-level constants (only the "gi" variant was rebuilt per call). Confirmed reuse across calls is safe here because `String.replace` resets a global regex's `lastIndex` to 0 before scanning, so precompiling once at module load and sharing the instances is a pure perf win with no behavioral risk — verified against the existing test asserting repeated-match stripping in one string.
**Action:** When grepping for regex perf issues, don't stop at `.sort()`/`JSON.stringify` patterns already covered — also grep for `new RegExp(` appearing inside a function body (not at module scope) called per-item in a loop. If the pattern only differs by flags from an existing module-level regex, precompile the flagged variant once alongside it instead of re-deriving it on every call.
