# Technical Debt Registry

> Living document cataloging known technical debt in the Hyrox-Companion codebase.
> Last audited: 2026-04-04

---

## ~~P0 — Quick Wins~~ (RESOLVED)

> All P0 items resolved on 2026-04-04.

- ~~**1. Remove unused `aiService.ts` re-export wrapper**~~ — Deleted file, updated 4 importers.
- ~~**2. Move Gemini model names to environment config**~~ — Added to `env.ts` with defaults.
- ~~**3. Replace `console.log` with structured logger**~~ — Not needed: `env.ts` is pre-logger boot (intentional), scripts are standalone CLI tools where console is appropriate.
- ~~**4. Fix weak `isStreamData` type guard**~~ — Added `!Array.isArray` and property existence checks.
- ~~**5. Route all `process.env` access through `env.ts`**~~ — Fixed in 3 production files.
- ~~**6. Consolidate timeout constants**~~ — Already centralized in `server/constants.ts`. No action needed.

---

## ~~P1 — High Priority~~ (5/6 RESOLVED)

- ~~**7. Replace Proxy-based storage abstraction**~~ — Replaced with explicit `DatabaseStorage` class delegating ~60 methods.
- ~~**8. Fix migration naming conflict**~~ — Renamed to `0016_rename_hyrox_station_to_functional.sql`, added to Drizzle journal. Note: `server/maintenance.ts` startup SQL still needs converting to Drizzle migrations (deferred — requires DB testing).
- ~~**9. Remove legacy RAG path**~~ — Deleted unused `buildRetrievedMaterialsSection` from ragService.ts. Added sanitization to the active `buildRetrievedChunksSection` in prompts.ts.
- ~~**11. Formalize API error codes (infrastructure)**~~ — Created `AppError` class with `ErrorCode` enum in `server/errors.ts`. Updated Express error handler. Fixed dynamic logger imports in workoutService.ts. Note: incrementally migrating 28 `throw new Error` to `throw new AppError` is ongoing.
- ~~**12. Re-enable CI quality gates**~~ — Replaced empty SonarQube job with ESLint + TypeScript checking CI steps.

### 10. Add Drizzle relations, remove manual JOINs
- **Files:** `server/storage/*.ts`, `shared/schema.ts`
- **Issue:** Drizzle ORM is used without its relations API. Storage layer has manual SQL JOINs that are verbose, error-prone, and don't benefit from Drizzle's type-safe query builder.
- **Fix:** Define Drizzle relations in the schema and refactor queries to use the relational query API.
- **Effort:** 2-3 days
- **Status:** Deferred — requires DB access for testing.

---

## ~~P2 — Medium Priority~~ (5/6 RESOLVED)

- ~~**13. Refactor oversized files (partial)**~~ — Extracted Timeline.tsx IIFE into named `TimelineContent` component. Remaining: sidebar.tsx (775 lines, likely shadcn/ui vendor), prompts.ts (412 lines), Landing.tsx (495 lines).
- ~~**15. Reduce GeneratePlanDialog state complexity**~~ — Extracted 10 useState calls into `useGeneratePlanForm()` hook.
- ~~**17. Migrate email scheduler to pg-boss queue**~~ — Cron now enqueues per-user `send-weekly-summary` and `send-missed-reminder` jobs. Workers registered in `queue.ts`.
- ~~**18. Propagate request ID / tracing context to service layer**~~ — Added `AsyncLocalStorage`-based `requestContext.ts` with middleware. `getContextLogger()` returns child logger with request context.
- ~~**25. Strict mode disabled in test TypeScript config**~~ — Enabled `strict: true` in `tsconfig.test.json`. Tests now enforce the same type safety as production code.

### 14. Centralize magic numbers and constants
- **Files:** `client/src/components/plans/GeneratePlanDialog.tsx`, `client/src/hooks/useChatSession.ts`, `server/services/workoutService.ts`
- **Issue:** Configuration values are defined locally in individual files.
- **Status:** On review, these constants are correctly colocated with their usage (plan constants in plan dialog, chat limits in chat hook, concurrency in workout service). Moving to a shared file would be over-engineering. Downgraded to no-action.

- ~~**16. Improve test type safety (partial)**~~ — Created `test/factories.ts` with 5 typed mock factories. Refactored `workouts.test.ts` (7 casts) and `planService.test.ts` (5 casts). Remaining: 2 client-side test files can be migrated incrementally using the same factories.

---

## P3 — Low Priority / Ongoing

- ~~**24. Hardcoded CORS origins**~~ — Moved to `ALLOWED_ORIGINS` env var with backward-compatible fallback.
- ~~**26. Silent data loss in offline mutation queue**~~ — Added `onMutationDropped` callback with `useOfflineDropNotifier` hook showing destructive toast on data loss.
- ~~**27. No route guards for authenticated pages**~~ — Added auth loading guard in `App.tsx` showing spinner while auth state loads.
- ~~**28. Full pdfjs-dist namespace import**~~ — Changed to targeted `{getDocument, GlobalWorkerOptions}` import.

- ~~**19. Resolve dependency security overrides**~~ — Documented all 4 overrides with CVE/GHSA IDs, parent dependency info, and removal conditions. Fixed esbuild range inconsistency. Found `serialize-javascript` is removable now, `undici` safe to remove on next lockfile regen.

- ~~**20. Persistent rate limiter**~~ — Documented limitation and Redis upgrade path in `server/routeUtils.ts`. Acceptable for single-instance Railway deployment.

- ~~**21. Improve PWA offline strategy**~~ — Added Workbox runtimeCaching: NetworkFirst for API (10s timeout), CacheFirst for fonts (1yr), StaleWhileRevalidate for images (30d).

### 22. CSRF protection assessment
- **Files:** `server/index.ts`, `server/clerkAuth.ts`
- **Issue:** The app uses cookie-based auth (`credentials: "include"`) via Clerk, which is CSRF-vulnerable in principle.
- **Mitigations already in place:** CORS with explicit origin allowlist rejects cross-origin requests. Clerk uses SameSite cookies by default. CSP with nonce prevents inline script injection.
- **Remaining risk:** Low. A same-site CSRF attack would require XSS first (mitigated by CSP). Consider adding `csrf-csrf` middleware if the threat model changes.
- **Status:** Documented. No immediate action needed.

### 23. Performance optimizations
- **Files:** `server/services/ai/aiContextService.ts`, `server/services/workoutService.ts`
- **Issues:**
  - RAG retrieval is not cached between requests — identical context lookups repeat vector searches
  - Auto-coach is triggered per workout instead of batched via cron
- **Note:** Email cron sync processing is resolved (#17 — migrated to pg-boss).
- **Fix:** Add short-TTL cache for RAG results. Use pg-boss `singletonKey` for auto-coach debouncing.
- **Effort:** 1-2 days

---

## Summary

| Priority | Resolved | Remaining | Notes |
|----------|----------|-----------|-------|
| P0 — Quick Wins | 6/6 | 0 | All resolved |
| P1 — High | 5/6 | 1 | #10 (Drizzle relations) deferred — needs DB |
| P2 — Medium | 5/6 | 1 | #16 (test mocks) is ongoing/incremental |
| P2 — Medium | 6/6 | 0 | All resolved (some partial/incremental) |
| P3 — Low | 7/10 | 3 | #22 (CSRF, low risk), #23 (perf, monitoring-driven), #13 (remaining large files) |
| **Total** | **24/28** | **4** | Remaining items are deferred, incremental, or architecture-dependent |
