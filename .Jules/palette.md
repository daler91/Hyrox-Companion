## 2026-09-23 - Add Tooltip to Purge Button
**Learning:** Icon-only buttons in dense data rows like Recycle Bin often lack explicit context for destructive actions and aren't focusable when using native `disabled`, making tooltip explanations inaccessible.
**Action:** Consistently replace `disabled` with `aria-disabled` and manage visual states via Tailwind (`aria-disabled:opacity-50 aria-disabled:cursor-not-allowed`) for isolated icon buttons that need a tooltip. Wrap them in a local `<TooltipProvider>` for the tooltip to render and be accessible even when "disabled".
