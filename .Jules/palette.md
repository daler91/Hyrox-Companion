## 2024-05-24 - Accessibility fix for native disabled buttons triggering tooltips
**Learning:** React Testing Library's `.toBeDisabled()` assertion only checks for the native `disabled` HTML attribute. When converting UI buttons to use `aria-disabled="true"` for better tooltip support and screen reader accessibility, tests that rely on `.toBeDisabled()` will fail.
**Action:** When updating a component to use `aria-disabled`, you must also update the corresponding tests to check for the attribute using `.toHaveAttribute('aria-disabled', 'true')` instead of `.toBeDisabled()`.
