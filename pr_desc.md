🎯 **What:** The `buildTrainingContext` function in `server/services/aiService.ts` was entirely missing test coverage. This function is crucial for preparing user context data before passing it to the AI for generating insights or plans, making it highly dependent on proper `storage` interactions.

📊 **Coverage:** A new test suite `server/services/aiService.test.ts` was implemented. Scenarios covered include:
- Base case (empty database/no timeline data) returning a default context with zeroed stats.
- Accurate calculations of basic training statistics (`totalWorkouts`, `completedWorkouts`, `completionRate`) using mocked timeline data.
- Correct calculation of the `currentStreak` using mocked system dates to avoid flaky timeline evaluations.
- Proper collection and date-sorting of `recentWorkouts`, ensuring a hard cutoff length of 10 workouts.
- Correct computation of `structuredExerciseStats` containing max weights, max distances, best times, and average reps based on simulated `getExerciseSetsByWorkoutLogs` returns.
- Accurate selection of the `activePlan` from the mock storage module.
- Proper parsing of `focus` fields using the `HYROX_EXERCISES` constants to formulate the `exerciseBreakdown`.

✨ **Result:** Enhanced test coverage for `aiService.ts`. The business logic for `buildTrainingContext` is now firmly verified and isolated from actual database interactions, ensuring regressions can be quickly caught when modifying workout aggregation logic in the future.
