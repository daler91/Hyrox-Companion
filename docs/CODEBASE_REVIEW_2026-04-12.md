# Codebase Review — April 12, 2026

## Review passes executed
1. **Pass 1 (Security):** authn/authz boundaries, secrets, CSRF/CORS/CSP, idempotency, token handling, AI output sanitisation, SSRF, dependency overrides.
2. **Pass 2 (Business analysis):** README parity, Hyrox-specific domain modelling, feature creep, monetisation, user-story completeness.
3. **Pass 3 (UX / Accessibility):** navigation flow, error/loading states, keyboard + screen-reader support, contrast, mobile + touch targets, chart a11y.
4. **Pass 4 (Performance):** client bundle + renders, TanStack Query cache behaviour, API call shape, memory leaks, N+1, SSE backpressure, pgvector + pg-boss tuning.
5. **Pass 5 (QA / Edge cases):** empty/null/large inputs, network failures, double-clicks, race conditions, timezone, offline sync, test coverage gaps.
6. **Pass 6 (DevOps / Infrastructure):** error handling + logging, env validation, health checks, graceful shutdown, rate-limit scaling, CI/CD hygiene, observability.
7. **Pass 7 (Data privacy):** PII at rest + in transit, retention, export completeness, third-party data flows (Gemini/Strava/Resend/Sentry), consent, HSTS, COPPA/GDPR posture.

---

## Executive Summary

HyroxTracker is a mature TypeScript monorepo (React + Express + PostgreSQL + Gemini AI) with strong security foundations (Clerk auth, CSRF double-submit, AES-256-GCM for tokens, Zod validation, 750+ tests) and good recent reliability work (bounded health probe, idempotent-only retries, Railway-internal SSL detection). The most load-bearing gaps are in:

- **Privacy** — PII (email, name, biometrics) is plaintext at rest while only OAuth tokens are encrypted; Sentry lacks a `beforeSend` PII scrubber; Gemini flows lack a documented training/retention opt-out; the GDPR Article 15 export is incomplete.
- **Product scope** — README promises a *Hyrox-specific* 8-week programme and analytics, but `samplePlan.ts` is a generic functional-fitness template and the schema has no Hyrox-station model; meanwhile a Garmin Connect integration ships as undocumented scope creep.
- **Accessibility** — the onboarding dialog can't be dismissed, Recharts visualisations lack ARIA / loading states, and required form fields aren't marked.

No finding is a shipping catastrophe, but several items should be closed before moving beyond a single-tenant pilot.

### Severity convention

- **Critical** — must fix before shipping to a broader audience (security, privacy, WCAG A blockers, or product/README truthfulness gaps).
- **Warning** — should fix soon; degraded UX, hidden failure modes, scaling cliffs.
- **Suggestion** — nice to have; polish, coverage, or belt-and-braces hardening.

---

## Critical Findings (must fix before shipping)

| # | Category | Finding | File(s) | Recommended Fix |
|---|----------|---------|---------|-----------------|
| 1 | Privacy | PII stored plaintext at rest: email, name, heart rate, power, workout notes. Only Strava/Garmin tokens encrypted. | `shared/schema/tables.ts:24-126` | Column-level AES-256-GCM on email/name/biometrics, or DB-level TDE. |
| 2 | Privacy | No `beforeSend` Sentry hook to scrub PII from error payloads (bodies, query, user emails in validation errors). | `server/index.ts:40-45` | Add `beforeSend` that strips `req.body` / `req.query` / PII-bearing headers. |
| 3 | Privacy | Data export omits chat messages, coaching materials, AI usage logs, custom exercises, biometrics — violates GDPR Art. 15. | `server/services/exportService.ts:38-64` | Extend export to include all user-owned tables. |
| 4 | Privacy | Gemini calls lack opt-out of model training / retention for user prompts containing training history. | `server/gemini/chatService.ts`, `server/gemini/exerciseParser.ts` | Use enterprise Gemini keys (no-train), or document DPA, or add retention disclosure. |
| 5 | Security | CSP `connectSrc` declared but not merged into initial Helmet directive — override middleware creates a window where the restrictive CSP is served. | `server/index.ts:201-253` | Merge `connectSrc` directly into Helmet's initial directive object; remove override. |
| 6 | Security | Coaching material content allows 1.5 M chars × 2 MB JSON body — DoS vector via RAG chunking/embedding. | `server/routes/coaching.ts:19-20`, `server/index.ts:271` | Lower max; rate-limit by size + per-user quota before enqueueing `embed-coaching-material`. |
| 7 | Business | README claims "built-in 8-week **Hyrox** program" but `samplePlan.ts` is generic functional fitness; schema has no Hyrox-station modelling. | `server/samplePlan.ts:1-65`, `shared/schema/enums.ts` | Redesign sample plan around the 8 stations; add `HyroxStation` enum and optional `station` field on `ExerciseSet`. |
| 8 | Business | Garmin Connect integration (`server/garmin.ts`, `server/services/garminMapper.ts`, `garminConnections` table) is undocumented — not in README, no public routes. | `server/garmin.ts`, `shared/schema/tables.ts:150-170` | Either finish + document or delete. |
| 9 | UX / a11y | Onboarding dialog has `onOpenChange={() => {}}` — cannot be dismissed by Esc or backdrop; traps keyboard users (WCAG 2.1 A). | `client/src/components/OnboardingWizard.tsx:99` | Allow Esc/backdrop to dismiss or treat as "skip". |
| 10 | UX / a11y | Charts (Recharts) lack `role="img"` / `aria-label`; `MiniLineChart` returns `null` with no empty/loading state; no field-level `required` markers. | `client/src/components/analytics/MiniLineChart.tsx:62`, `GeneratePlanDialog`, `LogWorkout` | Add aria-labels, chart skeleton component, `*` markers on required inputs. |
| 11 | Performance | `pdfjs-dist` (~2.5 MB) + `mammoth` (~300 KB) eagerly imported in coaching settings — blocks FCP/LCP for all users. | `client/src/components/settings/coaching/useCoachingUpload.ts:1-2` | Dynamic `import()` only inside the upload handler; lazy-load hook via `React.lazy`. |
| 12 | Performance | Unbounded Gemini parallelism on bulk workout parse — large imports fan out 100+ concurrent calls, exhausting quota. | `server/services/workoutService.ts:84`, `server/gemini/exerciseParser.ts` | Wrap in `pLimit(3)` (dep already present). |
| 13 | QA | AI parse accepts empty string (returns `[]` silently) and defaults `response.text || "[]"` — swallows Gemini failures as empty success. | `server/gemini/exerciseParser.ts:19,64`, `server/routes/ai.ts:20` | Early-return on empty input; throw on falsy `response.text`. |
| 14 | DevOps | In-memory rate limiter (`express-rate-limit` `MemoryStore`) — correct per-instance, breaks globally as soon as Railway scales beyond one replica. | `server/index.ts:425` | Swap to `rate-limit-redis` before horizontal scaling. |

## Warnings (should fix soon)

| # | Category | Finding | File(s) | Recommended Fix |
|---|----------|---------|---------|-----------------|
| 15 | Security | Idempotency cache only stores 2xx, TTL 24 h — later legitimate 4xx bypasses cache; excessive TTL. | `server/middleware/idempotency.ts:8,42,59` | Cache all terminal responses; drop TTL to ~1 h, per-endpoint override for mutations. |
| 16 | Security | `STRAVA_STATE_SECRET` falls back to random at boot — multi-instance breaks OAuth CSRF state verification. | `server/strava.ts:25-27` | Require in prod via env schema `refine`. |
| 17 | Security | Dev-auth bypass header `x-test-no-bypass` is guessable; should be gated on `NODE_ENV==="test"`. | `server/clerkAuth.ts:90` | Gate strictly on `NODE_ENV==="test"`. |
| 18 | Security | AI output validation is regex-based — entity-encoding / Unicode evasion trivially bypasses. | `server/utils/sanitize.ts:40-45` | Replace with library-based sanitiser (DOMPurify-equivalent on server) + content moderation. |
| 19 | Privacy | No HSTS header (Helmet defaults don't set it). | `server/index.ts:222-240` | `hsts: { maxAge: 31536000, includeSubDomains: true, preload: true }`. |
| 20 | Privacy | Push subscription endpoints/keys stored plaintext. | `shared/schema/tables.ts:302-312` | Encrypt `endpoint` / `p256dh` / `auth` or rotate on logout. |
| 21 | Privacy | No data-retention jobs for chat messages, coaching materials, plans — indefinite storage. | `server/cron.ts:38-72` | Add N-day purge jobs + user-controlled settings. |
| 22 | Privacy | Onboarding has no privacy/ToS acceptance step and no cookie consent banner. | `client/src/components/onboarding/*`, `client/src/pages/Privacy.tsx` | Add consent step + banner. |
| 23 | UX / a11y | Drag handles (dnd-kit) have no documented keyboard alternative or `aria-label` on `GripVertical`. | `client/src/components/workout/SortableExerciseBlock.tsx:37` | Add keyboard sensor, `aria-label`, or Move up/down buttons. |
| 24 | UX / a11y | `text-muted-foreground` on light backgrounds near WCAG AA contrast floor. | Multiple (`OfflineIndicator`, `RagDebugBadge`, skeletons) | Audit with WebAIM; prefer `text-gray-600` for secondary text. |
| 25 | UX / a11y | Modal focus restoration unverified on `GeneratePlanDialog` / `EditWorkoutDialog`. | `client/src/components/plans/*`, `client/src/components/timeline/*` | Explicit focus return via Radix `onCloseAutoFocus`. |
| 26 | UX / a11y | Touch targets on some icon buttons are <44 px. | FAB + small icon buttons | Bump to `p-2.5` / `p-3`. |
| 27 | Performance | Analytics queries have no per-query `staleTime` — every tab toggle re-fetches 3 endpoints. | `client/src/lib/queryClient.ts:162`, `ExerciseProgressionTab.tsx:28-43` | Add `staleTime: Infinity` with mutation-driven invalidation. |
| 28 | Performance | SSE consumer lacks backpressure; relies on `rAF` flush, which couples to refresh rate. | `client/src/lib/sseStream.ts:83-102` | Fixed ~100 ms flush interval; pause reader when buffer exceeds threshold. |
| 29 | Performance | Batch dedup missing in `embed-coaching-material` / `auto-coach` workers — N+1 per duplicate `materialId`. | `server/queue.ts:72-75` | Dedup by `materialId` before batch dispatch. |
| 30 | QA | CSV plan import silent on malformed rows; no size/row-count guard. | `server/services/planService.ts:70-78` | Hard cap on content length + explicit non-empty validation after parse. |
| 31 | QA | No client `isPending` disable on mutation submits — rapid double-clicks rely entirely on server idempotency. | `useWorkoutActions.ts`, `usePlanImport.ts` | Disable buttons while `mutation.isPending`. |
| 32 | QA | Workouts stored UTC; client renders without user TZ preference — midnight boundary bugs. | Routes returning `createdAt` | Add `timezone` user pref; render in local TZ. |
| 33 | QA | Exercise set schema allows `reps: 0`, negative weight; only RPE bounded. | `shared/schema/types.ts` | Add `.min(0)` (or `.min(1)` on reps) to exercise set schema. |
| 34 | DevOps | `post-migration.yml` hardcodes dummy 32-char `ENCRYPTION_KEY` in workflow — brittle, leaks in logs. | `.github/workflows/post-migration.yml:35,41` | Load from a separate CI-only secret; reject hardcoded keys in linter. |
| 35 | DevOps | Graceful shutdown runs `queue.stop` + `pool.end` under a single 30 s timeout — no per-stage budget. | `server/index.ts:455-461` | Budget: queue 10 s → HTTP 5 s → pool 8 s. |
| 36 | DevOps | `RESEND_API_KEY` missing → emails silent no-op while API returns 200. | `server/index.ts:355-357` + email routes | Fail fast at boot or surface 503 on email-dependent routes in prod. |
| 37 | DevOps | Sentry lacks breadcrumbs on DB/queue/Gemini circuit-breaker state; errors arrive contextless. | `server/index.ts`, `server/gemini/circuitBreaker.ts` | Add breadcrumbs + tags (`gemini.circuit-breaker`, `pg-boss.job`). |

## Suggestions (nice to have)

| # | Category | Finding | File(s) | Recommended Fix |
|---|----------|---------|---------|-----------------|
| 38 | Business | No monetisation or per-user usage quotas — unclear sustainability. | — | Define freemium tier; add `usageCounts` tracking AI/plan imports. |
| 39 | Business | Weekly email summary not rich (no 1RM trends, missed-by-station, RPE trend). | `server/emailTemplates.ts`, `emailScheduler.ts` | Enrich with analytics payload. |
| 40 | Security | Request-ID regex permits colons — log-injection adjacency. | `server/index.ts:291-296` | Restrict to `/^[a-zA-Z0-9._-]{1,36}$/`. |
| 41 | Security | No SSRF guard on user-influenced URLs (e.g. links inside coaching docs fetched server-side). | — | Validate against private IP ranges before any server fetch. |
| 42 | Security | `CSRF_SECRET !== ENCRYPTION_KEY` only checked in prod. | `server/env.ts:45-50` | Enforce in all environments. |
| 43 | UX / a11y | Breadcrumbs/page hierarchy indicator absent across pages. | `client/src/pages/*` | Small breadcrumb component on non-landing pages. |
| 44 | UX / a11y | Charts render all 52 weeks even when 10 visible — virtualise with `@tanstack/react-virtual` (already a dep). | `TrainingOverviewTab.tsx` | Virtualise bar/line series. |
| 45 | Performance | Cache CSRF token per session rather than re-fetch on 403. | `client/src/lib/csrf.ts` (or equiv) | TTL cache; single 403 retry triggers refresh. |
| 46 | Performance | Add `Cache-Control: public, max-age=300` on analytics endpoints (complement Workbox NetworkFirst). | `server/routes/analytics.ts`, `personal-records` | Set headers. |
| 47 | QA | Test coverage thin for Strava sync, email queuing, CSV import integration. | `test/`, `server/__tests__` | Add integration tests. |
| 48 | QA | Voice input (`useVoiceInput.ts`) silently disabled on iOS Safari — no capability warning. | `client/src/hooks/useVoiceInput.ts` | Surface message when `!isSupported`. |
| 49 | DevOps | Readiness probe should assert queue-accepting status distinct from liveness. | `server/index.ts` health routes | Split `/healthz` (live) vs `/readyz` (ready + queue). |
| 50 | Privacy | No COPPA/age gating in onboarding. | Onboarding flow | Ask DOB or age-≥13 affirmation. |
| 51 | Privacy | No audit log for deletions, exports, consent changes. | — | Append-only audit table. |

---

## Pass-by-Pass Detail

### 1. Security Audit — 6/10

Core posture is solid: Drizzle prevents SQL injection, no command-injection sinks, Clerk-protected routes, CSRF double-submit, AES-256-GCM for Strava/Garmin tokens, per-endpoint rate limits, idempotency middleware.

**Note on a false-positive:** the security sub-agent flagged `.env` as "committed to the repository." This was verified and is **incorrect** — `.env` is listed in `.gitignore` and `git log --all --full-history -- .env` shows no history. Only `.env.example` is tracked. The agent had read the local-only `.env` and assumed it was in version control.

Genuine issues are the CSP override gap (#5), the RAG content-size DoS vector (#6), the weak regex-based AI output sanitiser (#18), the short-lived random Strava state secret (#16), the 24 h idempotency TTL that only caches 2xx (#15), and the absence of SSRF guards (#41). No SQL injection, no XSS sinks observed server-side.

### 2. Business Analysis — 6/10

The product–README gap is the real issue: the README sells a "Hyrox 8-week program" and "Hyrox training companion," but `samplePlan.ts` is generic functional fitness and the schema has no `HyroxStation` concept (#7). Garmin Connect exists as server/schema/crypto code without routes, README mention, or tests (#8) — either unfinished feature leak or dead code to prune. No monetisation or quota logic anywhere (#38). The weekly email is a shell without the rich analytics the README implies (#39). Core CRUD, RAG, Strava, export, and PWA work — technically complete for the genre, but mis-marketed as Hyrox-specific.

### 3. UX / Accessibility — 6.5/10

Radix + shadcn give a decent a11y baseline. The hard blockers are: onboarding dialog can't be dismissed (#9), charts have no ARIA or loading state (#10), no required-field indicators, no breadcrumbs (#43). Drag handles lack a keyboard alternative (#23). `text-muted-foreground` contrast flirts with the AA floor (#24). Touch targets on small icons are below 44 × 44 (#26). Modal focus restoration isn't explicit (#25). Empty states are handled well on Timeline but inconsistently elsewhere. Dark mode is in good shape.

### 4. Performance — 7/10

Worst single win is unblocking FCP by lazy-loading `pdfjs-dist` + `mammoth` (#11). Analytics tab-switching refetches everything (#27). Bulk workout parse has no Gemini concurrency limit (#12) despite `p-limit` already being a dep. SSE backpressure is unhandled (#28); rAF flushing couples to refresh rate. Batch job workers don't dedup by `materialId` (#29). Positive notes: compression middleware correctly excludes SSE, pgvector uses HNSW per docs, Workbox PWA caching is in place.

### 5. QA / Edge Cases — 7/10

Two silent-failure paths stand out: empty text to Gemini returns `[]` with no marker, and `response.text || "[]"` swallows null responses as valid empty parses (#13). CSV import is lenient on malformed content with no size guard (#30). Exercise-set schema lets `reps: 0` / negative weights through (#33). Workout timestamps are timezone-naive on the client (#32). Double-click prevention relies entirely on server idempotency (#31). Voice input falls back silently on iOS Safari (#48). Test coverage is "wide but shallow": 80+ test files but light on Strava sync / email / CSV import integration paths (#47).

### 6. DevOps / Infrastructure — 7.5/10

Strongest pass. Recent commits (bounded health probe, probe client cleanup, idempotent-only retries, Railway-internal SSL detection) closed the obvious reliability gaps. Remaining items: the in-memory rate limiter will break under multi-replica scaling (#14), the shutdown timeout is monolithic (#35), Resend failures are silent (#36), Sentry lacks breadcrumbs (#37), and the post-migration workflow hardcodes a dummy key in logs (#34). No secrets-rotation documentation. Readiness vs liveness are conflated (#49).

### 7. Data Privacy — 6/10

The most load-bearing section. PII (email, name, biometrics) is plaintext at rest while tokens are AES-GCM — an inconsistent threat model (#1). Sentry has `sendDefaultPii: false` but no `beforeSend` hook, so error bodies/queries may still leak (#2). Gemini flows lack a documented opt-out of training/retention (#4). GDPR export is incomplete (#3). No HSTS (#19), no cookie banner or consent step in onboarding (#22), no retention jobs for chats/plans/docs (#21), push tokens plaintext (#20). US-only processors (Gemini/Strava/Resend/Sentry) with no visible DPA/SCC inventory. No COPPA gating (#50).

---

## Score Summary

| Category | Score (1-10) | Notes |
|----------|:---:|-------|
| Security | 6 | Strong primitives; CSP override, RAG DoS, regex-based AI sanitiser remain. A "`.env` committed" sub-agent claim was verified false. |
| Business Analysis | 6 | Feature list honest for a fitness app but not Hyrox-specific; Garmin is undocumented scope creep; no monetisation. |
| UX / Accessibility | 6.5 | Radix foundation is good; undismissable onboarding + chart a11y + required markers block WCAG 2.1 AA. |
| Performance | 7 | Eager heavy deps + missing `staleTime` + unbounded Gemini fan-out are the three-line fix list. |
| QA / Edge Cases | 7 | Solid async/idempotency work; silent-failure paths around AI parse and CSV import remain. |
| DevOps / Infrastructure | 7.5 | Recent reliability work visible; rate-limit store and shutdown budgeting are next. |
| Data Privacy | 6 | PII encryption, retention, Gemini training opt-out, export completeness, HSTS all need work before EU rollout. |
| **Overall** | **6.6** | Production-ready for a single-tenant pilot; privacy, product-scope truthfulness, and onboarding a11y warrant fixing before public launch. |
