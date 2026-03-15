🎯 **What**
Extracted a nested ternary operation used for generating `userName` into independent `if-else` statements.

💡 **Why**
This change resolves a SonarQube code smell (`typescript:S3358`: "Ternary operators should not be nested"), which negatively impacted code maintainability and readability. By using a standard `if-else` block, the intent of the logic (falling back sequentially from full name to email to a default string) becomes much clearer and less error-prone.

✅ **Verification**
- Replaced the nested ternary exactly with the user-provided, identical `if-else` logic.
- Ran frontend tests and TypeScript type checking (via `npm run test` and `npm run check`) to ensure no regressions were introduced. Tests passed successfully.
- Conducted a code review to confirm that the changes correctly address the code smell without altering existing functionality.

✨ **Result**
Improved readability and maintainability of the `AppSidebar` component without changing its behavior.
