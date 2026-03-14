🎨 Palette: Add Tooltips to icon-only action buttons

💡 What:
Added `Tooltip` components to two key icon-only buttons:
1. The "Rename Plan" (Pencil icon) button in `TimelineFilters.tsx`.
2. The "Mark Complete" (Circle icon) button in `TimelineWorkoutCard.tsx`.

🎯 Why:
While both buttons had the correct `aria-label` attributes for screen readers, their purpose could be ambiguous for sighted users. The tooltips make the actions immediately clear without relying on guesswork.

📸 Before/After:
Before: Hovering the buttons showed no textual hint.
After: Hovering displays a popover with clear text like "Rename plan" and "Mark [Focus] as complete".

♿ Accessibility:
Ensured the tooltips supplement (rather than replace) the existing `aria-label`s for robust screen reader support.

(Verified the global `<TooltipProvider>` already existed at the `App.tsx` root).
