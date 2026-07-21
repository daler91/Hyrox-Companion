# Palette Journal - Critical Learnings Only

## 2026-07-21 - Macro vs Micro a11y inconsistency
**Learning:** MacroProgressBar uses native `<progress>` with aria-label/valuetext, but MicroRow used visual-only divs. When the same UI pattern (progress bar) appears in two components, check that both have matching a11y semantics.
**Action:** When auditing progress indicators, compare all instances across the app — not just the one you're looking at.
