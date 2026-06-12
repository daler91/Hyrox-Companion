## 2023-10-27 - Add tooltip to Back button
**Learning:** Icon-only buttons without tooltips are a common accessibility gap. We should proactively wrap all `size="icon"` buttons in Tooltips. Radix/shadcn tooltips need a full setup (`TooltipProvider`, `Tooltip`, `TooltipTrigger asChild`, `TooltipContent`) to work correctly when isolated.
**Action:** Always check `size="icon"` components for tooltips. When adding them, explicitly include `TooltipProvider` to ensure the context is available.
## 2026-06-12 - Add loading state to TimelineAnnotationCard delete button
**Learning:** For async operations like deleting an annotation, it's crucial to provide immediate visual feedback. Adding a loading spinner to the delete button while disabling it prevents duplicate clicks and keeps the user informed of the ongoing process, improving the perceived performance and reliability of the interface.
**Action:** Always include a visual loading state ( spinner with  class and  attribute) on buttons that trigger asynchronous destructive actions.
## 2024-05-18 - Add loading state to TimelineAnnotationCard delete button
**Learning:** For async operations like deleting an annotation, it is crucial to provide immediate visual feedback. Adding a loading spinner to the delete button while disabling it prevents duplicate clicks and keeps the user informed of the ongoing process, improving the perceived performance and reliability of the interface.
**Action:** Always include a visual loading state (`Loader2` spinner with `animate-spin` class and `disabled` attribute) on buttons that trigger asynchronous destructive actions.
