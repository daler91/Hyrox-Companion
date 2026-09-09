# Palette's Journal — Critical UX/A11y Learnings

## 2026-09-09 - Decorative icons in CardTitle headings inconsistently hidden from screen readers
**Learning:** The codebase has excellent a11y overall, but decorative Lucide icons inside `<CardTitle>` headings on the Settings page were inconsistently marked `aria-hidden`. Some cards (AccountDangerZone, GarminSection, StravaSection, RacePredictorTab) had it; others (7 cards across PushNotificationSection, CoachingSection, ExportDataCard, StructureOldWorkoutsCard, ErrorReportingConsentCard, EmailNotificationsCard, AiCoachCard) didn't. This creates noisy screen reader output on the most-visited settings page.
**Action:** When adding decorative icons alongside heading text, always include `aria-hidden="true"`. Grep for the pattern `<CardTitle...><Icon className="h-5` to catch inconsistencies in future audits.
