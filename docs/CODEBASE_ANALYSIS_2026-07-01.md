# Hyrox Companion — Full Codebase Analysis & Scorecard

**Date:** 2026-07-01
**Scope:** Entire repository — client, server, shared domain logic, database, AI subsystem, testing, CI/CD, deployment, documentation, and repo hygiene.
**Method:** Three parallel deep-exploration passes (backend, frontend, infrastructure/testing) followed by direct verification of every high-severity claim against the source. Findings that could not be reproduced were dropped (e.g. one pass reported 71 `as any` casts in production code; the verified count is **0**). Prior audits (`CODEBASE_AUDIT.md`, `TECHNICAL_DEBT.md` — 28/28 items resolved) were used as a baseline so this report contains only **fresh** findings.

**Codebase snapshot:** ~157K lines of TypeScript across 1,018 files (682 source / 338 test), 78 migrations, 9 CI workflows, 70 runtime + 43 dev dependencies.

---

## Executive summary

This is a **well-above-average, actively maintained codebase**. Type discipline is exceptional (zero `any`, zero `@ts-ignore`, zero TODO/FIXME in production source), security is defense-in-depth throughout, and testing volume is high with genuinely good tests. Most weaknesses are **gate-enforcement gaps and complexity concentration**, not correctness defects.

### Scorecard

| # | Area | Score | One-line verdict |
|---|------|:-----:|------------------|
| 1 | Security | **9.0** | Defense-in-depth done properly; two small Strava-specific gaps |
| 2 | Documentation | **9.0** | 28 docs incl. honest self-critique; a few stale references |
| 3 | Type safety & code-quality tooling | **8.5** | Strictest practical setup, minus one flag and two unchecked dirs |
| 4 | Accessibility & UX | **8.5** | Custom a11y lint rule + dedicated a11y tests; forms are hand-rolled |
| 5 | Dependencies & supply chain | **8.5** | CVE-annotated overrides, SHA-pinned actions, dependabot + review gate |
| 6 | Architecture & code organization | **8.0** | Clean layering; a few god-modules and two competing route idioms |
| 7 | Database & data layer | **8.0** | 74 indexes, cascade invariant tests; 5 missing migration snapshots |
| 8 | Performance | **8.0** | Virtualization, chunking, caching all present; few unproven hot spots |
| 9 | Testing | **7.5** | Excellent tests, but the 80% coverage gate is never actually enforced |
| 10 | CI/CD & deployment | **7.5** | 9 workflows incl. 4 security scanners; no coverage job, no prod-build check on PRs |
| 11 | AI/LLM subsystem | **7.5** | Resilient multi-provider design; budget enforcement has a race |
| 12 | Frontend architecture & state | **7.0** | Great primitives, but complexity pools in a few giant components/hooks |
| 13 | Offline & PWA | **7.0** | Robust queue infrastructure wired to exactly one mutation |
| 14 | Error handling & observability | **7.0** | Strong HTTP-side story; background jobs are invisible to Sentry, no metrics |
| 15 | Repo hygiene | **5.0** | A 25 MB CSV and assorted scratch files are committed to git |

**Overall: 7.8 / 10** (unweighted mean). The fastest wins are in the two lowest-effort/highest-leverage areas: repo hygiene and closing the coverage-gate gap.

---

## 1. Security — 9.0/10

The strongest area of the codebase. Nearly every classic web-app control is present and implemented carefully.

**Strengths**

- **Auth:** Clerk middleware with a dev-bypass double-guard that fatally exits if `ALLOW_DEV_AUTH_BYPASS=true` reaches production (`server/index.ts:37-44`, `server/clerkAuth.ts:38-42`, plus an `env.ts` refine). Clerk network calls are timeout-bounded (`clerkAuth.ts:19-32`).
- **CSRF:** double-submit-cookie (`server/middleware/csrf.ts`) mounted globally on `/api/v1`, bound to the Clerk `userId`, `__Host-`-prefixed, `httpOnly`/`sameSite=strict`/`secure` in prod.
- **Idempotency:** atomic claim-before-execute using `onConflictDoUpdate ... setWhere(expiresAt <= now)` — the check-then-act race is actually closed (`server/storage/idempotency.ts:49-91`).
- **SSRF:** two layers — literal IP/hostname rejection at env-parse time plus a startup DNS resolution check refusing private A/AAAA records (`server/ssrfGuard.ts`, wired at `server/index.ts:310-314`).
- **Crypto:** AES-256-GCM with a versioned keyring for zero-downtime rotation and auth-tag length enforcement (`server/crypto.ts`); boot-time re-encryption job for rotation.
- **Secret hygiene:** `server/env.ts` rejects known-weak keys, enforces `CSRF_SECRET ≠ ENCRYPTION_KEY` in all environments, and catches `pk_live_` Clerk keys paired with non-prod `NODE_ENV`.
- **Rate limiting:** Postgres-backed store shared across replicas, per-user+category keys, fail-open on reads / fail-closed on mutations (`server/routeUtils.ts:36-88`, `server/rateLimitStore.ts`).
- Nonce-based CSP from a single source (`server/middleware/csp.ts`), HSTS preload, body-size limits, and operator endpoints gated with `timingSafeEqual` secrets (`server/routes/email.ts:38-42`).
- Input validation is near-universal: `validateBody/Query/Params` on effectively every route (21 uses in `nutrition.routes.ts`, 14 in `plans.ts`, 11 in `ai.ts`). No unauthenticated mutating endpoints were found.

**Improvements**

| Severity | Finding |
|---|---|
| **Medium** | **Strava routes use bare `express-rate-limit` with the default in-memory store** (`server/strava.ts:5, 30-40`) instead of the project's Postgres-backed `rateLimiter`. Limits are per-instance and IP-keyed: on a multi-replica deploy they are N× looser and reset on restart. Garmin already uses the correct shared limiter — migrate Strava to match. |
| **Low–Med** | **`STRAVA_STATE_SECRET` is optional in production** (`server/env.ts`) with a per-process random fallback (`server/strava.ts:25-28`). With >1 instance, OAuth `state` signed by one instance fails verification on another — a silent ops footgun. Add a production refine like `CSRF_SECRET` has. |
| **Low** | `GET /api/v1/cron/emails` mutates state (marks missed days, sends email) and is CSRF-exempt by design (`server/routes/email.ts:28`). It is secret-gated, but a mutating GET is a REST smell; prefer POST. |

**To raise the score:** unify Strava onto the shared limiter and add the missing prod refine — both are small, contained changes.

---

## 2. Documentation — 9.0/10

**Strengths**

- 28 markdown files under `docs/` covering architecture, database, auth, AI/RAG, integrations, state management, operations/backup-restore, an ADR, and a rollout checklist.
- `README.md` (24 KB) is well-sectioned: features → architecture → AI pipeline → getting started → scripts → CI/CD → accessibility.
- `docs/testing.md` (738 lines) is thorough and *honest* — it flags the project's own coverage-gate gap.
- `.env.example` is exemplary: 249 lines, `[REQUIRED]`/`[OPTIONAL]` tagging, key-generation one-liners, and an inline key-rotation runbook.
- `CONTRIBUTING.md` includes a required-checks table, DB-change workflow, and a doc-update matrix.
- Debt is tracked in documents, not littered inline: **zero** TODO/FIXME/HACK comments across `client/`, `server/`, `shared/`.

**Improvements**

| Severity | Finding |
|---|---|
| Low | **Doc drift:** `docs/testing.md:35,364` and `CONTRIBUTING.md:45` describe a lightweight smoke test at `server/routes/__tests__/routeRegistration.smoke.test.ts` — that file does not exist. The real smoke test (`server/routes/tests/smoke.test.ts`) is a heavyweight server-spawning suite, and the documented filename wouldn't even match the smoke config's glob. |
| Low | **Vestigial audit docs:** root `CODEBASE_AUDIT.md` and `TECHNICAL_DEBT.md` are both fully "resolved" and overlap with 8 dated reviews in `docs/archived/`. As living documents they now mislead readers about current state — archive them and point to a single живой registry. |

**To raise the score:** fix the two stale references and archive the resolved audit docs.

---

## 3. Type safety & code-quality tooling — 8.5/10

**Strengths**

- `strict: true` everywhere, including tests (`tsconfig.test.json`).
- Type-aware linting: `tseslint.configs.recommendedTypeChecked` with `no-explicit-any`, `no-floating-promises`, and the full `no-unsafe-*` family at **error** (`eslint.config.js:148-158`).
- The result is real, not aspirational: **0 `as any`, 0 `@ts-ignore`/`@ts-expect-error`, 0 stray `console.log`** in production source; only 20 `eslint-disable` comments repo-wide, mostly with rationale.
- A **custom local a11y lint rule** (`icon-button-needs-label`, `eslint.config.js:15-84`) enforces accessible names on icon-only buttons at error level.
- Prettier + `eslint-config-prettier` wired; server bans `console` entirely (pino only).

**Improvements**

| Severity | Finding |
|---|---|
| **Medium** | **`noUncheckedIndexedAccess` is off** (no tsconfig sets it; also missing: `noImplicitOverride`, `exactOptionalPropertyTypes`, `noUnusedLocals`). For an app doing heavy array/record math (analytics, nutrition, race predictions), index access typed as always-defined is the single biggest remaining strictness gap. |
| **Medium** | **`script/` and `scripts/` are excluded from BOTH lint and typecheck** — `eslint.config.js` ignores them and `tsconfig.json` includes only `client/src`, `shared`, `server`. That leaves `script/build.ts`, `generate-openapi.ts`, and a 15 KB data-migration script (`script/backfill-structured-exercises.ts`) with zero static checking. The riskiest scripts are the unchecked ones. |
| Low | Import-sort, `no-console` (client), and `max-lines` are all **warn-level**, and CI fails only on errors — warn-drift accumulates silently. Either promote to error or drop them. (A fresh run confirms it: `eslint .` exits 0 with 9 standing warnings — all `max-lines`/`max-lines-per-function` hits on the god-files flagged in §6.) |

**To raise the score:** add the script dirs to `tsconfig`/eslint coverage (cheap), then stage `noUncheckedIndexedAccess` (bigger, but this codebase is unusually well-positioned to absorb it).

---

## 4. Accessibility & UX — 8.5/10

**Strengths**

- 423 `aria-*` usages in production client code; 28 `aria-live`, 18 `role="status"`, 14 `role="alert"`.
- Dedicated `.a11y.test.tsx` suites (~8 components) with `jest-axe` registered globally (`vitest.setup.ts:11-16`), plus top-level reduced-motion and contrast tests.
- Skip-to-content link and focus management on route change (`client/src/App.tsx:190-201`).
- **Keyboard-accessible drag-and-drop** with screen-reader announcements that reference real calendar dates rather than opaque ids (`client/src/pages/Timeline.tsx:45-71`).
- Consistent loading/empty/error surfaces (`LoadingSpinner`/`Skeleton` in 22 files, dedicated empty states, friendly error boundaries that hide stack traces in prod).
- Dark mode via a clean `ThemeProvider` respecting `prefers-color-scheme`.

**Improvements**

| Severity | Finding |
|---|---|
| **Medium** | **No form-validation library** (zero react-hook-form; the only client `zod` import is the offline queue). Every form is hand-rolled `useState` + manual dirty tracking, so inline-error/disabled-until-valid behavior is bespoke per form and inconsistent. |
| Low | **Theme flash (FOUC):** `client/index.html` has no blocking inline theme script; the `dark` class is applied in a `useEffect` after first paint (`ThemeProvider.tsx:22-27`), so dark-mode users can see a light flash on reload. |
| Low | Theme toggle is binary light/dark — no persisted "system" option once toggled. |

**To raise the score:** adopt one form pattern (react-hook-form + zod resolvers fits the existing stack) and add the standard 3-line inline theme script.

---

## 5. Dependencies & supply chain — 8.5/10

**Strengths**

- **19 pnpm overrides, each individually annotated** with GHSA/CVE id, the parent dependency pulling it in, and an explicit removal condition (`package.json`) — rare discipline.
- GitHub Actions pinned to **full commit SHAs**, not floating tags.
- `dependabot.yml` covers npm and github-actions weekly; `dependency-review.yml` fails PRs on newly introduced moderate+ advisories.
- Secret scanning (gitleaks), SAST (bearer, devskim) all run in CI.
- Node pinned three ways (`.node-version`, `nixpacks.toml`, `engines`); `packageManager: pnpm@9.12.0`.

**Improvements**

| Severity | Finding |
|---|---|
| Low–Med | **`engines.node: ">=20"` is looser than tested reality** — CI, nixpacks and `.node-version` all fix Node 20, but the range admits 22/24 where nothing is verified. `@types/node` is v25, mismatching the actual runtime. Pin `engines` to `>=20 <21` (or test on 22 and say so). |
| Low | `engines` doesn't declare pnpm, so nothing blocks a contributor running npm/yarn besides the lockfile. |
| Low | 113 total dependencies is moderate for the app's size; the vendored shadcn surface (32 files incl. a 747-line `sidebar.tsx`) carries some dead weight. |

**To raise the score:** tighten `engines`, align `@types/node` with the runtime major.

---

## 6. Architecture & code organization — 8.0/10

**Strengths**

- Clean explicit layering: routes → usecases → services → storage facade (14 domain storage classes behind `IStorage`), with `DbExecutor`/`Tx` types so storage methods can join a caller-owned transaction (`server/db.ts`).
- Disciplined composition root: bootstrap split into `server/bootstrap/{appConfig,health,lifecycle,observability}.ts`; startup is phased and **binds the HTTP port before running startup tasks** so health checks stay reachable during a failed boot (`server/index.ts:114-135, 304-420`).
- The workouts domain shows the target pattern: 6 focused route modules behind a thin aggregator, orchestration in `services/parseWorkoutUseCases.ts`.
- Shared domain layer is **truly isomorphic** — zero `node:`/server imports in `shared/` — with model modules like `shared/dateUtils.ts` (pure UTC epoch math with documented DST rationale).

**Improvements**

| Severity | Finding |
|---|---|
| **Medium** | **Two competing route idioms.** The `protectedPost/Patch/Delete` builder (`server/routes/_helpers/protectedRouteBuilder.ts`) is used in some modules, while others hand-roll middleware chains (`analytics.ts:151`, `plans.ts`, `strava.ts:426-430`, `garmin.ts`). There is no `protectedGet` at all, so every GET is hand-rolled. Each hand-rolled chain is a chance to forget a guard. |
| Medium | **Uneven decomposition:** `nutrition.routes.ts` (943 lines) remains a single god-file while sibling workouts was split into 6 modules; `garmin.ts` (702) bundles routes + SDK client + circuit breaker + mapper; `trainingLoadService.ts` (1021) and `coachService.ts` (863) are outsized. |
| Low | **Circular dependency `queue.ts` ↔ `emailScheduler.ts`** (`queue.ts:9` / `emailScheduler.ts:6`) — works only because bindings are used lazily inside functions. Extract the shared surface to break the cycle. |
| Low | `routeUtils.ts` is a grab-bag: rate-limiter factory + validation middleware + pagination + `asyncHandler` + *domain logic* (`calculateStreak`, line 96), with a stray mid-file `import { z } from "zod"` at line 121. |
| Low | No enforced boundary lint — `shared/`'s purity is convention-only; a `dependency-cruiser`/eslint-boundaries rule would lock it in. |

**To raise the score:** add `protectedGet`, migrate the hand-rolled modules to the builder, split `nutrition.routes.ts` along the workouts pattern.

---

## 7. Database & data layer — 8.0/10

**Strengths**

- Rich schema (`shared/schema/tables.ts`, 1,633 lines): **74 indexes** matched to real query shapes — `(userId, date)` composites, partial unique indexes for Strava/Garmin dedup, `pg_trgm` for search, HNSW for vectors — plus 42 FKs with deliberate delete semantics (34 cascade / 5 set-null / 3 restrict).
- **Schema invariants are test-enforced** — `tables.cascade.test.ts:35-45` asserts every user-owned table cascades, so a new table can't silently break account deletion. This is a standout practice.
- CI migration drift gate: `db:generate` + `git diff --exit-code migrations/` (`.github/workflows/migrations.yml:38-41`).
- Serious data migrations ship with post-migration validation (`0035_maf_artifacts.sql` + `0036` assertions). Only two genuinely destructive statements in 78 migrations.
- Row caps + column projection guard unbounded reads (`server/storage/shared.ts:70-114`); 31 transaction call sites; batch existence checks avoid N+1 (none found in sampled paths).
- Startup `migrate()` serialized across instances via advisory lock (`server/maintenance.ts:32-80`).

**Improvements**

| Severity | Finding |
|---|---|
| **Medium** | **5 journaled migrations have no snapshot file** (verified): `0016, 0018, 0036, 0039, 0041` — 73 snapshots vs 78 journal entries. Drift detection still works off the latest snapshot, but `drizzle-kit`'s base-state reconstruction relies on an incomplete chain — a latent consistency wart worth repairing while it's cheap. |
| **Medium** | **`drizzle.config.ts` points `schema` at only `./shared/schema/tables.ts`** while the schema is split across `tables.ts`, `nutrition.ts` (556 lines), `exercises.ts` (738), `enums.ts`. Everything must be re-exported through `tables.ts` or `db:generate` silently misses it. Use a glob (`./shared/schema/*.ts`). |
| Low | Migration filenames are random Drizzle slugs (`0072_wooden_cobalt_man`) — the few hand-named ones (`0074_food_search_trigram`) show the better pattern. |
| Low | `purgeUserJobs` reaches into pg-boss internals with raw `DELETE FROM pgboss.job` (`server/queue.ts:114-116`) — documented best-effort, but coupled to pg-boss's private schema. |
| Low | `WorkoutStorage` (910 lines/~66 methods) and `NutritionStorage` (1,018/~42) are becoming god-objects. |

**To raise the score:** widen the drizzle config glob and regenerate/backfill the missing snapshots — both quick.

---

## 8. Performance — 8.0/10

**Strengths**

- **Client:** every route lazy-loaded (`App.tsx:31-37`); timeline virtualized (`@tanstack/react-virtual`, `Timeline.tsx:294-299`) with memoized row components; deliberate manual chunking (`vendor-react/ui/query/charts/dnd` groups in `vite.config.ts:125-133`); client-side image compression before upload (`lib/image.ts:31-54`); SSE token batching via `requestAnimationFrame` (`lib/sseStream.ts`).
- **Server:** embedding + RAG caches with TTL/LRU; auto-coach debounced via pg-boss singleton keys; row caps and column projection in storage; per-session `statement_timeout` on queue connections (`queue.ts:39-48`); bounded in-batch concurrency (`pLimit`).
- 74 DB indexes matched to query shapes (see §7); Strava sync uses batch existence checks instead of per-row lookups.

**Improvements**

| Severity | Finding |
|---|---|
| Low–Med | **`TimelineWorkoutSurfaces` (52 props) is not memoized and receives fresh inline lambdas each render** (`Timeline.tsx:384-390`), so it re-renders on every Timeline state change. Impact is bounded (mostly closed dialogs) but it defeats memoization on that subtree. |
| Low | Virtualizer uses a fixed `estimateSize: () => 150` (`Timeline.tsx:297`) for variable-height day groups — can cause scrollbar jump on tall groups. |
| Low | `OfflineIndicator` polls queue length every 2s while offline (`OfflineIndicator.tsx:15,39-45`) instead of being event-driven. |
| Low | No performance budget/regression check in CI (a timeline benchmark script exists — `bench:timeline:check` — but isn't wired into any workflow). |

**To raise the score:** memoize the surfaces subtree and wire the existing timeline benchmark into CI.

---

## 9. Testing — 7.5/10

**Strengths**

- **Volume and shape:** 338 test files (158 server / 162 client / 16 shared, ~0.5 per source file) across a real pyramid — unit, integration (`fileParallelism: false` against real Postgres), a heavyweight smoke suite that spawns the built `dist/index.js` and exercises CRUD/CSRF/headers/auth (`server/routes/tests/smoke.test.ts`, 423 lines), and Cypress e2e sharded 2× in CI against `pgvector/pg16`.
- **Quality:** only 2 snapshot assertions in the whole suite; zero `.skip`/`.only`/`.todo`; domain tests assert hand-computed values with the math documented (`shared/energyBalance.test.ts:5-27`).
- Schema-invariant tests (§7) and a11y tests (§4) — both rare in practice.
- OpenAPI spec drift-checked at build time (`build.yml:31-37`).

**Improvements**

| Severity | Finding |
|---|---|
| **High** | **The 80% coverage thresholds are never enforced.** `vitest.config.ts:23-31` defines them, but no workflow runs `vitest --coverage` (verified: zero coverage references in `.github/workflows/`), and `sonar-project.properties` points at an lcov file CI never generates. `docs/testing.md:576` admits it. The number is aspirational, not a gate — with this test volume, turning it on is nearly free. |
| Medium | **No runtime API contract test** — the OpenAPI spec is diff-checked at build, but no test validates actual handler responses against the schema, so handler/spec drift is possible. |
| Low | `cypress.yml` triggers `on: [push]` only — **PRs get no integration/smoke/e2e coverage** before merge (the PR-gating `test.yml` excludes integration and smoke globs). |

**To raise the score:** add a coverage job (upload lcov to Sonar), and run the cypress workflow on `pull_request`.

---

## 10. CI/CD & deployment — 7.5/10

**Strengths**

- **Nine workflows** with real breadth: unit tests, build (ESLint + `tsc` + OpenAPI drift), Cypress, migration drift gate, post-migration checks, and **four security scanners** (gitleaks, bearer, devskim, dependency-review).
- Build script has anti-corruption guards — artifact size floors catch silent truncated builds (`script/build.ts:13-27,65`).
- **Proper liveness/readiness split:** Railway restarts on dependency-free `/api/v1/health/live` while readiness (`/api/v1/health`) probes DB+vector with a 5s cache and single-flight dedup (`server/bootstrap/health.ts:50-127`) — transient DB blips can't cause restart loops.
- Crash-safe startup wrapper: `script/start.js` spins up a fallback 503 health server on `uncaughtException` so the platform sees a real signal instead of connection-refused.
- Sentry sourcemap upload wired into the build, gracefully skipped without a token.

**Improvements**

| Severity | Finding |
|---|---|
| **Medium** | **No coverage job** (see §9) — SonarCloud's "coverage on new code" gate has no data to act on. |
| Medium | **The fast PR path never runs the production build.** `build.yml` type-checks and lints but doesn't execute `script/build.ts`; a build-only regression is caught only inside the Cypress workflow. Add `pnpm run build` to `build.yml` (it's already guarded by the size floors). |
| Low | Trigger inconsistency: `cypress.yml` is `on: [push]` (all branches, no PR events); `post-migration.yml` is dispatch-only. Normalize triggers across workflows. |
| Low | No Dockerfile — deployment is 100% Railway/nixpacks-specific, limiting portability and local prod-parity. |
| Low | `scripts/post-merge.sh` uses `npm install` (in a pnpm repo) and `drizzle-kit push --force` — a destructive footgun if that hook is ever activated. Delete or fix it. |

**To raise the score:** coverage job + build step in PR checks — both are ~10-line workflow changes.

---

## 11. AI/LLM subsystem — 7.5/10

**Strengths**

- **Multi-provider abstraction** (`server/ai/providers/`: gemini/anthropic/openai-compatible) behind a single `getTextAiProvider()`.
- **Layered resilience:** circuit breaker with state persisted across restarts and a probe watchdog; `retryWithBackoff` with per-call `AbortController` so hung sockets actually release (`server/gemini/client.ts:87-136`); SSE abort propagation from client disconnect to the provider stream.
- **Kill switch at three layers** (`AI_FEATURES_ENABLED` gates HTTP middleware, the client entrypoint, and the provider factory) so cron/service callers can't bypass it.
- **Consent + cost controls:** server-side opt-in consent middleware, per-user daily budget middleware, embedding/RAG caches, per-material chunk caps, and a medical-safety post-processing layer (`services/aiSafety.ts`).
- Prompt-injection defenses on input: `<user_input>` delimiters + HTML escaping (`gemini/chatService.ts:19-24`) and sanitized RAG chunks (`prompts/materialsBuilder.ts:48-49`).

**Improvements**

| Severity | Finding |
|---|---|
| **Medium** | **The daily budget is best-effort, not enforced.** `checkAiBudget` reads the day's spend *before* the call, while usage is recorded *after* via fire-and-forget `void recordAiUsage(...)` (verified at `server/ai/providers/index.ts:82`, `server/gemini/client.ts:281,295`) whose failures are swallowed. Concurrent requests all pass the pre-check before any spend lands, so the $2/day cap can be overshot; streaming/embedding costs are estimates. Fix: atomic reserve-before-call (single `INSERT ... RETURNING` upsert of the day's counter) with reconciliation after. |
| Low–Med | **The legacy coaching-materials prompt path is unsanitized:** `buildCoachingMaterialsSection` (used for freshly uploaded, not-yet-embedded materials) inserts raw content with only truncation (`materialsBuilder.ts:15-36`), unlike the sanitized RAG path. Injection is self-targeted, limiting impact, but the inconsistency is unnecessary. |
| Low | Output validation is a substring blocklist (`services/sanitize.ts:34-78`) — the code itself notes it is "inherently incomplete." Acceptable, but worth pairing with the safety post-processor everywhere output leaves the system. |
| Low | `MODEL_PRICING` hardcoded (`services/aiUsageService.ts:7-15`) and will drift as vendors reprice; mitigated by an expensive default fallback. |

**To raise the score:** make the budget authoritative — it is the only spot where a user can meaningfully exceed an intended limit.

---

## 12. Frontend architecture & state management — 7.0/10

**Strengths**

- Centralized query-key registry with parameterized factories (`lib/api/index.ts:54-100`) — key hygiene is genuinely good.
- A reusable optimistic-update abstraction doing textbook cancel→snapshot→apply→rollback, reused across 6 mutation sites (`hooks/workout-actions/optimisticTimeline.ts:11-38`).
- `useApiMutation` wrapper standardizes invalidation + toasts + typed `RateLimitError`/`AiBudgetExceededError` handling.
- Layered API client: domain modules → `typedRequest` (15s timeout) → one fetch chokepoint with centralized CSRF (cached token, auto-refresh once on 403) and error normalization that never leaks 5xx bodies (`lib/queryClient.ts:45-110`).
- Feature-level error boundaries per route; sensible TanStack defaults (5-min staleTime, no refetch-on-focus).

**Improvements**

| Severity | Finding |
|---|---|
| **Medium** | **Complexity pools in a few giants:** `Settings.tsx` — 925 lines with **28 `useState`** and ~40 lines of hand-built dirty tracking; `useWorkoutEditor.ts` — an **854-line hook** (bigger than any page except Settings); `WorkoutStructureEditor.tsx` 877; `ReviewSurface.tsx` 773; `TimelineWorkoutCard.tsx` 762; `LogSheet.tsx` 662. Fifteen files exceed 400 lines. |
| **Medium** | **Severe prop-drilling:** `TimelineWorkoutSurfacesProps` declares **52 props** (verified, `pages/timeline/TimelineWorkoutSurfaces.tsx:35-88`), all threaded from `Timeline.tsx`, which itself destructures ~90 values from 8 hooks. Group the dialog state into 3–4 cohesive objects or a context. |
| Low | Two mutation styles coexist (raw `useMutation` in 17 files vs `useApiMutation` in 13), so toast/invalidation behavior isn't uniform. |
| Low | The default `queryFn` builds URLs by `queryKey.join("/")` (`queryClient.ts:197`) — a foot-gun for non-URL keys; and `apiRequest` throws string-concatenated `Error`s that two separate parsers re-parse downstream (`humanizeApiError` vs `extractApiErrorCode`). A structured `ApiError` class would remove the string round-trip. |
| Low | 55-line imperative DOM scroll-lock `useLayoutEffect` inline in `App.tsx:116-170` — extract to a hook. |

**To raise the score:** split Settings and `useWorkoutEditor`, and collapse the 52-prop surface — those three changes remove most of the drag.

---

## 13. Offline & PWA — 7.0/10

**Strengths**

- Thoughtful Workbox config (`vite.config.ts:14-95`): NetworkFirst for programmatic `/api/*` with a `request.destination !== "document"` guard so export downloads bypass the SW; `navigateFallbackDenylist` for `/api`; CacheFirst fonts; SWR images.
- **The offline mutation queue is genuinely robust** (`lib/offlineQueue.ts`): zod-validated localStorage persistence, quota-exceeded eviction, size/retry/age caps with typed drop reasons, concurrency-safe flush that preserves mutations enqueued mid-flush, and replay with `X-Idempotency-Key` — matched server-side by the atomic idempotency middleware.
- Excellent offline UX surface: `OfflineIndicator` with offline/pending/synced states, `aria-live`, and an explicit drop toast so data loss is never silent.

**Improvements**

| Severity | Finding |
|---|---|
| **Medium** | **The queue has exactly one producer: workout create** (`useSaveWorkoutMutation.ts:81` is the sole `enqueueMutation` call). Nutrition logging, timeline changes, exercise-set edits, and settings saves all just fail offline, despite the "works offline" framing and fully generic infrastructure. Wire the highest-value writes (nutrition log, status change) into the same queue. |
| Med–Low | **Queued workouts are invisible until sync** — the offline path toasts and navigates away with no optimistic timeline insert (`useSaveWorkoutMutation.ts:42-48`). Users see nothing on the timeline until reconnect. |
| Low | No conflict handling beyond idempotent replay (fine for creates; needed before the queue ever covers edits). |

**To raise the score:** extend queue coverage to 2–3 more mutations and render queued items optimistically.

---

## 14. Error handling & observability — 7.0/10

**Strengths**

- Structured `AppError` + `ErrorCode` enum with a dedicated `classifyAiError`; central Express handler masks 500 internals and captures to Sentry (`server/index.ts:357-395`); `asyncHandler` everywhere.
- **Logging is privacy-conscious and correlated:** pino with an extensive redaction list shared with the Sentry scrubber, `AsyncLocalStorage` request-ids that propagate into queue jobs, PII minimization on success paths.
- Sentry `beforeSend` scrubs bodies/queries/cookies/user PII; fatal handlers flush-then-exit so the platform restarts cleanly.
- Health endpoints are best-practice (see §10).

**Improvements**

| Severity | Finding |
|---|---|
| **Medium** | **Background job failures never reach Sentry** — zero `Sentry.captureException` calls in `server/queue.ts`; worker catches only log-and-rethrow. Jobs that exhaust retries (or no-retry email jobs that throw) surface only in logs. There is no dead-letter queue and no alerting path. Error tracking is HTTP-centric in an app where much of the interesting work (AI coach runs, emails, syncs) happens in jobs. |
| Low–Med | **No metrics endpoint** (Prometheus/OpenMetrics) — no scrapeable latency/throughput/error-rate surface; observability is logs + Sentry + periodic queue-depth log lines. |
| Low | Email double-send window: if `sendWeeklySummary` succeeds but persisting the sent-marker throws (`emailScheduler.ts:70-72`), same-day startup catch-up can re-send. |
| Low | No `closeIdleConnections()` on shutdown — idle keep-alive sockets can hold `server.close()` until the 60s force-exit. |

**To raise the score:** one `Sentry.captureException` in the worker catch path plus a failed-jobs alert gets most of the value for ~20 lines.

---

## 15. Repo hygiene — 5.0/10

The clear outlier. None of this affects runtime, but it degrades every clone, checkout, and CI run — and it's all cheap to fix.

**Improvements**

| Severity | Finding |
|---|---|
| **High** | **`hyrox_results.csv` — 25 MB of race data — is committed at the repo root** (verified in `git ls-files`). It is ~50× the next-largest file and bloats every clone and CI checkout permanently (it's in history even if deleted). Move to object storage / a release asset / Git LFS, gitignore the path, and consider a history rewrite if repo size matters. |
| **Medium** | **Duplicate-cased agent dirs both tracked:** `.Jules/palette.md` AND `.jules/{bolt,palette,sentinel}.md` — a case-collision accident from AI tooling; consolidate and gitignore. |
| **Medium** | **Scratch files tracked in git:** `commit_msg.txt` (a leftover draft commit message) and `.plan_step` (0 bytes) at the root. |
| Low | `script/` (16 TS build/data files) vs `scripts/` (one shell hook) — two directories, one purpose; merge them. |
| Low | `.gitignore` lists `node_modules` ~8 times; harmless but sloppy. |
| Low | Root-level audit docs are resolved-but-present (see §2) — archive to `docs/archived/`. |

**Strengths (for balance):** zero TODO/FIXME litter, disciplined `.env.example`, debt tracked in documents, and `docs/archived/` shows the team already has the archival habit.

**To raise the score:** one small PR — remove/relocate the CSV, delete the scratch files, consolidate `.jules`, merge `script/`+`scripts/`. That alone takes this to ~8.

---

## Top 10 prioritized recommendations

Ranked by leverage (impact ÷ effort):

| # | Recommendation | Area | Impact | Effort |
|---|---------------|------|:------:|:------:|
| 1 | Remove the 25 MB CSV + scratch files (`commit_msg.txt`, `.plan_step`, `.Jules` dup) from git | Hygiene | High | Low |
| 2 | Add a CI coverage job (`vitest --coverage` + lcov → Sonar) — the thresholds already exist | Testing/CI | High | Low |
| 3 | Move Strava onto the shared Postgres rate limiter; add prod refine for `STRAVA_STATE_SECRET` | Security | Med-High | Low |
| 4 | Capture background-job failures to Sentry + add a failed-job alert path | Observability | Med-High | Low |
| 5 | Make the AI daily budget authoritative (atomic reserve-before-call, reconcile after) | AI/Cost | Med-High | Medium |
| 6 | Run the production build in PR checks; run integration/e2e on `pull_request` triggers | CI/CD | Medium | Low |
| 7 | Fix drizzle config to glob all schema files; backfill the 5 missing migration snapshots | Database | Medium | Low |
| 8 | Decompose the frontend hotspots: `Settings.tsx` (28 useState), `useWorkoutEditor.ts` (854 lines), the 52-prop `TimelineWorkoutSurfaces` | Frontend | Medium | Medium |
| 9 | Extend the offline queue beyond workout-create + optimistic rendering of queued items | Offline | Medium | Medium |
| 10 | Bring `script/`+`scripts/` under tsc/eslint; then stage `noUncheckedIndexedAccess` | Tooling | Medium | Med-High |

Honorable mentions: adopt one form-validation pattern (react-hook-form + zod), `protectedGet` + route-idiom unification, sanitize the legacy coaching-materials prompt path, split `nutrition.routes.ts`, inline theme script to kill the dark-mode FOUC, tighten `engines.node`.

---

## Methodology note

Findings were gathered by three parallel exploration passes (backend; frontend; testing/CI/database/docs) and then **verified**: every high-severity claim in this report was reproduced by direct file reads, greps, or counts before inclusion. Two agent claims failed verification and were corrected: the production `as any` count (reported 71 → verified **0**) and one pass's claim that all migration snapshots were present (verified: **5 missing**). As a baseline check, `pnpm check` (tsc) passed with 0 errors and `pnpm lint` passed with 0 errors / 9 warnings on a fresh install. Line references are accurate as of commit `a1f8fbb`.
