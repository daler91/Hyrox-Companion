# Palette Journal

## 2026-11-22 - Exceptional baseline accessibility
**Learning:** This codebase has extraordinarily thorough accessibility coverage. Every icon-only button has an `aria-label` and tooltip. Forms use proper `htmlFor`/`id` pairing. Charts expose `role="img"` with descriptive labels. Skip-to-content links, `prefers-reduced-motion`, and `aria-live` regions for dynamic content are all in place. The `LoadingSpinner` component wraps spinners in `role="status"` live regions per WCAG 4.1.3.
**Action:** Future audits should focus on consistency rather than missing patterns. The few gaps found were inconsistent `aria-hidden` on decorative icons inside labelled buttons, and one spot using a bare `Loader2` instead of the project's `LoadingSpinner`. Check new code against the established patterns rather than hunting for missing categories.
