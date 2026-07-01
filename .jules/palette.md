## 2023-10-27 - Add tooltip to Back button
**Learning:** Icon-only buttons without tooltips are a common accessibility gap. We should proactively wrap all `size="icon"` buttons in Tooltips. Radix/shadcn tooltips need a full setup (`TooltipProvider`, `Tooltip`, `TooltipTrigger asChild`, `TooltipContent`) to work correctly when isolated.
**Action:** Always check `size="icon"` components for tooltips. When adding them, explicitly include `TooltipProvider` to ensure the context is available.
## 2023-10-27 - Add tooltips to exercise row icon buttons
**Learning:** In reusable functional components mapping arrays, icon-only buttons (`renderGhostIconButton`) can frequently be left out of hover-tooltip contexts while only relying on ARIA labels. Adding local `<TooltipProvider>` wraps directly within the render function fixes accessibility and UX across multiple instances simultaneously, avoiding widespread hunting.
**Action:** Always check helper functions that render icon buttons inside iterative components to ensure they return fully contextualized `Tooltip` setups, not just bare buttons with `aria-label`.
## 2024-02-23 - Add TooltipProvider to standalone icon buttons
**Learning:** Even when `TooltipProvider` is globally defined, standalone or conditionally rendered icon-only buttons (like `ThemeToggle` or sidebar items) should explicitly wrap their tooltips in `TooltipProvider` to ensure the component remains robust and accessible if extracted or used in different contexts.
**Action:** When creating or modifying standalone components with tooltips, verify they include their own `TooltipProvider` rather than relying entirely on global context.
## 2026-06-30 - Wrap remaining icon-only buttons in tooltips
**Learning:** Even when `TooltipProvider` is globally defined, standalone or conditionally rendered icon-only buttons (like `ThemeToggle` or sidebar items) should explicitly wrap their tooltips in `TooltipProvider` to ensure the component remains robust and accessible if extracted or used in different contexts.
**Action:** When creating or modifying standalone components with tooltips, verify they include their own `TooltipProvider` rather than relying entirely on global context.
