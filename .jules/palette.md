
## 2026-03-12 - Unique IDs for Reusable Form Components
**Learning:** Reusable form components that generate dynamic `<Label>` and `<Input>` pairs (like `ExerciseInput.tsx`) easily cause HTML ID collisions if static strings or index-based IDs are used, breaking screen reader associations. Furthermore, adding new dependencies or modifying core configurations (like `package.json` or `vitest` versions) purely for local test runner satisfaction violates safety constraints.
**Action:** Always use React's built-in `useId()` hook to generate unique `idPrefix`es for reusable form components to ensure robust accessibility. Never attempt to "fix" local `vitest` runner issues by downgrading package major versions or adding unused dependencies, as this pollutes the lockfile and risks CI pipelines.
