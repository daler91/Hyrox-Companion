# Palette Journal - Critical Learnings Only

## 2026-07-21 - Macro vs Micro a11y inconsistency

**Learning:** MacroProgressBar uses native `<progress>` with aria-label/valuetext, but MicroRow used visual-only divs. When the same UI pattern (progress bar) appears in two components, check that both have matching a11y semantics.
**Action:** When auditing progress indicators, compare all instances across the app — not just the one you're looking at.

## 2026-08-20 - Tailwind opacity modifiers silently break calibrated contrast

**Learning:** The codebase carefully calibrated `--muted-foreground` to pass WCAG AA at 4.61:1 (with comments citing the exact criteria). But 10+ instances of `text-muted-foreground/60` and `/70` reduced this below AA thresholds (~2.4:1 and ~3.0:1). The opacity modifier pattern is invisible to grep-for-color audits because the base variable passes — the violation lives in the Tailwind utility class, not the CSS variable.
**Action:** When a design system calibrates a color token to a specific contrast ratio, search for opacity modifiers (`/40`, `/60`, `/70`, `/80`) on that token across the codebase — they silently undo the calibration. Visual hierarchy on secondary text should come from font-size, not from contrast degradation.
