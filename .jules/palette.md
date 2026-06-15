## 2023-10-27 - Add tooltip to Back button
**Learning:** Icon-only buttons without tooltips are a common accessibility gap. We should proactively wrap all `size="icon"` buttons in Tooltips. Radix/shadcn tooltips need a full setup (`TooltipProvider`, `Tooltip`, `TooltipTrigger asChild`, `TooltipContent`) to work correctly when isolated.
**Action:** Always check `size="icon"` components for tooltips. When adding them, explicitly include `TooltipProvider` to ensure the context is available.
## 2023-10-27 - Add tooltips to exercise row icon buttons
**Learning:** In reusable functional components mapping arrays, icon-only buttons (`renderGhostIconButton`) can frequently be left out of hover-tooltip contexts while only relying on ARIA labels. Adding local `<TooltipProvider>` wraps directly within the render function fixes accessibility and UX across multiple instances simultaneously, avoiding widespread hunting.
**Action:** Always check helper functions that render icon buttons inside iterative components to ensure they return fully contextualized `Tooltip` setups, not just bare buttons with `aria-label`.
