# Codebase Analysis — 2026-07-19

**Method.** Multi-agent deep analysis: 13 primary analysts (8 subsystem deep-dives, 4 assessment lenses — security, quality, performance, test coverage — and 1 build-health agent that installed dependencies on a cold clone and executed every quality gate against a throwaway PostgreSQL 16 + pgvector cluster), followed by adversarial verification of all 54 lens findings by independent skeptic agents (**0 refuted**, several corrected for precision), a completeness critic, and 4 gap-fill investigations (analytics/race-prediction math, GDPR end-to-end, file ingestion pipelines, disaster-recovery validation). 66 agents total; every claim below was verified by reading code, and severities reflect the post-verification corrected versions.

**Snapshot.** HEAD `6426ed0` (2026-07-18). ~169k lines of TS/TSX in 1,363 files: client 630 files (~75.6k lines), server 389, shared 48, 80 SQL migrations (161 files with snapshots/journal), 353 vitest test files (3,412 passing tests), 12 Cypress specs, 9 GitHub Actions workflows, 38 Drizzle tables across a two-database topology (main Postgres + separate Neon vector DB).

---

## Remediation status (updated 2026-07-25)

All ten priority items have now been worked, across six remediation rounds. The body of this document below is the unmodified historical register — statuses here supersede it.

**PR #1663 — P0 fixes (priority items 1–3).**
- Fresh-DB bootstrap repaired: 0035's ambiguous `id` qualified; boot is now **strict** (non-benign migration errors fail readiness, plus a critical-table assertion against the zero-tables failure mode); a new `fresh-db-migrate` CI job applies the real migration chain to a fresh pgvector container on every PR, closing the defect class structurally.
- GDPR foods leak closed as an explicit **opt-in sharing feature**: `foods.is_public` (migration 0080, default private), visibility never infers "shared" from a NULL owner, account deletion runs a two-phase purge (fail-loud vector-embedding purge *before* the irreversible Clerk delete, reference-guarded foods erasure), migration 0081 erases pre-existing orphans, and a recurring sweep prunes dangling `food_embeddings` — the previously nonexistent deletion path. First-ever tests for the account-deletion route.
- Both analytics bugs fixed with regression tests: direction-aware PR detection (plank et al. now celebrate longer holds, not shorter), and the `nutrition_insights` job dispatches through an exhaustive switch with a food-log-anchored staleness check (meal-only users recompute; no more double coach spend or false stamps).

**PR #1665 — performance + AI billing (priority items 4, 6, 7, 8).**
- Bundle: drizzle-orm/drizzle-zod/zod no longer ship to the browser (client value-imports repointed to pure schema submodules), `clsx` extracted from vendor-charts, `advancedChunks` → `codeSplitting`. **Eager first-paint JS 956 KB → 566 KB (−41%)**; a `check:bundle` guard fails if either invariant regresses.
- Food search: fuzzy predicates rewritten to the `%` operator — EXPLAIN-verified BitmapOr over both trigram GIN indexes at 220k rows (the old `similarity() >=` shape is structurally unservable) — and the live-provider fan-out (with its per-search upserts) now skips when the local cache already yields ≥10 hits.
- Timeline: hydrate-after-window reorder (up to ~6× less hydration for the 500-row page and the AI-context path). Client pagination deliberately deferred (full-array coach stats + deep-link scans need their own design round).
- AI billing: `gemini-2.5-flash` priced (photo/label parses were billed ~10–17× against the $2/day cap), with a warn-once fallback log and the first `estimateCostCents` tests.

**PR #1666 — test hardening + repo hygiene (priority items 5, 9) + two bugs found en route.**
- **New bugs fixed:** the advisory-lock key registry had a *double* collision (`analyticsRecompute` shared 42_010_009 with the key-rotation sweep; `nutritionEmbeddingBackfill` shared 42_010_010 with the boot-migration lock — `pg_try_advisory_lock` makes collisions silently skip protected work, so a running backfill could skip boot migrations); and the credential re-encrypt sweep aborted unresumably on the first undecryptable row (now per-row isolated, logged, and counted).
- Tests: first Garmin sync-orchestration suite (16 tests via an injectable SDK seam: dedup invariant, token strategies, circuit-breaker cascade, preflight matrix, per-user lock) and first key-rotation sweep suite (real-crypto v1→v2 migration proofs). Coverage is now **measured and enforced in CI** (`vitest --coverage` with thresholds ratcheted to measured reality, lcov emitted for a future Sonar CI-scanner switch — the old untouched 80% config was never evaluated).
- Hygiene: `hyrox_results.csv` (25 MB, ~63% of the packfile) untracked with friendly script guards + README provenance; `.Jules/`/`.jules/` case collision merged; stray files and the unwired, destructive `scripts/post-merge.sh` removed.

**PR #1682 — P2 correctness: athlete-local day boundaries + stale analytics.**
- Every user west of UTC saw *today's* session marked **Missed** during their own evening — and `markMissedPlanDays()` **persisted** that verdict, unscoped, on every boot and from the email cron. Both now derive "today" in the athlete's stored timezone. The sweep iterates distinct timezones rather than joining `AT TIME ZONE u.user_timezone`, because one unrecognized zone name would otherwise abort the entire global sweep.
- Analytics staleness was forward-only (`latest > anchor`), so **deleting** a workout or **back-dating** a Strava import never marked Race Predictor / Coach Insights stale — they stayed wrong with no refresh badge. Now a difference test, with the anchor stamped even when generation is budget/consent-gated so gated users converge instead of latching.
- Editing a set invalidated only the workout itself; personal records, exercise analytics and the training overview kept serving pre-edit numbers. Client mutations now route through the shared invalidation bundle, and the server's three coalesced route caches were extracted into a module with a per-user invalidator.
- The "weekly" summary email was a check-then-act ledger written *after* the Resend call, which combined with the fixed 09:00 UTC tick biased it toward skipping alternate weeks — i.e. it was landing biweekly. Replaced with an atomic date-keyed claim taken **before** sending, plus the first tests for the weekly/missed-reminder processors.
- One streak authority (the server's), replacing a browser-timezone client calculation that could render a different number in the same session.

**PR #1683 — prompt-injection fix, type/CI gates, and the second NULL-owner leak.**
- `materialsBuilder.ts` interpolated coaching-material text into a prompt without `sanitizeUserInput` while the adjacent line did — an injection vector that fires immediately after upload.
- A **second GDPR NULL-owner leak, identical in shape to the round-1 `foods` one**: `structured_exercise_backfill_reviews` was `set null` on account deletion while `listBackfillReviews` matched `user_id = $me OR user_id IS NULL`, so orphaned rows were returned to every athlete. It had been filed in an archived 2026-06-03 review and never actioned. The FK now cascades (migration 0082), and the dedicated cascade meta-test — which claimed a closed list while covering 16 of 27 FKs — was replaced with a generic sweep over every `users.id` FK.
- `tsconfig.test.json` is now wired into CI: ~360 test files had never been typechecked at all. 295 gate today; 66 carry ~500 pre-existing errors and sit in a shrink-only exclude list.
- `check:bundle` can now actually fail the build (it previously only warned into a scrolling log).

**PR (this round) — ops/DR (priority item 10), the in-repo half.**
- The runbook's central claim was false: it said boot "self-heals structural state" so a restore "only needs to recover **data**, not schema scaffolding". Boot is strict since round 1 (it refuses to serve, it does not heal), and production's schema is `drizzle-kit push`-managed, so boot-time `migrate()` skips the whole chain as benign — which is also why data-payload migrations never reach production. Documented, with the consequences spelled out at each restore step.
- §6's monthly drill was a hand-ticked checklist that had never been run. `pnpm ops:restore-drill` now automates seven of its items against a throwaway restore — schema completeness, a generic FK orphan sweep read from the catalog, row-count spot checks, the known ownerless-row shapes, and a real credential decrypt proving key and ciphertext survived together.
- §5.3's "rebuild via the re-embed path" had no path: `reembedAllMaterials` was per-athlete and behind an authenticated route. `pnpm ops:reembed` walks the fleet, provisions the vector schema itself, and verifies by reading chunk coverage back.
- `ensureVectorSchema()` failures were invisible — swallowed by design, and readiness only probes the vector pool with `SELECT 1`, which a reachable-but-empty database answers. Its outcome is now reported as `vectorSchema` on `/api/v1/health` (reported, not gated) and captured to Sentry.

**Watch-phase fixes** (found by CI/scanners during the PR cycles, all merged): the boot migration-error classifier now unwraps `DrizzleQueryError` causes; a re-privatized shared food could be erased while still referenced by other users' logs (reference-guarded); tag-pinned `pnpm/action-setup` SHA-pinned (Sonar supply-chain gate); the bundle guard runs in-process instead of via a PATH-resolved spawn (Sonar).

**Still open.**
- **Item 10, the half that needs credentials or infrastructure decisions:** the scheduled off-platform `pg_dump` still does not exist; the Railway/Neon snapshot schedule and retention are unconfirmed; the RPO/RTO numbers in the runbook remain unvalidated targets; no escrow location is recorded for `ENCRYPTION_KEY`; and moving the vector schema into versioned migrations is still an open design question (in single-DB fallback a `vector_migrations` ledger would live in the very database `drizzle-kit push` manages).
- **Two outstanding manual production steps** — the 0081 and 0082 `DELETE`s, tracked in [`docs/operations/pending-manual-steps.md`](operations/pending-manual-steps.md). Push-managed production never applies them; `pnpm ops:restore-drill` verifies them.
- **Timeline client pagination**, re-scoped by its verifier: offset paging over a date-DESC window is not viable as described below; it needs a date-window redesign, and it is a cost/perf item with no correctness defect.
- **God-component decomposition**, whose scoping surfaced a live drag-and-drop bug (`TimelineDateGroup.tsx` registers every date group as droppable with no future gate).
- **~500 test-suite type errors** in the 66 files excluded from `tsconfig.test.json` — new tracked debt from PR #1683, shrink-only.
- The optional CSV history rewrite, and the pre-existing Dependabot high on main.

---

## Executive summary

fitai.coach is an unusually disciplined codebase for its size — top-decile in security engineering, documentation, and test hygiene. Every quality gate the repo defines passes on a cold clone: `tsc` 0 errors (strict), `check:strict` 0 errors, ESLint 0 errors / 8 size warnings, 3,412/3,412 tests passing, production build green with self-verifying artifact floors. There is **zero `any` in production code, zero TODO/FIXME comments, zero skipped tests, 0.47% code duplication**. The security lens found no injection, no IDOR, no auth bypass — CSRF, CSP nonces, AES-256-GCM versioned-keyring encryption, fail-closed AI budget enforcement, and per-user scoping are all real and correctly implemented.

Against that backdrop, this analysis found **one operationally critical defect and two genuine data-handling bugs** that previous audits missed, plus a cluster of high-impact performance issues:

1. **A fresh database cannot be bootstrapped.** `migrations/0035_maf_artifacts.sql:58-62` contains an ambiguous unqualified `id` in an `INSERT..SELECT`, which errors on every PostgreSQL version. Drizzle applies all pending migrations in one transaction, so the entire 80-migration batch rolls back and `pnpm db:migrate` exits 1 with the error text swallowed. CI structurally cannot catch this (migrations.yml only checks drift; cypress.yml provisions its DB via `drizzle-kit push`, bypassing migration SQL). Worse, on boot the failure is swallowed (`server/maintenance.ts:78-83`): the app comes up **green — `isReady=true`, healthy Railway deploy — with zero tables**, the only signal being one Sentry event. This breaks new environments, contributor onboarding, and two of the four disaster-recovery scenarios in `docs/operations/backup-restore.md`.
2. **GDPR erasure leaks deleted users' food data.** `foods.created_by_user_id` is `onDelete: set null` (`shared/schema/tables.ts:1189-1191`) and `visibleTo()` treats NULL owner as "shared" (`server/storage/nutrition.ts:74-76`) — so the moment an account is deleted, that user's custom foods and recipe-backing foods (free-text names up to 200 chars, which can contain personal info) become **globally visible and searchable to all users**. Separately, `food_embeddings` on the vector DB has **no deletion path anywhere in the repo** — user-derived custom-food-name embeddings are retained indefinitely with no user linkage. (Account deletion is otherwise more complete than earlier internal docs claim: it does delete the Clerk user, purge `document_chunks` fail-loud, deauthorize Strava, and purge pg-boss jobs.)
3. **User-visible analytics bugs.** PR achievements use inverted `bestTime` comparison for TIME_LONGER_IS_BETTER exercises (plank, side plank, hollow hold, battle ropes — `personalRecordAchievements.ts:22`), celebrating regressions as PRs. The nightly `nutrition_insights` job actually runs coach-insights generation, never refreshes nutrition, falsely stamps the nutrition `recomputedOn`, and can double coach-insights AI spend per night (`server/queue.ts:416-424`).

The performance lens confirmed the storage layer is largely N+1-free and SSE streaming is exemplary, but found a client bundle bug that ships recharts (391 KB) eagerly on every first paint including the signed-out Landing page, a timeline read path that hydrates ~3× the requested window before slicing, and a fuzzy food search whose `similarity()` predicates cannot use its trigram GIN indexes (sequential scan of a globally growing table on every search, on by default).

Finally, a pattern worth naming: **the repo documents its own debt better than it burns it down.** The 25 MB `hyrox_results.csv`, case-colliding `.Jules/`/`.jules/` dirs, and stray files were rated "High / one small PR" in the repo's own 2026-07-01 analysis and remain unfixed; 80% coverage thresholds exist in config but no CI job ever measures coverage; the DR runbook's off-platform backup automation does not exist.

---

## Scorecard

| Area | Grade | One-line verdict |
|---|---|---|
| Security | **A** | No injection/IDOR/auth-bypass found; residual risks are design-level (Garmin passwords, push-endpoint SSRF) |
| Server core architecture | **A−** | Phased bootstrap, cross-instance-correct primitives; minor ordering bug (request-context userId) and advisory-lock key collisions |
| Shared domain math | **A−** | Pure, tested, reason-coded calculators; a few formula defects (energyBalance double-count, dead `carbs_floored` path) |
| Documentation | **A−** | Top-decile, README accurate to within weeks; but stale root debt registries read as "0 debt" and design_guidelines.md is wrong |
| Build health | **B+** | Every defined gate green on cold clone; but the fresh-DB migrate path is broken (0035) |
| AI layer | **B+** | Clean provider abstraction, layered kill switches, budget caps; pricing-table gap bills photo parses ~50×, budget is race-prone, vision/embeddings hard-wired to Gemini |
| Client architecture | **B+** | Conventionalized data layer, offline-first writes, lazy routes; god-components and a chunking bug |
| Data layer | **B** | Solid schema with CHECK state machines; vector schema unversioned, users god-table, stale cascade tests, and the 0035 defect |
| Testing | **B** | 353 files/3,412 green tests, strong meta-tests; but money paths untested (account deletion: zero tests), e2e fully stubbed, coverage unmeasured |
| Performance | **B−** | Storage mostly N+1-free, SSE exemplary; eager recharts, timeline over-fetch, un-indexable fuzzy search, stale analytics caches |
| Operations / DR | **C** | Runbook exists but misleads: self-heal claim false, off-platform backup fictional, silent zero-tables failure mode, no alerting beyond Sentry |

---

## System map

**Topology.** Single-process Express 5 (ESM) app serving API + SPA, with pg-boss workers and 9 node-cron jobs in the same process; main Railway Postgres (pool 20) plus optional Neon vector DB (pool 5) holding `document_chunks` and `food_embeddings` (3072-dim Gemini embeddings, HNSW over `halfvec` casts). Client is a React 18 + Vite 8 (Rolldown) SPA/PWA: wouter (6 lazy routes), Clerk auth, TanStack Query v5 as sole server-state layer, Tailwind v4 + shadcn/ui, offline-first localStorage mutation queue with idempotency-key replay.

**Request lifecycle.** compression (SSE-exempt) → health (pre-CORS) → CORS allowlist → CSP nonce → helmet (nonce-based script-src in prod, HSTS preload) → path-scoped body limits (100 kb global / 2 mb coaching / 10 mb image-parse) → cookieParser → pino-http → AsyncLocalStorage context → Clerk → CSRF double-submit (all mutating `/api/v1`) → per-route stacks composed by `protectedRouteBuilder`: [auth + idempotency] → Postgres-backed rate limiter (fail-open reads / fail-closed mutations) → aiConsent → aiBudget ($2/day, fail-closed) → Zod → handler → leak-safe error JSON. ~15 route modules, ~120 endpoints.

**Layering.** routes → (thin usecases / service orchestrators) → 15-facet storage facade (~5.4k lines) → Drizzle. The AI layer is a multi-provider text abstraction (Gemini default; Anthropic/OpenAI-compatible routable) with role-based model routing, retry+circuit-breaker plumbing, and a shared COACHING ANALYSIS prompt renderer used by both chat and auto-coach; RAG chunks user materials into pgvector with legacy full-text fallback. Integrations: Strava (HMAC single-use OAuth state, advisory-lock-serialized token refresh, dual-layer dedupe) and Garmin (encrypted email/password SSO with per-user locks, min-interval, 429 circuit breaker, audit log).

---

## What is genuinely excellent

- **Security engineering.** Verified end-to-end: parameterized queries only; per-user scoping across the storage layer (no IDOR found); `__Host-` CSRF cookie bound to Clerk userId; production guard on the dev auth bypass; AES-256-GCM with random IV, validated auth tag, versioned keyring, zero-downtime rotation, weak-key rejection; timing-safe operator-secret compares; SSRF guard with startup DNS checks; rehype-sanitize on AI markdown; aggressive Sentry PII scrubbing.
- **Cross-instance correctness discipline.** Rate limits, idempotency (atomic claim-before-execute + 7-day replay), runtime KV with race-safe claims, and all 9 crons behind pg advisory locks — Postgres-centric rather than in-memory-and-hope.
- **Fail-closed defaults where money/safety is involved.** AI budget middleware 503s if the budget check itself fails; mutation rate limiter fails closed; email queues are no-retry to prevent double-sends.
- **Test *quality* where tests exist.** Guard-order matrix tests, a static "aiBudget implies aiConsent" compliance scan over all route files, fail-closed budget tests, deep nutrition-math edge cases, jest-axe globally, zero `.only`/`.skip`, one snapshot file in the entire repo.
- **The shared calculator house style.** Every domain calculator (nutrition targets → windowed carb periodization → per-meal allocation; UTSS/ACWR/TSB training load; race benchmarks from a validated 60.6k-row cohort dataset with a committed backtest) is pure, DB-free, reason-coded, degradation-tolerant, and co-tested.
- **Documentation.** README accurate on every spot-check (versions, CI table, scripts, feature claims); 35-file docs/ tree with ADRs, a provenance-labeled archive, and honest scorecards. CODEBASE_AUDIT.md / TECHNICAL_DEBT.md claims verified ~90% accurate on spot-checks.
- **Build determinism.** Cold-clone install → typecheck → lint → full test suite → build all green; build script asserts artifact size floors against silent build failures.

---

## Findings

Severity reflects adversarially-verified, corrected versions. File references are the anchor points, not exhaustive.

### P0 — fix now

| # | Finding | Where |
|---|---|---|
| 1 | **Fresh-DB bootstrap broken**: ambiguous unqualified `id` in `INSERT..SELECT`; single-transaction batch → all 80 migrations roll back; drizzle-kit exits 1 swallowing the error; boot swallows it too and serves traffic with zero tables while health reports green | `migrations/0035_maf_artifacts.sql:58-62`, `server/maintenance.ts:58-84`, `server/bootstrap/health.ts` |
| 2 | **No CI job applies real migration SQL to a fresh DB** — the 0035 class of defect is structurally invisible (drift-check only; Cypress DB provisioned via `drizzle-kit push`) | `.github/workflows/migrations.yml`, `cypress.yml` |
| 3 | **Deleted users' custom foods become globally visible** (set-null owner + NULL-means-shared visibility predicate); Art. 17 erasure incomplete for user-authored food/recipe names | `shared/schema/tables.ts:1189-1191`, `server/storage/nutrition.ts:74-76` |
| 4 | **`food_embeddings` has no deletion path at all** — unbounded orphan accumulation; user-derived embeddings retained indefinitely, no user column | `server/services/nutrition/foodEmbeddings.ts`, `server/maintenance.ts:166-203` |
| 5 | **Inverted PR detection for longer-is-better exercises** — wrong PR celebrations shown to users; untested | `server/services/personalRecordAchievements.ts:22` |
| 6 | **`nutrition_insights` job runs coach-insights instead**, falsely stamps nutrition `recomputedOn`, can double nightly coach-insights AI spend | `server/queue.ts:416-424`, `analyticsRecomputeScheduler.ts:32` |

### P1 — high

**Performance / cost**

- **Eager recharts on every first paint** (incl. signed-out Landing): the manual `vendor-charts` chunk (391 KB) captured `clsx`, so the entry chunk statically imports and modulepreloads it (`vite.config.ts:125`). Also note `advancedChunks` is deprecated in Vite 8 (future-major break).
- **Timeline over-fetch**: each source fetches 3× the requested window and hydrates exercise sets/structure blocks for the full superset (~3,000 entries) before slicing to the 500-entry default (`server/storage/timeline.ts:489`); the client never paginates and always requests 500 fully hydrated entries (`client/src/lib/api/analytics.ts:94`).
- **Fuzzy food search cannot use its indexes**: `similarity() >= t` function predicates bypass the pg_trgm GIN indexes (migration 0074) → sequential scan of the globally growing shared foods table on every search; every search also upserts all live provider hits, and synonym expansion multiplies per-row cost up to 8× (`server/storage/nutrition.ts:143`, `foodSearch.ts:54-144`).
- **AI pricing-table gap**: `gemini-2.5-flash` (default vision model) missing from `MODEL_PRICING`, so every photo parse bills at the punitive default — eroding users' $2/day budget ~50× faster than actual cost (`server/services/aiUsageService.ts:7-15`).
- **AI budget is pre-flight-only and race-prone**: concurrent requests/long streams can overshoot the cap; usage recording is post-hoc fire-and-forget (`server/ai/providers/index.ts:75-83`).
- **Drizzle-orm runtime (58 modules) ships to the browser** in a 315 KB chunk because client code imports from the `@shared/schema` barrel, executing the full `pgTable` builder graph (`shared/schema/tables.ts` via `offlineMutationFallback` chunk).

**Security (design-level; controls otherwise verified strong)**

- **Garmin account email+password stored reversibly** under the symmetric keyring — a key leak exposes reusable credentials, materially worse than OAuth tokens. Privacy page does disclose this (`client/src/pages/Privacy.tsx:131-146`); the exposure remains (`server/storage/users.ts:424`).
- **Blind SSRF via Web Push endpoint**: guard checks literal private IPs only, no DNS resolution — an authenticated user can point the server at an internal DNS name; and no validation is repeated at send time (`server/routes/push.ts:17`, `server/ssrfGuard.ts:88`, `server/pushNotifications.ts`).
- **Unsanitized legacy coaching-materials prompt path**: injection mitigation (entity-encoding) applied to RAG chunks but not the full-text fallback — which runs exactly when embeddings are missing, including immediately post-upload (`server/prompts/materialsBuilder.ts:15-36`).

**Testing**

- **Account deletion: zero tests at any layer** for the most destructive endpoint in the app (`server/routes/account.ts:44`).
- **AI cost estimation untested** (`estimateCostCents`, unknown-model fallback, dollars→cents conversion); `server/garmin.ts` sync/credential/route layer untested (only primitives + mapper covered); 13 of 21 storage modules untested; `keyRotation` sweep untested.
- **Coverage is unmeasured and unenforced**: 80% thresholds in `vitest.config.ts` but CI never runs `--coverage`; the Sonar lcov path is never produced; Sonar misclassifies ~86% of test files as source.
- **All mutating Cypress flows stub the API** (`cy.intercept`); Clerk auth never exercised (dev bypass); the nutrition module has zero e2e while unit tests pin `NUTRITION_ENABLED=false` — opposite of production.

**Repo hygiene (known since 2026-07-01, still unfixed)**

- 25 MB `hyrox_results.csv` git-tracked at root (~4.9 MB packed = ~63% of the packfile; full 25 MB in every checkout and the nixpacks build context; build-time-only input).
- `.Jules/` and `.jules/` both tracked — `palette.md` exists in both with divergent content → checkout conflicts and perpetually-dirty status on case-insensitive filesystems (including the maintainer's own Windows machine). This is a regression of previously fixed issue S13.
- Stray tracked files: `commit_msg.txt`, `.plan_step`; `script/` vs `scripts/` split; `scripts/post-merge.sh` uses `npm install` + `drizzle-kit push --force` (destructive, contradicts repo discipline).

**Operations / DR**

- The runbook's data-only-restore "self-heal" claim is false (boot migrate rolls back everything, swallowed); the documented off-platform pg_dump automation **does not exist anywhere**; no drill has ever been run (unfilled placeholders); no key-escrow location named for `ENCRYPTION_KEY` — account-level loss makes all encrypted credentials unrecoverable; no alerting beyond optional Sentry (`docs/operations/backup-restore.md`).
- Vector-DB schema (`document_chunks`, `food_embeddings`, HNSW indexes) exists only as imperative boot code, not migrations; its failures bypass Sentry entirely (`server/maintenance.ts:94-209`, `:204-205`).

### P2 — medium

**Server core / domain**

- Request-context middleware captures `req.auth?.userId` before Clerk is mounted → `ctx.userId` always undefined; `getContextLogger` is a dead export and TECHNICAL_DEBT #18's named deliverable; the real mechanism (pino mixin) works (`server/index.ts:282-286`, `server/logger.ts:82`).
- Advisory-lock key collisions contradict in-code "distinct" comments: `42_010_009` (analyticsRecompute ↔ keyRotation), `42_010_010` (nutritionEmbeddingBackfill ↔ migrations) — silent cron-tick skips when boot sweeps overlap (`server/cron.ts:40-41`, `keyRotation.ts:12`, `maintenance.ts:30`).
- Email delivery asymmetry: send-then-stamp can double-send weekly/missed emails on crash between steps, while no-retry options silently drop sends on transient Resend failures; startup catch-up fires 30s after every post-09:00-UTC boot, so a scheduler-idempotency regression would double-send on every deploy (`server/emailScheduler.ts:70-112`, `cron.ts:276-299`).
- Mixed day-boundary regimes: UTC math (training load, weekly progress, `getMonday` mixes UTC parse with local methods) vs user-local (streaks, recompute cron, email scheduler) — a standing off-by-one risk class.
- Strava state secret falls back to a per-process random when unset → intermittent OAuth callback failures on multi-instance deploys (`server/strava.ts:37-40`); Garmin per-user mutex is per-process only.
- 4 genuine runtime module cycles (benign today, load-order landmines): `queue ↔ coachService ↔ workoutService`, `queue ↔ emailScheduler`, `gemini/client ↔ storage/coaching` (fix: move `EMBEDDING_DIMENSIONS` to `constants.ts`), `storage/plans ↔ server/types.ts ↔ clerkAuth` (`server/types.ts` is a misnamed runtime module).
- Layering drift: `strava.ts`/`garmin.ts` are route+service+client monoliths; two competing usecase conventions (`server/usecases/` DI factories vs `server/services/*UseCases.ts`); services bypass the storage facade for transactions and re-implement user-scoping; `mutateWorkoutSet.usecase.ts` is dead code; dormant FatSecret/Spoonacular clients wired only for cache refresh.
- God files: `trainingLoadService.ts` (1,107), `storage/nutrition.ts` (1,018, 39 methods), `nutrition.routes.ts` (966, 38 endpoints), `coachService.ts` (863); `buildCoachNoteInputs` mapping duplicated across two services.

**AI layer**

- Non-Gemini adapters drop the retry AbortSignal → hung-socket abort only works for Gemini (`anthropic.ts:146-153`, `openaiCompatible.ts:135-142`); Anthropic JSON mode is prompt-emulated while ~10 callers assume parseable JSON.
- Vision + embeddings hard-wired to Gemini regardless of `AI_TEXT_PROVIDER` — a non-Gemini deployment silently breaks photo parse and all RAG without `GEMINI_API_KEY`.
- Streaming output validation is per-chunk: restricted patterns split across chunks evade it; mid-stream detection throws after partial content reached the client (`gemini/chatService.ts:74`).
- Chat-history injection asymmetry: only the live message is sanitized/XML-wrapped; client-supplied prior turns embedded raw (`gemini/chatService.ts:14-17`). Chat persistence is client-driven — clients can store arbitrary assistant-role content; server replies never persisted server-side.
- Training decision engine's race-week and illness/sleep branches are unreachable (production call passes `hasRace:false`, fixed recovery markers); plan-generation chunks are parallel with no cross-chunk continuity beyond prompt text.
- Safety screening is English-regex-only, with red-flag matches aggressively overwriting all suggestions (false-positive amplification).

**Data layer**

- `users` is a ~45-column god-table (prefs/consent/body-comp/MAF — MAF params also duplicated in `maf_profile`); untyped JSONB at analytical choke points (`exercise_sets.intensity/load/tempo/standards`, `analytics_results.payload`); `exercise_name` joins by unconstrained string to the ~300-entry TS catalog — silent-drop convention through race prediction, coverage, and load vectors.
- `tables.cascade.test.ts`'s closed table lists are stale — ~9 newer user-FK tables escape the promised cascade enforcement; `post-migration.integration.test.ts` asserts only the March-era schema.
- Rewritten migration history (0008/0010/0012-0014 retroactively no-op'd; 0042 an IF-NOT-EXISTS repair of 0041) — files no longer record what production executed; push-managed prod means the journal is likely never populated, so migration-embedded backfills silently never run via `migrate()`.
- Server analytics caches (5-min TTL) never invalidated on writes — client post-mutation refetches get stale data (`server/routes/analytics.ts:83`); caches entry-bounded but not size-bounded with O(n²) eviction scan.
- Postgres write on the hot path of every rate-limited request (WAL per hit), including the SPA-shell fallback (`server/rateLimitStore.ts:33-53`).
- Nutrition hot path: `getMissedWorkoutsForDate`/`getPlannedDaysForDate` fetch all users' rows for a date and filter userId in memory; daily-summary fetches the user row 2-4× and workout logs twice; GDPR export loads the entire hydrated timeline into memory (needs streaming, not capping).

**Shared domain math**

- `energyBalance` measured path stacks gross device calories on BMR×1.2, double-counting the BMR share of workout windows (~70-100 kcal/h systematic overestimate, undocumented) (`shared/energyBalance.ts:96-105`).
- `carbs_floored` reason code never emitted — inverted comparison; transparency contract broken on the rest-day floor path (`shared/nutritionTargets.ts:432`).
- `dateStringSchema` is regex-only — `2026-13-40` passes and silently rolls over in `dateUtils.toUtcEpoch`; stricter `isoDate` already exists in `shared/schema/nutrition.ts` (`shared/schema/types/requests.ts:13-16`).
- Duplicated unenforced rule sets: structure-format semantics in zod + structureLint; UTSS intensity formula duplicated between `plannedSessionEstimate` and `trainingLoadService`; distance-based strength stress not unit-normalized (~3.28× inflation for miles users) (`trainingLoadService.ts:342`).
- Race predictor personalization hole: only `run_1k` sets feed run legs — most real running is invisible, silently degrading 8 of 16 segments to cohort medians; three surfaces disagree on what counts as "running".
- `shared/openapi.ts` documents only 6 routes with insert-schema response types — Swagger consumers get an inaccurate contract.

**Ingestion pipelines**

- No server-side magic-byte check on decoded base64 images; junk-image failures count toward the process-global AI circuit breaker (threshold 5) while the parse limit allows 5/min — cheap denial-of-AI-service for all users.
- Layered size caps disagree on both upload routes (schema-valid payloads can 413); `csv-parse` without `bom:true` or delimiter detection → BOM'd/EU-semicolon CSVs fail with misleading errors; `sw-push.js` has unguarded `event.data.json()` and unvalidated `data.url` navigation (safe only while payloads stay server-hardcoded).

**Client**

- God-components: `WorkoutStructureEditor.tsx` (954 lines, zero tests, outside the eslint max-lines globs), `TimelineWorkoutCard.tsx` (786), `ReviewSurface.tsx` (783).
- Auth-bypass predicate duplicated between `App.tsx:42-52` and `useAuth.ts:9-11` — drift silently changes which paths skip Clerk.
- Default queryFn joins key segments into URLs (malformed key → wrong URL fetch, silently) and lacks the 15s timeout the typed path has (`client/src/lib/queryClient.ts:196`).
- No client-side input validation (zod confined to server/shared + offline queue); no i18n framework across ~215 components; ThemeProvider bypasses the `safeStorage` guards used elsewhere.

**CI / tooling**

- `.test.ts` files excluded from `tsc` and cypress/ from ESLint+typechecking — type errors in tests land silently; warn-level guardrails (complexity, max-lines, no-console) don't gate; `format:check` never runs in CI.
- `cypress.yml` has no `pull_request` trigger (fork PRs bypass e2e); no concurrency cancellation anywhere; `post-migration.yml` and the timeline benchmark are manual-only; `patch-cypress-deps.js` postinstall mutates the Cypress binary cache from the registry and swallows all failures (nonstandard supply-chain surface).
- 18 manually-synced duplicate override blocks in package.json (npm + pnpm sections).

**GDPR / privacy (beyond P0)**

- `user_consents` cascade-deletes on erasure → cannot demonstrate historical consent/opt-outs; consent overwrite-on-update with no policy versioning; AI-processing consent exists only as a boolean column (no timestamped record, not exported).
- `purgeUserJobs` misses `pgboss.archive` — completed-job payloads with userId persist for the archive retention window; RAG retrieval cache holds plaintext chunk text in `server_runtime_cache` for up to 120s post-erasure.
- Export omits nutrition food logs (health-adjacent data with no portability path), MAF test notes, and plan-proposal request text.

### Notable non-findings (verified strong)

No SQL injection surface reached user input. No IDOR (the few unscoped storage helpers are always preceded by ownership checks). No public admin endpoints. No secrets in the repo (gitleaks gate added after a real historical `ENCRYPTION_KEY` leak — key since rotated via the keyring mechanism). Timeline/analytics/nutrition storage reads are batched, capped, and largely N+1-free. SSE chat streaming (backpressure, deadlines, abort-on-disconnect, bounded registry) is exemplary. The idempotency middleware's atomic claim protocol is correct. The 60.6k-row race-benchmark pipeline (validation gates, physiology sanity checks, honest 80/20 backtest: MAE 906s → 743s) is genuinely rigorous — the 92,375-row CSV reduces to 60,589 clean singles rows after validation, reconciling the two figures quoted in different docs.

---

## Priority plan

*(Statuses added 2026-07-19 — see the Remediation status section at the top for detail.)*

1. ✅ **Fix `migrations/0035`** (qualify the ambiguous `id`), then add a CI job that runs `pnpm db:migrate` against a fresh postgres:16+pgvector service container — this closes the whole defect class. Make boot-time migration failure block readiness (or at minimum page loudly). *(PR #1663)*
2. ✅ **Close the GDPR foods leak**: on account deletion, delete custom foods (or anonymize names) instead of orphaning them shared; add a `food_embeddings` purge path keyed by food id; purge `pgboss.archive`; stop cascade-deleting `user_consents` (tombstone instead). *(PR #1663 — built as opt-in `is_public` sharing; the `pgboss.archive` sub-item was moot: pg-boss v12 has no archive table, and the existing job purge reaches all partitions. `user_consents` tombstoning intentionally not changed.)*
3. ✅ **Fix the two user-visible analytics bugs** (inverted longer-is-better PRs; `nutrition_insights` job routing/stamping) and add tests for both. *(PR #1663)*
4. ✅ **Bundle fix**: move `clsx` out of the `vendor-charts` group (and migrate `advancedChunks` → `codeSplitting` before the next Vite major); stop importing the `@shared/schema` barrel from client runtime code (extract the ~5 pure exports it actually needs). *(PR #1665 — eager first-paint JS −41%; guarded by `pnpm check:bundle`)*
5. ✅ **Add tests where the blast radius is largest**: account deletion (route + integration), AI cost estimation, Garmin sync orchestration, key-rotation sweep. Turn on `--coverage` in test.yml so the existing 80% thresholds mean something. *(Account deletion + AI cost in #1663/#1665; Garmin + key rotation + coverage-in-CI in PR #1666 — thresholds ratcheted to measured reality rather than the aspirational 80%.)*
6. ✅ **Food search**: replace `similarity() >= t` with `%` / `<->` operator forms the GIN indexes can serve, and stop upserting provider hits on every search. *(PR #1665 — EXPLAIN-verified BitmapOr; fan-out gated on rich local results)*
7. ✅ **Timeline**: hydrate after windowing, not before; paginate the client. *(PR #1665 — server reorder landed; client pagination deliberately deferred: coach-panel stats and deep-link selection scan the full array and need their own design round.)*
8. ✅ **AI billing**: add `gemini-2.5-flash` to `MODEL_PRICING` plus an unknown-model warning metric; consider mid-stream budget re-checks. *(PR #1665 — pricing + warn-once landed; mid-stream re-checks deferred.)*
9. ✅ **Repo hygiene PR** (the one the 2026-07-01 analysis already specified): move `hyrox_results.csv` to LFS/external, delete `.Jules/`, remove stray files, merge `script(s)/`, fix `post-merge.sh`. *(PR #1666 — CSV untracked rather than LFS'd; `post-merge.sh` deleted rather than fixed: it was unwired, npm-based, and destructively force-pushed schema. History rewrite to reclaim the CSV blobs remains optional.)*
10. ⏳ **Make the DR runbook true**: scheduled off-platform pg_dump workflow, key-escrow location, migrate the vector schema into versioned migrations, run and record one restore drill. *(Open — blocked on infrastructure decisions: where backups live and which credentials CI gets.)*

---

*Full per-analyst reports (18 documents, ~455 KB) were produced during this analysis; this document is the synthesized register. Previous register: `docs/CODEBASE_ANALYSIS_2026-07-01.md`. Remediation: PRs #1663, #1665, #1666 (all merged 2026-07-19); statuses in the Remediation section above supersede finding-level text below where they conflict.*
