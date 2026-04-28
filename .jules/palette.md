## 2026-04-22 - Upgraded native `title` to design system `Tooltip` for Send Message button
**Learning:** Found a button using the native HTML `title` attribute for tooltips (`title="Send message"`) instead of the project's consistent Radix UI / Shadcn `Tooltip` components. Native tooltips lack visual consistency, have delay issues, and behave differently across browsers and operating systems.
**Action:** Always prefer the design system `Tooltip` over native `title` attributes for icon-only buttons to maintain visual polish and predictable accessibility. When converting, ensure `aria-label` remains on the button for screen readers.
## 2026-04-28 - Upgraded native `title` to `Tooltip` for Timeline Exercise Chips
**Learning:** Found that `Badge` components (specifically timeline exercise chips) were using the native HTML `title` attribute to display full exercise summaries. Like buttons, using the native tooltip breaks visual consistency and can cause accessibility issues.
**Action:** Always prefer the design system `Tooltip` over native `title` attributes for Badges or other UI elements that contain truncated text or require additional context on hover.
