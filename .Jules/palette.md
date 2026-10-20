# Palette Journal

## 2026-10-20 - MobileTabBar active state relies heavily on color
**Learning:** The codebase has exceptional accessibility coverage — every icon button has aria-labels, all inputs have labels, focus-visible styles are consistent, destructive actions have confirmations, and prefers-reduced-motion is handled globally. The one subtle gap was the MobileTabBar's active indicator: the difference between active and inactive tabs was color (text-primary vs text-muted-foreground) plus a 0.5px stroke weight change (2.5 vs 2), which is effectively imperceptible. A small pill indicator (bg-primary bar) provides a clear non-color visual cue per WCAG 1.4.1.
**Action:** When adding active states to navigation, always include at least one non-color visual cue that is clearly visible (underline, dot, pill, filled icon) beyond any color change.
