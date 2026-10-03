# Palette Journal

## 2026-10-03 - Destructive Actions Need Confirm Dialogs Consistently
**Learning:** The codebase has excellent accessibility overall, but the `RetiredFactList` component was the one place where a permanent "Delete forever" action fired without a confirmation dialog. Every other destructive action (delete workout, delete annotation, delete food entry, delete coaching material, purge recycled item) routes through a `ConfirmDialog`. Consistency in destructive-action safety nets is critical — users build mental models from the majority pattern and don't expect one delete button to behave differently.
**Action:** Always check for confirmation dialogs on any destructive action, especially small icon-only buttons where mis-taps are likely on mobile.
