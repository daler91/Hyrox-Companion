## 2026-03-19 - Tooltips on Icon-only Buttons
**Learning:** Native `title` attributes on buttons are often inconsistent across browsers and devices, and lack styling. Relying on them for icon-only buttons creates a poor UX, especially for assistive tech or users who expect immediate feedback.
**Action:** When creating or modifying icon-only buttons, consistently wrap them in the application's design system `Tooltip` components (like Shadcn UI `<Tooltip>`) instead of using the native `title` attribute to ensure accessible, stylable, and responsive labels.

## 2024-03-25 - Floating Action Button A11y

**Learning:** When using Floating Action Buttons (FABs) with icons, even if they contain text labels, adding `aria-expanded` (if it toggles a panel) and a `title` attribute greatly improves the UX by explicitly clarifying the current state and providing a native tooltip for pointer-device users.
**Action:** In the future, actively look for icon-driven interactive elements that could benefit from an explicit `title` tooltip and stateful ARIA properties, rather than relying solely on visual or text-only context.
