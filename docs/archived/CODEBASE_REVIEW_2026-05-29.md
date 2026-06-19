# Code Review Report — Hyrox Companion

Generated: 2026-05-29 (America/Chicago)
Branch reviewed: `claude/happy-bohr-cNk7D`

> **Status — 2026-05-29: historical baseline.** All findings below have been remediated
> (PRs #1290–#1297) — all findings resolved. See the Remediation Status
> matrix immediately below — the sections after it are retained as the original review
> evidence, not a current open-issues list.

Review basis: a fresh multi-pass audit of the current checkout across security,
privacy, performance, QA/correctness, DevOps, UX/accessibility, business logic, and
architecture. Method: three parallel exploration sweeps (security/privacy, backend
correctness/reliability, frontend/tests/build) followed by **direct code verification
of every load-bearing claim** — several candidate findings were inspected and
dismissed (see "Checked & Dismissed"). No source, config, or documentation files were
modified during this review.

This report follows the convention set by `docs/CODEBASE_REVIEW_2026-05-16.md`: it is a
new dated report against the current checkout, not an edit of the prior baseline.

---

## Remediation Status — 2026-05-29

All findings in this report have since been **remediated** across PRs #1290–#1297. The
sections below (Executive Summary onward) are retained unedited as the original review
evidence. This report is now a historical baseline; future reviews should start from the
current checkout and create a new dated report.

| ID | Finding | Status | Resolution |
| --- | --- | --- | --- |
| M1 | Redundant / conflicting CSP definitions | ✅ Resolved (#1290) | helmet now owns the CSP via a single `buildCspDirectives()` source (no `contentSecurityPolicy: false`, no override middleware); `server/middleware/csp.ts` + unit tests added. |
| M2 | Reusable Garmin credentials retained on dead connections | ✅ Resolved (#1292) | `setGarminError` now clears the stored email/password + cached OAuth tokens (columns made nullable, migration `0053`), keeping only the non-secret tombstone for the reconnect UI. **(a) was already satisfied** — `Privacy.tsx` §5 already disclosed Garmin credential storage; added a note covering the new auto-clear. |
| L1 | Stale CSRF debt entry | ✅ Resolved (#1290) | `TECHNICAL_DEBT.md` #22 marked RESOLVED with the `csrf-csrf` double-submit details; summary table → 28/28. |
| L2 | Sentry scrub list diverged from pino redact list | ✅ Resolved (#1290) | Added `x-cron-secret` / `x-internal-analytics-secret` to Sentry `beforeSend`. |
| L3 | Retry helper skipped transient network / timeout errors | ✅ Resolved (#1291) | `retryWithJitter` now retries `TimeoutError` + transient socket codes (never 4xx or a deliberate `AbortError`); unit tests added. |
| L4 | Prefix cache delete could sequential-scan | ✅ Resolved (#1291) | `text_pattern_ops` index on `server_runtime_cache.key` (migration `0052`). |
| L5 | One oversized module (`trainingLoadService.ts`, 806 lines) | ✅ Resolved (#1297) | Load Governor extracted to `server/services/trainingLoadGovernor.ts`; `trainingLoadService.ts` is now 669 lines and the lone lint warning is gone. |
| L6 | `showAdherenceInsights` default-on inconsistency | ✅ Resolved (#1291) | Confirmed intentional (display toggle, matches the column default); documented with a comment. |
| A1 | Reparse orchestration inline in route handlers | ✅ Resolved (#1291) | Extracted `server/services/parseWorkoutUseCases.ts`; handlers slimmed to validate-and-delegate; use-case unit tests added. |

**Remaining:** all findings (M1, M2, L1–L6, A1) are shipped. The only optional leftover is
the broader batch of non-blocking SonarCloud maintainability nits surfaced on the A1 PR
(#1291) — addressing them needs the private SonarCloud issue list.

**Corrections surfaced during remediation:** **M2(a)** was a stale recommendation — the
privacy policy already disclosed Garmin credential storage (`Privacy.tsx` §5), so only
the auto-clear behavior (M2b) required work.

**Follow-on improvements shipped (beyond the original findings):** a WCAG accessibility pass
— chart text alternatives + toast/accordion fixes (#1294); a single `SENSITIVE_REQUEST_HEADERS`
source of truth for log/Sentry header scrubbing plus a rate-limiter fail-closed doc note
(#1295); and a SonarCloud nested-template-literal cleanup (#1296).

---

## Executive Summary

The codebase is in **excellent health**. The May 16 review (overall 6.3/10) flagged two
release blockers and eight warnings; **all of them are resolved** and verified here.
The full test suite is green, the production dependency audit is clean, typecheck
passes, and lint is down to a single soft-cap warning.

This pass found **no Critical and no High severity issues**. The remaining items are
**2 Medium** (a CSP-configuration footgun and Garmin credential data-minimization) and
**6 Low** (mostly documentation drift and small hardening/maintainability nudges). The
security posture is strong defense-in-depth: AES-256-GCM at rest, double-submit CSRF,
nonce-based CSP, durable idempotency, per-user IDOR scoping, Postgres-backed rate
limits, and AI consent enforced on every provider route.

**Overall: 9.1/10.** Ship-healthy. The two Medium items are worth scheduling but are
not blockers.

---

## Verification

All commands run read-only against the current checkout (deps installed with
`pnpm install --frozen-lockfile --ignore-scripts`):

| Check | Command | Result |
| --- | --- | --- |
| Typecheck | `pnpm run check` (`tsc`) | **Pass** — 0 errors |
| Lint | `pnpm run lint` (`eslint`) | **Pass** — 0 errors, **1 warning** (`server/services/trainingLoadService.ts`: 806 lines > 800 `max-lines` cap) |
| Unit tests | `pnpm run test` (`vitest run`) | **Pass** — 1490 passed, 6 skipped (1496); 189 files passed, 1 skipped; 122s; exit 0 |
| Dependency audit | `pnpm audit --prod` | **Pass** — No known vulnerabilities |

Notes:
- The 1 skipped file / 6 skipped tests are all `server/services/aiEval.test.ts`, an
  opt-in `describe.runIf(runEval)` AI-evaluation harness — an intentional, gated suite,
  not a coverage gap.
- The full suite being green confirms prior **W7** (red `TimelineFilters` rename tests)
  is resolved.
- Test stderr contains intentional negative-path noise (e.g. a `FATAL Unhandled
  rejection: "bad"` and an `AI provider request failed` line) emitted by error-handler
  tests; the run still exits 0.

---

## Findings — Warnings (Medium)

| ID | Severity | Area | Finding | Evidence | Fix |
| --- | --- | --- | --- | --- | --- |
| M1 | Medium | Security, Maintainability | **Redundant, conflicting CSP definitions.** A full `helmet({ contentSecurityPolicy … })` block sets `connectSrc: ["'self'"]`, then a manual middleware unconditionally overwrites the `Content-Security-Policy` header on every request with the *real* allowlist (Clerk/Strava/Sentry/WS). The helmet directives are dead code, and the effective `connect-src` lives only in the manual middleware. If that middleware is ever removed or reordered, `connect-src` silently collapses to `'self'` and breaks auth + integrations with no test catching it. | `server/index.ts:151-167` (allowlist), `:174-200` (helmet CSP, `connectSrc:["'self'"]` at `:183`), `:202-220` (manual override) | Make CSP a single source of truth: either drop `contentSecurityPolicy` from the helmet call and keep only the nonce middleware, or generate both from the one `connectSrc` array. Add a smoke test asserting the response `Content-Security-Policy` contains the Clerk/Strava/Sentry origins. |
| M2 | Medium | Privacy | **Reusable Garmin credentials retained encrypted-at-rest indefinitely.** Garmin has no OAuth app flow, so the user's **email + password** are stored (AES-256-GCM) and replayed on token expiry (~1yr). They are correctly purged on explicit disconnect (`deleteGarminConnection`) and on account deletion (FK cascade), but a *broken* connection (Layer-4 fail-fast sets `lastError` and stops auto-retry) leaves the credentials sitting until the user acts. Reversibly-encrypted reusable passwords are materially more sensitive than OAuth tokens (an `ENCRYPTION_KEY` compromise exposes plaintext passwords, which users frequently reuse). | `server/storage/users.ts:294-297` (rationale), `:327-357` (encrypt/upsert), `:394-399` (delete); `server/garmin.ts:35-77` (7 safety layers); `.env.example:90-97` | (a) Disclose Garmin credential storage explicitly in the privacy policy (`client/src/pages/Privacy.tsx`). (b) Consider auto-purging the email/password ciphertext (keeping a tombstone row for the "Reconnect to Garmin" UI) once a connection is fail-fasted, so dead connections don't retain replayable credentials. |

---

## Findings — Suggestions (Low)

| ID | Severity | Area | Finding | Evidence | Fix |
| --- | --- | --- | --- | --- | --- |
| L1 | Low | Documentation | **Stale debt entry: CSRF.** `TECHNICAL_DEBT.md` #22 still says CSRF is "documented as acceptable — no action needed" on the basis of CORS + SameSite only. In reality CSRF was **implemented**: `csrf-csrf` is a dependency, `server/middleware/csrf.ts` exists and is wired in `registerRoutes`, and `CSRF_SECRET` is required in production (and must differ from `ENCRYPTION_KEY`). | `TECHNICAL_DEBT.md:62-68`; `server/middleware/csrf.ts`; `package.json` (`csrf-csrf`); `.env.example:27-32` | Update #22 to RESOLVED, describing the double-submit-cookie implementation. |
| L2 | Low | Security, Observability | **Sentry scrub list diverges from the pino redact list.** The pino logger redacts `x-cron-secret` and `x-internal-analytics-secret`, but Sentry's `beforeSend` scrubs only `authorization` / `cookie` / `x-csrf-token` / `x-idempotency-key`. An error captured on a cron/internal endpoint could carry those secret headers into Sentry. (Sentry already deletes `request.data`, so exposure is narrow.) | `server/logger.ts:20-36` vs `server/bootstrap/observability.ts:25-30` | Add `x-cron-secret` and `x-internal-analytics-secret` to the Sentry `beforeSend` header deletions; consider a shared constant so both lists stay in sync. |
| L3 | Low | Reliability, Integrations | **Outbound retry helper does not retry transient network errors.** `retryWithJitter` retries only `RetryableHttpError` (429 / 5xx); an `AbortSignal.timeout` (`AbortError`) or a TCP-level failure propagates immediately, so a timed-out Strava token refresh returns `null` and fails the whole sync run with no retry. This is by design (avoid retrying 4xx), but timeouts are exactly the transient class retries help with. | `server/utils/httpRetry.ts:37-70` (esp. `:52`); `server/strava.ts:85-124` | Optionally classify `AbortError`/`ETIMEDOUT`/`ECONNRESET` as retryable (bounded), or document the no-retry-on-timeout choice. |
| L4 | Low | Performance | **Prefix cache invalidation may sequential-scan.** `deleteRuntimeCachePrefix` runs `DELETE … WHERE key LIKE 'prefix%'`; a default-collation btree PK index won't serve a `LIKE` prefix without `text_pattern_ops`. Impact is currently negligible (the RAG cache is bounded ~2k rows). | `server/sharedRuntimeState.ts:41-43` | Note for future growth; add a `text_pattern_ops` index (or `key >= p AND key < p||'￿'` range) only if `server_runtime_cache` grows materially. |
| L5 | Low | Maintainability | **One oversized module.** `server/services/trainingLoadService.ts` is 806 lines, over the repo's 800-line `max-lines` soft cap (the sole lint warning). | `server/services/trainingLoadService.ts` | Extract a cohesive helper group (e.g. ACWR/load math) into a sibling module, behavior-preserving with the existing tests. |
| L6 | Low | Privacy, UX | **Preference default inconsistency.** The preferences serializer defaults `showAdherenceInsights ?? true` while every consent/email flag correctly defaults `false`. It is a display toggle (not AI/email consent), so risk is low, but the asymmetry is worth confirming as intentional. | `server/routes/preferences.ts:60-82` (esp. `:67`) | Confirm `true` is the intended default for adherence insights; if so, add a one-line comment distinguishing it from the opt-in consent flags. |

---

## Architecture / Maintainability

| ID | Severity | Finding | Evidence | Fix |
| --- | --- | --- | --- | --- |
| A1 | Low | **Self-acknowledged outstanding item.** Per `CODEBASE_AUDIT.md` §1, the reparse / image-parse / batch-reparse handlers still hold orchestration (build `parseTarget`/`referencePatch`, counter increments, 422 shaping) directly in the route layer instead of a thin `parseWorkoutUseCases.ts` validate-and-delegate wrapper. | `server/routes/workouts/workoutsAi.routes.ts:20-75`; `CODEBASE_AUDIT.md` §1 | Extract a `parseWorkoutUseCases.ts` so these handlers shrink to validate-and-delegate, matching `workoutUseCases.ts`. Carry forward as tracked debt. |

---

## Pass-by-Pass Detail

### 1. Security — 9/10
Strong, layered, and consistent. Mutating routes go through `protectedMutationGuards`
(auth + durable idempotency); AES-256-GCM protects tokens/credentials at rest;
double-submit CSRF (`csrf-csrf`) is enforced with a prod-required `CSRF_SECRET` that
must differ from `ENCRYPTION_KEY`; HSTS is preload-enabled; the request-id genReqId
guards against log injection. The only real items are **M1** (CSP defined twice, the
helmet copy being dead/misleading) and **L2** (Sentry scrub list drift). The Strava
OAuth state is HMAC-SHA256 signed with timing-safe comparison, and `ALLOW_DEV_AUTH_BYPASS`
is hard-blocked in production at the env layer.

### 2. Privacy — 8.5/10
Consent is opt-in and now defaults correctly to `false` for null rows on both server
and client (prior C2). AI consent gates every provider route (prior C1). Retention docs
align with the 7-day runtime TTL (prior W6). The standout consideration is **M2**: by
necessity Garmin stores the user's reusable email+password (encrypted); disclosing this
in the privacy policy and purging credentials for dead connections would tighten data
minimization. PII redaction is solid in pino; **L2** closes the Sentry gap.

### 3. Performance — 9.5/10
Multi-replica readiness is genuinely solid: every cron job runs under
`withPgAdvisoryLock` (Postgres `pg_try_advisory_lock`, released in `finally`), and
shared state lives in Postgres (`server_runtime_cache`, `rate_limit_buckets`). SSE
streaming aborts upstream Gemini generation on disconnect and honors backpressure via
`drain`. Charts (recharts) and `pdfjs` are code-split out of the initial bundle (lazy
Analytics route; dynamic pdfjs import). Only nit is **L4** (a bounded-table prefix
delete).

### 4. QA / Correctness — 9.5/10
1490 tests pass with zero failures; the only skips are an intentional, env-gated AI-eval
harness. Typecheck is clean under `strict`. Test factories and route-compliance tests
guard against consent/guard drift. No `.skip`/`.only`/`@ts-ignore` debt in source.

### 5. DevOps / Infrastructure — 9/10
Clean production dependency audit; an extensively documented set of pnpm security
overrides with CVE/GHSA rationale and removal conditions. Graceful shutdown aborts
in-flight SSE streams; cron has startup catch-up with idempotency guards;
queue-depth telemetry escalates to `warn` on backlog. Rate limiting is **fail-closed**
on store error (`passOnStoreError: false`) — the correct, secure default; documenting
the expected degradation during a Postgres outage in a runbook would round this out.

### 6. UX / Accessibility — 9/10 (lighter pass)
Error boundaries cover key surfaces; `jest-axe` coverage exists across multiple
components; dialogs and inline links have focus-visible affordances (recent commits).
This pass did not run a dedicated end-to-end a11y audit — if accessibility is a release
priority, commission a focused WCAG pass (keyboard traversal, screen-reader labels on
charts/data tables).

### 7. Business Logic — 9.5/10
The offline mutation queue is now wired into workout saves with replay-safe idempotency
keys (prior W3), onboarding completion is durable on the user row (`onboardingCompleted`,
prior W8), and user-scoped local data is cleared on signout/account deletion (prior W4).
Product copy and behavior are aligned.

### 8. Architecture — 9/10
Clear layering: routes → use-cases/services → storage, with Drizzle relations replacing
manual JOINs and a typed `AppError`/`ErrorCode` error model. The one tracked gap is **A1**
(parse-route use-case extraction) and the single oversized module **L5**.

---

## Verified Resolved Since Last Review (no action)

Confirmed against current code — all prior May 16 blockers/warnings hold fixed:

- **C1** — AI consent gates every AI provider route (`aiConsent: true` in
  `server/routes/ai.ts:46-389` and `workoutsAi.routes.ts:20-75`).
- **C2** — Null consent/notification values serialize to `false`
  (`server/routes/preferences.ts:64-68`).
- **W1** internal analytics auth+limit, **W2** AI budget fail-closed, **W3** offline queue
  wired, **W4** local-data cleanup, **W5** multi-replica (advisory-lock cron + Postgres
  shared state), **W6** retention docs, **W7** timeline tests green, **W8** durable
  onboarding.
- Additional verified strengths: durable idempotency middleware, SSE→Gemini abort
  propagation, AES-256-GCM crypto, per-user IDOR scoping, nonce CSP + HSTS preload,
  Postgres-backed persistent rate limiting, recharts/pdfjs code-splitting.

## Checked & Dismissed (inspected, **not** issues)

These surfaced as candidate findings during the sweep but did not survive code review —
recorded so future passes don't re-flag them:

- **Account-deletion ordering** (`server/routes/account.ts:32-79`): deauthorizing Strava
  *before* the cascading DB delete is intentional and correct — the token must still
  exist to revoke it. Not a race.
- **SSE "done" write** (`server/routes/ai.ts:237`): guarded by `controller.signal.aborted`
  with backpressure/drain handling and `finally` cleanup. Robust.
- **Strava state double-hash before `timingSafeEqual`** (`server/strava.ts:60-65`): a
  legitimate equal-length comparison pattern, not over-engineering or a bug.
- **Triple-gated `ALLOW_DEV_AUTH_BYPASS`**: defense-in-depth (env refine + runtime checks),
  a strength, not redundancy to remove.
- **`react-markdown` without explicit `skipHtml`**: safe — v10 defaults `skipHtml: true`.
- **`passOnStoreError: false`** rate limiting: fail-closed is the secure choice (does not
  let store errors bypass limits).
- **recharts bundle size**: already code-split via the lazy Analytics route; not in the
  initial bundle.

---

## Score Summary

| Pass | Score | Rationale |
| --- | ---: | --- |
| Security | 9.0/10 | Layered defense-in-depth; only CSP-duplication footgun + Sentry scrub drift. |
| Privacy | 8.5/10 | Consent/retention fixed; Garmin reusable-credential retention is the open consideration. |
| Performance | 9.5/10 | Multi-replica-safe, SSE backpressure, code-splitting; one bounded-table nit. |
| QA / Correctness | 9.5/10 | Green suite (1490 tests), strict types, drift-guard tests. |
| DevOps | 9.0/10 | Clean audit, documented overrides, graceful shutdown; runbook note suggested. |
| UX / Accessibility | 9.0/10 | Error boundaries + jest-axe; no dedicated WCAG pass this round. |
| Business Logic | 9.5/10 | Offline sync, onboarding durability, local-data cleanup all aligned. |
| Architecture | 9.0/10 | Clean layering; one parse-route extraction + one oversized file outstanding. |

**Overall: 9.1/10.** A mature, well-tested, security-conscious codebase. No release
blockers.

---

## Recommended Fix Sequence

1. **M1** — Collapse CSP to a single source of truth (drop the dead helmet CSP block or
   derive both from one allowlist) and add a header smoke test.
2. **M2** — Disclose Garmin credential storage in the privacy policy; consider purging
   credentials for fail-fasted connections.
3. **L1** — Update `TECHNICAL_DEBT.md` #22 to reflect that CSRF is implemented.
4. **L2** — Add the two secret headers to Sentry `beforeSend` (shared constant with pino).
5. **L3 / L6** — Decide retry-on-timeout policy for outbound calls; confirm the
   `showAdherenceInsights` default.
6. **L5 / A1** — Opportunistically split `trainingLoadService.ts` and extract
   `parseWorkoutUseCases.ts` when next touching those areas.
7. **L4** — Revisit only if `server_runtime_cache` grows materially.
