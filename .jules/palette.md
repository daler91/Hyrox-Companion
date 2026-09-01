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
## 2025-02-19 - Accessible Close Buttons for Dialog & Sheet
**Learning:** Found that `Dialog` and `Sheet` close buttons had visually hidden `<span>` tags for screen readers (`sr-only`), but lacked a native `aria-label`. Replacing the `sr-only` span with an `aria-label` attribute on the button component is cleaner and a more standard accessibility pattern for icon-only components.
**Action:** Always favor `aria-label` directly on interactive components for screen-reader text over injecting hidden `<span>` elements, simplifying the DOM tree while maintaining the exact same accessibility mapping.

## 2026-07-15 - Snappier Tooltips
**Learning:** The default Radix UI tooltip delay (700ms) is too slow for web applications that heavily rely on icon-only buttons. This delay causes a sluggish feel when users hover over icons expecting immediate feedback.
**Action:** When configuring tooltip providers for icon-dense UIs, explicitly set `delayDuration={200}` to make the interface feel much more responsive and intuitive.

## Merged from .Jules/palette.md (case-collision cleanup)


## 2026-06-01 - Dialog/Sheet close buttons use focus: instead of focus-visible:
**Learning:** The shadcn Dialog and Sheet primitives shipped with `focus:ring-*` on their close buttons, while every other interactive element in the app uses `focus-visible:ring-*`. This caused a flash of focus ring on mouse clicks for close buttons only — a subtle inconsistency that makes the UI feel unpolished on every modal interaction.
**Action:** When auditing focus states, check shared UI primitives first — a single fix there propagates across the entire app. Always use `focus-visible:` for ring styles on interactive elements; keep `focus:outline-none` to suppress browser defaults.

## 2026-06-17 - Select/Badge/Toast components use focus: instead of focus-visible:
**Learning:** Similar to the Dialog close buttons, the Select, Badge, and Toast components from shadcn were shipped with `focus:ring-*` classes rather than `focus-visible:ring-*`. This causes an inconsistent, distracting flash of the focus ring when interacting with these elements via mouse.
**Action:** When styling focus states on interactive elements and shared UI primitives, always use `focus-visible:ring-*` (combined with `focus:outline-none`) instead of `focus:ring-*`. This ensures keyboard accessibility while preventing jarring focus ring flashes on mouse clicks.

## 2026-07-20 - Adding Tooltips to header/navigation mobile toggle buttons
**Learning:** Top-level navigation toggle buttons, like the mobile hamburger menu icon, often rely solely on `aria-label`. While screen-reader accessible, these icon-only buttons can be ambiguous to sighted users who use a mouse on smaller devices (or resized windows).
**Action:** Consistently ensure that even primary layout and header navigation icon buttons use a complete Tooltip wrap, utilizing a snappy `delayDuration={200}` and `asChild` on Radix buttons, maintaining visual clarity for all users without breaking underlying refs.

## 2026-08-15 - aria-hidden audit must cover all rendering contexts, not just buttons
**Learning:** A prior `aria-hidden` pass fixed icons in plain `<Button>` components but missed icons inside `<Badge>` components (status badges on every timeline card), icons in conditional ternary expressions (`isRefreshing ? <Loader2> : <RefreshCw>`), and icons in icon-only buttons where one variant (disabled) had `aria-hidden` but the active variant did not. Grep-for-`<Button>`-plus-icon catches the obvious cases; the tail is badges, dropdown menu items, and conditional renders.
**Action:** When auditing a class of a11y attributes (like `aria-hidden` on decorative icons), search for the icon component itself (`className="h-4 w-4 mr-2" />`) rather than the parent container. This catches icons in every rendering context — badges, menu items, conditional branches, and icon-only buttons — not just the ones inside `<Button>`.
## 2026-08-09 - Enforce 200ms tooltip delay
**Learning:** The default custom `TooltipProvider` has a globally snappy `delayDuration` of 200ms. Overriding this value locally (e.g., `delayDuration={300}`) breaks consistency and makes UI interactions feel sluggish and unpolished.
**Action:** Rely on the custom default `TooltipProvider` without specifying `delayDuration` manually unless there is an exceptional and documented reason to override the global standard.
## 2026-08-18 - Tooltip for WeeklyReviewPrompt Dismiss Button
**Learning:** The "Dismiss" button on prompt banners, even when clear to screen readers via aria-label, needs a text tooltip for sighted mouse users relying on visual hover context.
**Action:** When wrapping an icon-only button like `X` with a tooltip in a complex layout like a `CardContent` header, ensure `TooltipProvider` wraps locally to guarantee context.
## 2024-05-15 - Tooltips on disabled buttons
**Learning:** Radix UI disables pointer events on disabled elements, which breaks tooltips for disabled buttons.
**Action:** Wrap disabled trigger elements in a `<span>` with `tabIndex={disabled ? 0 : -1}` to ensure the tooltip continues to fire and remains keyboard accessible.

## 2026-07-21 - Macro vs Micro a11y inconsistency

**Learning:** MacroProgressBar uses native `<progress>` with aria-label/valuetext, but MicroRow used visual-only divs. When the same UI pattern (progress bar) appears in two components, check that both have matching a11y semantics.
**Action:** When auditing progress indicators, compare all instances across the app — not just the one you're looking at.

## 2026-08-20 - Tailwind opacity modifiers silently break calibrated contrast

**Learning:** The codebase carefully calibrated `--muted-foreground` to pass WCAG AA at 4.61:1 (with comments citing the exact criteria). But 10+ instances of `text-muted-foreground/60` and `/70` reduced this below AA thresholds (~2.4:1 and ~3.0:1). The opacity modifier pattern is invisible to grep-for-color audits because the base variable passes — the violation lives in the Tailwind utility class, not the CSS variable.
**Action:** When a design system calibrates a color token to a specific contrast ratio, search for opacity modifiers (`/40`, `/60`, `/70`, `/80`) on that token across the codebase — they silently undo the calibration. Visual hierarchy on secondary text should come from font-size, not from contrast degradation.

## 2026-08-29 - Same chip component, different action semantics

**Learning:** `FoodChipRow` was reused for both Favorites (one-tap immediate log) and Recent (opens dialog) chips. Visually identical buttons with different consequences are invisible to screen readers — the section title (`<p>`) isn't formally associated with the button group, so navigating by interactive element strips all context. The `aria-label` only fired for truncated names, leaving short-named foods with zero action context.
**Action:** When a generic chip/tag component is reused across rows with different onClick behaviors, always pass a distinguishing verb into the aria-label (e.g. "Quick log" vs "Add") — don't rely on surrounding heading text that screen readers skip during button-mode navigation.
