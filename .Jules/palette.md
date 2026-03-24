## 2026-03-19 - Tooltips on Icon-only Buttons

**Learning:** Native `title` attributes on buttons are often inconsistent across browsers and devices, and lack styling. Relying on them for icon-only buttons creates a poor UX, especially for assistive tech or users who expect immediate feedback.
**Action:** When creating or modifying icon-only buttons, consistently wrap them in the application's design system `Tooltip` components (like Shadcn UI `<Tooltip>`) instead of using the native `title` attribute to ensure accessible, stylable, and responsive labels.
