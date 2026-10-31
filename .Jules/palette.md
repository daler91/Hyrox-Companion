# Palette's Journal

## 2026-10-31 - Input component errorMessage prop is unused codebase-wide
**Learning:** The `Input` UI primitive has a built-in `errorMessage` prop that wires `aria-invalid`, `aria-describedby`, and a `role="alert"` error paragraph automatically. Despite being well-implemented, no consumer in the codebase used it before this session. The codebase pattern is to disable submit buttons for invalid forms but show no inline field-level validation. `MafTestForm` is the exception, implementing its own manual `aria-invalid` + error paragraph pattern.
**Action:** When adding inline validation to forms, prefer the `Input` component's `errorMessage` prop over manually wiring `aria-invalid`/`aria-describedby`. It keeps the a11y wiring correct and consistent. Apply it form by form where the UX benefit is highest (dialogs with required fields that silently disable their submit button).
