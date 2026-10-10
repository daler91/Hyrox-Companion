# Palette Journal

## 2026-10-10 - Decorative icons in text+icon buttons need aria-hidden
**Learning:** This codebase consistently marks icons `aria-hidden` in icon-only buttons (size="icon"), but the same pattern was inconsistently applied to decorative icons inside text+icon buttons. Without `aria-hidden`, screen readers may announce the SVG icon alongside the visible text label, producing noisy output like "chevron left Back" instead of just "Back". The pattern was most common in wizard navigation (Back/Next), empty states, and settings dialogs.
**Action:** When adding an icon to a button that also has a visible text label, always include `aria-hidden` on the icon. The icon is decorative — the text is the accessible name.
