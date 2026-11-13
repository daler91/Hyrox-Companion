# Palette's Journal

## 2026-11-13 - Decorative icons missing aria-hidden pattern
**Learning:** This codebase is exceptionally well-maintained for accessibility — nearly every interactive icon has `aria-hidden="true"`. The pattern that slips through is decorative icons in card headers, empty states, and section headings — places where the icon sits next to visible text and adds no information. The consistent pattern is Lucide icons used as visual accompaniment to headings (`<CardTitle>`) and empty-state illustrations.
**Action:** When adding a new card header or empty-state illustration with a Lucide icon, always include `aria-hidden="true"`. Check empty states and section headers as the first place to look for missing attributes.
