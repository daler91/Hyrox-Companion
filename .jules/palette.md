
## 2026-03-12 - Unique IDs for Reusable Form Components
**Learning:** Reusable form components that generate dynamic `<Label>` and `<Input>` pairs (like `ExerciseInput.tsx`) easily cause HTML ID collisions if static strings or index-based IDs are used, breaking screen reader associations. Furthermore, adding new dependencies or modifying core configurations (like `package.json` or `vitest` versions) purely for local test runner satisfaction violates safety constraints.
**Action:** Always use React's built-in `useId()` hook to generate unique `idPrefix`es for reusable form components to ensure robust accessibility. Never attempt to "fix" local `vitest` runner issues by downgrading package major versions or adding unused dependencies, as this pollutes the lockfile and risks CI pipelines.

## 2024-03-14 - Tooltips on Action Buttons
**Learning:** Icon-only action buttons (like "Mark Complete" or "Rename Plan"), even when provided with an `aria-label`, can be ambiguous for sighted users. The intent isn't immediately clear without interacting.
**Action:** When adding new icon-only buttons for primary actions in lists or headers, always wrap them in a `Tooltip` component to improve discoverability alongside the `aria-label` for screen readers. Ensure the global `TooltipProvider` is available up the component tree.
