# Palette Journal

## 2026-06-01 - Dialog/Sheet close buttons use focus: instead of focus-visible:
**Learning:** The shadcn Dialog and Sheet primitives shipped with `focus:ring-*` on their close buttons, while every other interactive element in the app uses `focus-visible:ring-*`. This caused a flash of focus ring on mouse clicks for close buttons only — a subtle inconsistency that makes the UI feel unpolished on every modal interaction.
**Action:** When auditing focus states, check shared UI primitives first — a single fix there propagates across the entire app. Always use `focus-visible:` for ring styles on interactive elements; keep `focus:outline-none` to suppress browser defaults.
