# Palette Journal

## 2026-10-11 - title attributes are invisible on mobile PWA
**Learning:** This codebase already has an `ExplanationTooltip` component whose JSDoc documents exactly why `title` attributes are bad for touch/keyboard/SR users. Despite this, `GradeVerdictBadge` was using `title` for its headline — the same anti-pattern the codebase already solved elsewhere. When reviewing for accessibility, search for `title=` on non-interactive elements; they're almost always a mouse-only tooltip that should be a proper `Tooltip`.
**Action:** Grep for `title={` on non-interactive elements (Badge, span, div) as a quick audit. Prefer the Radix `Tooltip` with a focusable trigger for any explanatory text that needs to reach all input methods.
