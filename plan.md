1. **Fix missing `aria-hidden="true"` on decorative icons and remove native `title` attributes on UI elements in `client/src/components/ui/sidebar.tsx`**
   - In `SidebarTrigger`, the `PanelLeftIcon` is missing `aria-hidden="true"`. Since the button contains a `<span className="sr-only">Toggle Sidebar</span>`, the icon is purely decorative and should be hidden from screen readers.
   - In `SidebarRail`, there is a native `title="Toggle Sidebar"` attribute. As noted in `palette.md` (2026-10-07), native `title` attributes are an accessibility anti-pattern in this mobile-first PWA because they do not render on touch devices. Since `SidebarRail` already has `aria-label="Toggle Sidebar"`, the `title` attribute should simply be removed.

   - *Alternative consideration: The `SidebarRail` is an invisible 4px wide drag handle / click target on the edge of the screen. A native tooltip popping up when resting the mouse there is annoying and unnecessary, so removing it improves both UX and a11y.*

2. **Run tests & linting**
   - Run `pnpm lint` and `pnpm test` to ensure changes didn't break anything.

3. **Commit and create PR**
   - Create PR with title '🎨 Palette: Improve accessibility of sidebar toggle elements' and follow the required description format.
