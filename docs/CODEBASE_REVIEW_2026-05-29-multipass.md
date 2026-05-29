# Code Review Report — Hyrox-Companion (fitai.coach) — Multi-Pass Audit

**Generated:** 2026-05-29
**Branch reviewed:** `codex/fix-sonar-analytics-cleanups`
**Method:** Seven specialized review passes (security, business, UX/a11y, performance, QA, DevOps, privacy) executed in parallel by isolated reviewer agents.

> **Note.** This report is a *separate* multi-pass audit run on the same date as
> `CODEBASE_REVIEW_2026-05-29.md` (which has since been fully remediated across
> PRs #1290–#1297). It is not a re-issue of that report; it is a deeper, persona-driven
> sweep that surfaced a number of additional findings (notably privacy/retention,
> observability, RAG indexing, timezone handling, and AI-output XSS) that were outside
> the scope of the earlier baseline. Findings should be triaged against current `main`
> before action — some may already be partially addressed by the recent remediation PRs.

## Executive Summary

The codebase is a well-architected, privacy-conscious React 18 + Express + PostgreSQL/pgvector PWA with strong foundational hygiene (Zod-validated env, AES-256-GCM at-rest encryption for Garmin, CSRF double-submit, Helmet+CSP, Drizzle cascade integrity, advisory-lock'd cron, structured Pino logging). However, three categories of risk remain before scaled production deployment: (1) **AI-output XSS via unsanitized react-markdown rendering**, (2) **OAuth credential gaps** (Strava tokens stored unencrypted, no Garmin revocation on account delete, no AI-key redaction in logger), and (3) **observability/operability holes** (per-instance rate limiting, no Sentry release tagging or sourcemap upload, missing pgvector HNSW index, no data-export endpoint despite privacy-policy promise). Overall this is a mature, ship-ready codebase with a small number of high-impact fixes blocking GA.

## Critical Findings (must fix before shipping)

| # | Category | Finding | File(s) | Recommended Fix |
|---|----------|---------|---------|-----------------|
| C1 | Security / Privacy | Strava OAuth `accessToken` and `refreshToken` stored **plaintext** while Garmin credentials are encrypted — inconsistent threat model | `shared/schema/tables.ts:181-182`, `server/storage/users.ts:239` | Apply `encryptToken()` to Strava tokens at storage boundary, mirroring Garmin |
| C2 | Security | XSS via `ReactMarkdown` rendering AI output without HTML sanitization or `rehype-sanitize`/DOMPurify — compromised provider or prompt-injection yields client-side JS execution | `client/src/components/ChatMessage.tsx:44`, `client/src/components/analytics/CoachInsightsTab.tsx` | Add `rehype-sanitize` (or sandboxed iframe with `CSP: default-src 'none'`); explicitly set `allowDangerousHtml: false` |
| C3 | Privacy | Sentry `beforeSend` strips `request.user.email`/IP but **does not redact `breadcrumbs` or `contexts`**, which carry full workout/chat request bodies to a US processor | `server/bootstrap/observability.ts:20-38` | Extend `beforeSend` to scrub breadcrumbs + contexts; consider `attachStacktrace:false` |
| C4 | Privacy | Account deletion does **not revoke Garmin OAuth tokens** with Garmin (Strava deauth is best-effort; Garmin has no equivalent), violating GDPR Art. 17 full-erasure intent | `server/routes/account.ts:56-66` | Call Garmin revocation endpoint pre-delete; log success/failure |
| C5 | Privacy | Chat messages persist **indefinitely** with no TTL; full training context (every workout) sent to AI provider on every chat turn | `shared/schema/tables.ts:467-477`, `server/services/aiContextService.ts:28-29`, `server/routes/ai.ts:104,227` | Add configurable chat-history TTL + cleanup cron; cache training context per user (5–10 min) and only re-fetch on workout mutation; summarize history older than 30 days |
| C6 | Privacy | Privacy policy promises CSV/JSON data export but **endpoint does not exist** — violates GDPR Art. 15/20 | `client/src/pages/Privacy.tsx:153-155` (no matching route) | Implement `/api/v1/export` returning a zip of profile, workouts, plans, chat history, connections metadata, AI usage logs |
| C7 | Performance | Sequential awaits in weekly email scheduler — `getWeeklyStats` then `getTimeline` double the per-user job latency | `server/emailScheduler.ts:32-33` | Wrap in `Promise.all` |
| C8 | Performance | No pgvector HNSW index — RAG retrieval is O(n) sequential scan after cache miss | `server/services/ragService.ts:200+`, `migrations/*` | Add migration: `CREATE INDEX idx_document_chunks_embedding_hnsw ON document_chunks USING hnsw (embedding vector_cosine_ops) WITH (m=16, ef_construction=64);` |
| C9 | DevOps | Sentry init missing `release` tagging and sourcemap upload — production stack traces show minified `dist/` lines | `server/bootstrap/observability.ts:15-39`, CI workflows | Inject `release: "${pkg.version}-${COMMIT_SHA}"`; add `sentry-cli releases files upload-sourcemaps` CI step |
| C10 | QA / Correctness | Weekly summary cron uses `new Date().getDay()` with no timezone context — fires on wrong day for non-UTC users; users have no `userTimezone` field at all | `server/emailScheduler.ts:18-27`, `shared/schema/tables.ts` (users) | Add `userTimezone` (IANA) to users table; convert all "this week" / "Monday" math against user-local time |

## Warnings (should fix soon)

| # | Category | Finding | File(s) | Recommended Fix |
|---|----------|---------|---------|-----------------|
| W1 | Security | AI provider API keys (`openAiCompatibleApiKey`, `anthropicApiKey`) absent from pino redact list — accidental config-object log leaks keys | `server/ai/providers/config.ts:63-75`, `server/logger.ts` | Add `*.openAiCompatibleApiKey`, `*.anthropicApiKey` to redact patterns |
| W2 | Security | Custom AI base URL (`AI_TEXT_BASE_URL`) validated as URL but not against private/loopback ranges — SSRF risk if operator misconfigures | `server/ai/providers/config.ts:70` | Reject `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `::1`, `fc00::/7` |
| W3 | Security | Per-instance rate limiting (Postgres-backed but window-per-instance) — multi-replica Railway scale multiplies effective limits | `server/rateLimitStore.ts`, `server/index.ts:413-415` | Migrate to a shared store (Redis or a true global Postgres bucket via `SELECT FOR UPDATE`) or document single-instance constraint |
| W4 | Security | SSE deadline relies on `controller.abort()` — hung clients keeping the socket open past `SSE_MAX_DURATION_MS` are not force-closed | `server/routes/ai.ts:116-145` | Fallback `res.socket.destroy()` after grace period |
| W5 | Security / QA | File upload pre-parser validation reads only 4–5 magic bytes; oversized binary disguised as DOCX hits mammoth/pdfjs | `client/src/components/settings/coaching/useCoachingUpload.ts:59-78`, `server/index.ts` parser limits | Pre-validate file size per MIME, add parser timeouts; reject if advertised content-type ≠ magic |
| W6 | Privacy | Single `ENCRYPTION_KEY`, no key versioning or rotation — compromise = retroactive decrypt of all Garmin/(post-fix) Strava credentials | `server/crypto.ts:35-36,74-76` | Tag ciphertexts with key ID, add background re-encrypt job |
| W7 | UX / A11y | `Textarea` lacks `errorMessage`/`aria-invalid` API; form-level errors fall back to generic toasts (no field-level feedback) | `client/src/components/ui/textarea.tsx`, `EditWorkoutDialog.tsx`, `LogWorkoutForm` | Mirror `Input`'s error API on `Textarea`; map server validation errors onto fields |
| W8 | UX / A11y | Streaming chat error states use `aria-live="polite"`; abort/network errors announced too late | `client/src/components/coach/CoachPanelChatArea.tsx`, `client/src/hooks/useChatSession.ts:37-47` | Use `aria-live="assertive" aria-atomic="true"` for stream-error suffix |
| W9 | UX / A11y | Animations (`animate-bounce`, `animate-spin`, transitions) not gated by `prefers-reduced-motion` | global CSS + multiple components | Add `@media (prefers-reduced-motion: reduce)` global rule or use Tailwind `motion-safe:` |
| W10 | Performance | Chat history `useQuery` lacks per-query `staleTime/gcTime`; re-fetches on every route change | `client/src/hooks/useChatSession.ts:175` | `{ staleTime: Infinity, gcTime: Infinity }` (invalidate on send) |
| W11 | Performance | Missing composite index for analytics plan-day range scans | `server/services/analyticsService.ts:88-91`, `migrations/*` | `CREATE INDEX idx_plan_days_plan_scheduled ON plan_days (plan_id, scheduled_date DESC);` |
| W12 | Performance | pg-boss `JOB_TIMEOUT_MS=50min` < `expireInMinutes=60` — long DB hang inside the timeout leaks a pool slot until pg-boss reaps | `server/queue.ts:64-90`, `server/db.ts` | Set Drizzle/PG `statement_timeout` to ~45m so the connection is freed before pg-boss reschedules |
| W13 | Performance | RAG cache evicts by insertion order, not LRU — hot keys can be dropped under churn | `server/services/ragService.ts:194-199` | Track `lastAccessedAt`; evict by staleness |
| W14 | QA | SSE stream abort race: client disconnect + reconnect during slow generation can produce duplicate flushes in chat state | `server/routes/ai.ts:153-250`, `client/src/hooks/useChatSession.ts` | Track stream generation ID on client; ignore flushes from stale streams |
| W15 | QA | Circuit-breaker probe leaves `probeInFlight=true` if the probe call itself hangs — breaker stuck open until cooldown | `server/gemini/circuitBreaker.ts:20-87` | Wrap probe with `AbortSignal` + `setTimeout`; always clear in `finally` |
| W16 | QA | Advisory unlock errors are logged but lock isn't force-released — subsequent sync requests can stall until session reap | `server/advisoryLock.ts:44-53` | `pg_advisory_unlock_all()` fallback in `finally`, or raise to alert on unlock failure |
| W17 | QA | Email cron enqueues based on Sunday-UTC snapshot of preferences; user opting out mid-week still receives queued email | `server/emailScheduler.ts:14-16,72-74` | Re-check preferences at job execution time and short-circuit |
| W18 | QA | No `version`/`updatedAt` optimistic-lock on exercise sets — concurrent edits last-write-wins silently | `server/storage/workouts.ts`, `shared/schema/tables.ts` | Add row version, return 409 on mismatch |
| W19 | QA | Zod schemas accept negative/zero weights and distances; only formatters guard | `shared/schema/zod.ts`, exercise-set schemas | Add `.nonnegative()` and `.positive()` where semantically required |
| W20 | DevOps | Sentry/circuit-breaker state is in-process; on restart the breaker resets to "closed" regardless of provider health | `server/gemini/circuitBreaker.ts:25-28` | Persist breaker counters to Postgres or Redis, restore on boot |
| W21 | DevOps | Health endpoint runs two DB probes per call with no caching — costly on high-frequency liveness checks | `server/bootstrap/health.ts:45-67` | Cache result 2–5s, or split readiness/liveness so liveness is cheap |
| W22 | DevOps | No documented Neon/Postgres backup, PITR, or DR runbook | repo docs | Add `docs/operations/backup-restore.md` with RTO/RPO + restore drill cadence |
| W23 | Business | `mafHr` field exists in schema but no service computes it; MAF onboarding collects inputs that never produce the derived ceiling | `server/routes/preferences.ts:16-36`, `shared/maf.ts` | Implement `computeMafHeartRateZone(age, consistency, trend)` and persist on PATCH |
| W24 | Business | AI consent gate enforced per-route by chain ordering, but no compliance test asserts every AI-burning endpoint actually invokes `aiConsentCheck` before provider | `server/middleware/aiConsent.ts`, `server/routes/ai.ts`, `coachingMaterials` routes | Add a route-introspection test that iterates the Express stack and asserts the middleware is present on each AI endpoint |
| W25 | Business | `AI_FEATURES_ENABLED` kill switch only checked in budget middleware — provider clients have no defensive check | `server/middleware/aibudget.ts:21`, `server/gemini/client.ts`, `server/ai/providers/*` | Add gate at provider entrypoint as defense-in-depth |
| W26 | Business / Privacy | Unit conversion bidirectionality not asserted on export paths | `server/routes/workoutsExport.routes.ts` (not verified), analytics CSV | Confirm export normalizes by user `weightUnit`/`distanceUnit`; add a test |

## Suggestions (nice to have)

| # | Category | Finding | File(s) | Recommended Fix |
|---|----------|---------|---------|-----------------|
| S1 | Security | No webhook signature verification surfaces for Strava push or Resend events (Clerk webhooks not wired) | `server/routes/*` | If webhooks added later, verify HMAC / Svix signatures before processing |
| S2 | Security | Userid logged on every request at info level — high-volume PII in log sinks | `server/logger.ts:56` | Demote to debug/error scope |
| S3 | A11y | Mobile touch targets at `size="sm"`/`size="icon"` below WCAG 2.5.5 (44×44px) on dense surfaces (SuggestionCard, dialog controls) | `client/src/components/ui/button.tsx:31-37`, `SuggestionCard.tsx:72-94` | Add `h-11 w-11` on mobile breakpoint for primary touch targets |
| S4 | A11y | `document.title` static across routes — no orientation cue for AT users | `client/src/App.tsx` | `useEffect` per page setting `"<Page> — fitai.coach"` |
| S5 | A11y | Voice input button/status indicators lack explicit `aria-label`/`role="status"` | `client/src/components/VoiceFieldButton.tsx`, `CoachReviewingIndicator.tsx` | Add labels + live regions for listening state changes |
| S6 | A11y | Skip-to-content link present but no visible focus styling | `client/src/App.tsx:178-180`, base CSS | Add `:focus { top: 0 }` (or `focus:not-sr-only` Tailwind) so it pops into view |
| S7 | Performance | Embedding deduplication not implemented — identical pasted text re-embeds (cost) | `server/services/ragService.ts:141-162` | Hash chunk text and dedupe before API call |
| S8 | Performance | Heavy client deps (`pdfjs-dist`, `mammoth`, `recharts`) — verify they are route-split, not in main bundle | `vite.config.ts`, route boundaries | Wrap upload page + analytics charts in `React.lazy` if not already; check rollup output report |
| S9 | QA | EventSource unsupported on Safari iOS <16.4 — no feature-detection banner | `client/src/lib/sseStream.ts` | `if (typeof EventSource === 'undefined')` → warn + force polling fallback |
| S10 | QA | Idempotency middleware caches only 2xx — `404`s replay-execute, masking transient lag | `server/middleware/idempotency.ts:68-70` | Document semantics; consider caching `4xx` with short TTL for DELETE |
| S11 | Privacy | No granular per-processor consent (only `aiCoachEnabled`) — Sentry/Resend cannot be opted out independently | `shared/schema/tables.ts:42`, Settings UI | Add `consentSentry`, `consentEmailMarketing` flags; gate sends |
| S12 | Privacy | No age gate / COPPA / GDPR Art. 8 parental-consent flow | onboarding | Add age declaration; flag minors for parental-consent flow |
| S13 | Privacy | AI provider DPAs / data-retention behavior not documented in privacy policy or README | `client/src/pages/Privacy.tsx:84-86`, `README.md` | List Gemini/Anthropic/OpenAI retention & sub-processor commitments with links |
| S14 | Privacy | MCP server connections not mentioned in privacy policy despite README hinting at them | `client/src/pages/Privacy.tsx` | Add MCP integration section if shipping MCP |
| S15 | Privacy | Garmin 2SV not supported — users must temporarily weaken Garmin security to sync | `shared/schema/tables.ts:196-197` | Surface explicit warning in connection UI; document in FAQ |
| S16 | Privacy | Add `upgrade-insecure-requests` CSP directive (HSTS already on via Helmet) | `server/index.ts` (helmet config) | Augment CSP |
| S17 | DevOps | No `Cache-Control` strategy explicit for `dist/assets/*` (immutable) vs `index.html` (no-cache) | `server/static.ts`, `vite.config.ts` | Set `public, max-age=31536000, immutable` for hashed assets; `no-cache` on `index.html` |
| S18 | DevOps | Cron lock TTL not surfaced; on PG advisory failure, jobs may stall | `server/cron.ts:37-47`, `server/advisoryLock.ts` | Log lock acquire/release durations; alert on >N seconds |
| S19 | DevOps | No W3C trace-context propagation across pg-boss boundaries — errors in async jobs lose request lineage in Sentry | `server/queue.ts`, `server/logger.ts` | Carry `traceparent` through job payload |
| S20 | DevOps | Build script lacks post-build sanity check | `script/build.ts`, `railway.toml:3` | Verify `dist/index.js` exists and is >50KB; fail loud otherwise |
| S21 | Business | No empty-state fixtures / smoke tests for "fresh user, zero workouts" or "ended-plan, no next" UX | `test/factories.ts`, page tests | Add fixtures; assert analytics/timeline endpoints return sensible defaults |
| S22 | Business | Plan rollover lacks a coach suggestion when `endDate <= today` and no next plan | `server/services/aiSuggestionService.ts` (or equivalent) | Emit "Plan complete. Ready to start a new one?" suggestion |
| S23 | Business | Deleted plan leaves `workout.planId = null` orphans — UI handling not verified | `shared/schema/tables.ts:139-140`, timeline components | Smoke-test orphan rendering |

## Pass-by-Pass Detail

### Security Audit

**Strengths.** CSRF double-submit cookies, Helmet+CSP, encrypted Garmin credentials (AES-256-GCM via `server/crypto.ts`), Zod-validated env (`server/env.ts`), exhaustive dependency overrides (full CVE rationale documented in `package.json` `//overrides`), per-user advisory locks for Strava/Garmin sync, dev-bypass double-guarded against production.

**Highest-impact gaps.**

1. **AI output XSS (C2):** `ReactMarkdown` rendered without `rehype-sanitize` is a single-LLM-prompt-injection step from arbitrary client-side JS.
2. **Strava token encryption gap (C1):** Inconsistent with Garmin's encryption; equally sensitive long-lived OAuth.
3. **Logger redaction (W1):** AI API keys not in the redact patterns; one stray `logger.info(config)` leaks provider credentials.
4. **SSRF from custom AI base URL (W2):** Operator-misconfig path; trivial to guard.
5. **Rate limiting per-instance (W3):** Will silently multiply allowances on multi-replica scale.

The `//overrides` block in `package.json` is a model: every advisory documented with rationale, CVE ID, and exit condition. Maintain this practice.

### Business Analysis

The product surface matches the README's "Hyrox/hybrid athlete training app" claim — no scope drift detected. All advertised features (timeline, structured logging, plan import/AI generation, RAG, Strava/Garmin sync, MAF mode, weekly email summaries, AI consent gate, account deletion) are wired end-to-end.

**Real gaps:**

- `mafHr` is collected but never computed (W23) — MAF onboarding effectively a no-op for the derived ceiling.
- No timezone awareness anywhere — Mon-Sun week boundaries and "missed yesterday" reminders use server UTC (C10).
- No user-facing data-export endpoint despite policy promise (C6).
- No subscription/pricing signal anywhere — clarify whether this is intended (free-only or pre-monetization).

The schema-level user isolation (every storage query includes `eq(table.userId, userId)`) and cascade FK chains (`shared/schema/tables.cascade.test.ts`) are excellent. Privacy-first defaults (`aiCoachEnabled=false`, `emailNotifications=false`) are correctly implemented.

### UX / Accessibility

Foundation is strong — Radix primitives, jest-axe tests on key components, skip-to-content link, focus management on dialogs. Highest-leverage fixes are:

- Extending `Textarea` to match `Input`'s error API (W7) — currently no path for field-level errors on multi-line inputs.
- Asserting `aria-live="assertive"` on stream-error suffixes (W8) — current "polite" misses interruption.
- `prefers-reduced-motion` global rule (W9) — quick win for vestibular safety.
- Per-route `document.title` (S4) — orientation for AT users.

DnD-kit reorder flows (timeline) need keyboard hints + `role="status"` drop announcements (S5-adjacent).

### Performance

The hot paths have already been instrumented — `script/timeline-benchmark.ts`, virtualized timeline via `@tanstack/react-virtual`, image compression in `client/src/lib/image.ts`, vendor chunk splitting. Remaining easy wins:

1. **`Promise.all` in weekly scheduler (C7)** — 2-line fix, halves email-cron latency.
2. **HNSW index on `document_chunks.embedding` (C8)** — biggest backend correctness/perf risk because the cache miss falls onto a sequential scan.
3. **Composite `(plan_id, scheduled_date DESC)` index (W11)** — covers the hottest analytics range scan.
4. **Chat history query staleTime (W10)** — eliminates refetch storm.
5. **PG `statement_timeout` < pg-boss `expireInMinutes` (W12)** — prevents pool-slot leak under tail latency.

### QA / Edge Cases

Test surface is broad (235+ `.test.ts` files plus Cypress + smoke vitest configs) — but the highest-risk flows (SSE abort/reconnect, circuit-breaker probe hang, advisory-lock unlock failure, email-prefs race, Garmin concurrent sync, optimistic locking on workout edits) are underexercised. Add tests around:

- Stream gen-ID guards (W14).
- Probe timeout `finally` reset (W15).
- Unlock failure recovery (W16).
- Negative/zero metric guards (W19).

Timezone & DST is the largest category-wide gap (C10) — touches scheduler, analytics, plan rollover, "this week" math.

### DevOps / Infrastructure

Production-ready for a single Railway instance with the stack as-is: env validation rejects misconfigured secrets, graceful SIGTERM handlers drain pools and SSE, advisory-lock'd cron jobs, queue-depth telemetry, OpenAPI snapshot CI, drizzle migrations gated in CI.

Pre-scale blockers:

- **Sentry release + sourcemaps (C9)** — without these, every production stack trace is unreadable.
- **Per-instance rate limiting (W3)** — first horizontal scale silently multiplies limits.
- **DR / backup runbook (W22)** — no documented restore drill cadence.
- **In-process circuit-breaker state (W20)** — restart resets to closed regardless of upstream health.

Defense-in-depth on `CSRF_SECRET`/`ENCRYPTION_KEY` cross-validation in `server/env.ts` is good; consider similar pairing for VAPID rotation.

### Data Privacy

Privacy-first defaults, encrypted Garmin credentials, AI consent gate, account deletion with FK cascade — strong foundation. Critical gaps cluster around (a) **incomplete coverage of the encryption model** (Strava tokens C1, no key rotation W6), (b) **observability/logging side-channels** (Sentry breadcrumbs C3, AI keys redact W1), (c) **retention** (chat indefinite C5, full context resent each turn), and (d) **erasure/portability completeness** (Garmin revocation C4, no export endpoint C6).

Children's-data, MCP, per-processor consent, and AI-provider DPA documentation (S11–S14) are scope-expansion items that should be addressed before EU launch.

#### Data flow snapshot

```
User Input
├─ Clerk Auth (email, name, profile image) → Clerk + App DB (plaintext)
├─ Strava OAuth (accessToken, refreshToken) → App DB (⚠️ UNENCRYPTED — C1)
├─ Garmin Email + Password → App DB (encrypted AES-256-GCM)
├─ Workout Logs (exercises, RPE, notes, metrics) → App DB (plaintext)
├─ Chat Messages → App DB (plaintext) + Gemini/Anthropic API (every turn)
├─ Coaching Materials (PDF/DOCX/CSV) → App DB + Gemini Embeddings → pgvector
├─ Email Preferences → Resend (weekly summary content includes workouts)
└─ All Errors/Logs → Sentry (⚠️ C3: includes training context in breadcrumbs)

Account Deletion
├─ Clerk user deleted first
├─ Best-effort Strava deauth (API call)
├─ ⚠️ No Garmin token revocation (C4)
└─ Cascade deletes all child rows (✓ FK cascades verified)

Retention & Cleanup
├─ Workout data: indefinite (until account deletion)
├─ Chat messages: indefinite ⚠️ (C5 — no TTL)
├─ AI usage logs: 7 days (cron.ts:99-116) ✓
├─ Idempotency cache: 7 days ✓
└─ Stale flags: recovered via 10-min cron ✓
```

## Score Summary

| Category | Score (1–10) | Notes |
|----------|--------------|-------|
| Security | 7 | Strong defaults (CSRF, Helmet, encryption); fix XSS, Strava encryption, logger redaction, SSRF guard |
| Business Logic | 8 | Feature-complete vs README; close gaps on `mafHr` derivation, timezone, consent-coverage test |
| UX / Accessibility | 7 | Solid Radix foundation; address Textarea errors, assertive stream errors, motion prefs, doc.title |
| Performance | 7 | Good caches/virtualization; missing HNSW index, composite plan-days index, scheduler `Promise.all`, RAG LRU |
| QA / Edge Cases | 6 | Broad test surface; underexercised SSE/breaker/lock recovery & timezone |
| DevOps / Infra | 7 | Production-ready single-instance; needs Sentry release+sourcemaps, multi-instance rate limit, DR docs |
| Data Privacy | 6 | Privacy-first defaults; close Strava encryption, breadcrumb redaction, retention TTL, export endpoint, Garmin revocation |
| **Overall** | **7** | Mature codebase — ~10 high-impact fixes (table above) gate GA at scale |
