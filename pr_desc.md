🧪 [testing improvement] Add unit tests for importPlanFromCSV

🎯 **What:** The `importPlanFromCSV` function in `server/services/planService.ts` lacked tests for its plan creation and CSV parsing logic. This gap made refactoring the plan import feature risky.
📊 **Coverage:** The new test suite in `server/services/planService.test.ts` now covers:
- Successful import of a valid CSV, verifying correct mapping to `createTrainingPlan` and `createPlanDays`.
- Error handling for empty CSVs or missing valid rows.
- Error handling for missing or invalid week numbers.
- Fallback logic for handling the "Accessory" header when "Accessory/Engine Work" is missing.
- Default logic for plan naming using `options.planName` and `options.fileName`.
✨ **Result:** Increased unit test coverage for `planService`, ensuring that CSV parsing edge cases and the database interactions via `storage` are correctly validated and reliable.
