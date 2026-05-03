## 2026-05-02 - Wrap DropdownMenuTrigger with Tooltip
**Learning:** Icon-only DropdownMenu triggers should be wrapped with TooltipTrigger and TooltipProvider to provide accessible tooltips to users, enhancing discoverability.
**Action:** Use the `<TooltipProvider><Tooltip><TooltipTrigger asChild><DropdownMenuTrigger asChild><button>...</button></DropdownMenuTrigger></TooltipTrigger><TooltipContent>...</TooltipContent></Tooltip></TooltipProvider>` pattern for icon-only dropdown menus.
