
## 2024-03-30 - Added ARIA labels to Select dropdown triggers
**Learning:** React select components from UI libraries (like Radix UI / shadcn) often require explicit `aria-label`s on their `<SelectTrigger>` elements to be screen reader accessible, as they are typically rendered as `button` elements that might not be easily associated with a visual `<Label>` without strict `htmlFor` / `id` bindings.
**Action:** When adding or auditing `<Select>` components, always ensure the `<SelectTrigger>` has an explicit `aria-label` describing what is being selected if it's not programmatically linked to a label.
