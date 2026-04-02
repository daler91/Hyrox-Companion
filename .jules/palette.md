## 2026-04-02 - Added `aria-expanded` and `aria-controls` to AI Coach Floating Action Button
**Learning:** Found a missing `aria-expanded` attribute on a button that toggles a side panel. Providing this state is critical for screen reader users to understand if the panel is open or closed.
**Action:** Always check interactive elements that toggle visibility of other elements to ensure they include `aria-expanded` and `aria-controls` attributes.
