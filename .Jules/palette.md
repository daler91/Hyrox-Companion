## 2024-05-24 - Improve tooltip accessibility for disabled buttons
**Learning:** To make tooltips accessible on disabled buttons, avoid wrapping them in a focusable <span> which breaks semantic meaning and ARIA associations. Instead, replace native disabled with aria-disabled, manage visual state with Tailwind (aria-disabled:opacity-50 aria-disabled:cursor-not-allowed), and prevent default on click.
**Action:** Always use this pattern for tooltips on disabled interactive elements.
