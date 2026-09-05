# Palette's Journal — Critical UX/A11y Learnings

## 2026-09-05 - Async button feedback consistency
**Learning:** This codebase has an excellent pattern for async buttons: `disabled={isPending}` + icon swap to `<Loader2 className="animate-spin" />` + text change (e.g. "Saving…"). However, some buttons only implement part of the pattern (disabled but no spinner/text change). When the visual feedback is missing, the user sees the button gray out but gets no indication that work is happening — which feels broken on slow networks.
**Action:** When touching any async-triggering button, verify it has the full trio: disabled state, spinner icon, and pending text. The "Log again" button pattern in MealSection.tsx is the gold standard to follow.
