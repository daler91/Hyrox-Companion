# Palette's Journal — Critical Learnings

## 2026-09-08 - Landing page a11y is the gap in an otherwise exemplary codebase
**Learning:** The app's authenticated surfaces have near-perfect `aria-hidden` coverage on decorative icons (icon-only buttons always carry `aria-label` + `aria-hidden` on the SVG, and every Radix dialog, toast, and sheet close button is labeled). The landing page sections (Features, HowItWorks, ExerciseShowcase, NutritionShowcase) were the one consistent gap — decorative icons next to text headings were missing `aria-hidden="true"`. Hero and CtaFooter already followed the pattern correctly, suggesting the middle sections were written at a different time.
**Action:** When new landing page sections are added, check decorative icons for `aria-hidden="true"` — the app-side pattern is strong, but landing content doesn't go through the same component wrappers (TooltipTrigger, Button with aria-label) that enforce it automatically.
