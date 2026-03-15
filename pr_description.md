🧹 **What**
Fixed a SonarQube `typescript:S1854` code smell by removing an unused destructuring assignment.

💡 **Why**
The variable `weightUnit` was extracted from `useUnitPreferences()` but never used within `TimelineWorkoutCard.tsx`. Removing unused variables improves code maintainability, reduces noise, and resolves the SonarQube finding.

✅ **Verification**
- Verified the removal of `weightUnit`.
- Ensured `weightLabel` and `distanceUnit` (which are used) remain untouched.

✨ **Result**
Code smell resolved without altering existing component functionality.
