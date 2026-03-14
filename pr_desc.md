🧪 [testing improvement] Add E2E tests for complex timeline and logging workflows

🎯 What
Added two new Cypress end-to-end test files to cover the full workout submission flow and complex timeline interactions:
- `log-workout-submission.cy.ts`: Verifies successful submission of both free-text mode and exercise mode workouts, and checks error states for missing data.
- `timeline-workout-details.cy.ts`: Verifies interactions with the timeline detail dialog, including marking workouts complete/missed, editing details, and deleting workouts.

📊 Coverage
- Real-world interaction flows that go beyond simple element existence checks.
- Form submissions intercepted properly with mocked API responses.
- Timeline dialog interactions, actions, and UI state updates.

✨ Result
Significantly increased confidence that the core user flows (logging a workout and interacting with the timeline) work correctly without regressions, addressing the previous lack of functional E2E test coverage in these critical areas.
