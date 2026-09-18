## 2024-05-24 - Accessible tooltips on disabled buttons
**Learning:** Using the native `disabled` attribute prevents elements from receiving focus, rendering attached tooltips inaccessible to keyboard users. Wrapping them in a `<span tabIndex={0}>` restores focus but breaks semantic meaning and ARIA associations.
**Action:** Use `aria-disabled` instead of `disabled` on interactive elements that have tooltips, and handle the visual disabled state via CSS (e.g. `aria-disabled:opacity-50 aria-disabled:cursor-not-allowed`) while preventing clicks in the event handler.
