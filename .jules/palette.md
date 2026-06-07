## 2024-06-03 - [Tooltip]
**Learning:** Adding shadcn UI Tooltips around Radix UI RadioGroup components. It is safe and accessible to wrap icon buttons in a `TooltipProvider`, `Tooltip`, `TooltipTrigger asChild` and `TooltipContent` block to add clarity for sighted users without hurting screen reader semantics.
**Action:** When creating icon-only buttons, especially in isolated utility contexts, always consider wrapping them in tooltips for better UX.

## 2026-06-07 - Add tooltips to icon-only buttons
**Learning:** Icon-only buttons (like Edit/Delete in `MealSection`) benefit from tooltips for sighted users. When these buttons are rendered conditionally or within lists, wrapping each `Tooltip` in its own `TooltipProvider` ensures the context is always available and follows Radix UI/shadcn patterns.
**Action:** Always add tooltips to icon-only buttons. If a higher-level `TooltipProvider` isn't guaranteed, wrap the `Tooltip` in its own `TooltipProvider`.
