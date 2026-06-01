## 2026-05-02 - Wrap DropdownMenuTrigger with Tooltip
**Learning:** Icon-only DropdownMenu triggers should be wrapped with TooltipTrigger and TooltipProvider to provide accessible tooltips to users, enhancing discoverability.
**Action:** Use the `<TooltipProvider><Tooltip><TooltipTrigger asChild><DropdownMenuTrigger asChild><button>...</button></DropdownMenuTrigger></TooltipTrigger><TooltipContent>...</TooltipContent></Tooltip></TooltipProvider>` pattern for icon-only dropdown menus.

## 2026-05-29 - Added tooltips to icon-only buttons in EditableWorkoutTitle
**Learning:** Icon-only buttons (like Edit, Save, Cancel) lack accessible labels for sighted users who may not immediately recognize the icons.
**Action:** Always wrap standalone icon-only buttons with `Tooltip` components to provide clear, actionable labels on hover or focus, improving both usability and discoverability.
