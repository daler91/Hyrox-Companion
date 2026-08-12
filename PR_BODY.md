🎯 **What:** Added tests for the pure synchronous functions `makeBlockId` and `getBlockExerciseName` inside `blockHelpers.ts` to address a testing gap.

📊 **Coverage:** Covered all critical paths and edge cases, including normal IDs, multiple `__` separators, the `custom:` prefix, and inputs without separators.

✨ **Result:** Test coverage for these helper functions is now established, ensuring future refactoring won't silently break ID generation and extraction logic.
