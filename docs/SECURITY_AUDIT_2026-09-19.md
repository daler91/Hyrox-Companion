# Security Audit — 2026-09-19

Scope: full codebase (Express 5 server, React/Vite client, shared schema, scripts, CI, dependencies). Read-only review; no code changed. Every finding below was confirmed by reading the code path end to end; SSRF-guard bypasses were also confirmed by executing `checkSafeOutboundUrl`.

**Headline:** no Critical or High findings. The app is unusually well hardened (nonce CSP, double-submit CSRF, Postgres-backed rate limits, AES-256-GCM at rest with a versioned keyring, HMAC OAuth state with single-use claims, timing-safe secret comparison, user-scoped RAG, opt-in AI consent, `pnpm audit` clean at 0 vulnerabilities). The findings are gaps in otherwise consistent controls.

---

## MEDIUM

### [MEDIUM] — PATCH /api/v1/workouts/:id accepts an unowned `planDayId` / `planId`
**File:** `shared/schema/types/workouts.ts:38-103`, `server/routes/workouts/workoutsCrud.routes.ts:201-203`, `server/services/workoutService/workouts.ts:295-299, 336-340`
**Risk:** An authenticated user can link their own workout to another user's plan day. The row update is owner-scoped, but the incoming `planDayId`/`planId` values are never validated. Later set edits trigger `recomputeAdherenceIfPlanLinked` → `persistAdherenceSnapshot` (`server/services/workoutService/loggedSetChange.ts:87-105`, `adherence.ts:58-68`), which reads the victim's prescribed exercise sets by `planDayId` and writes `plannedSetCount` / `matchedSetCount` / `compliancePct` onto the attacker's row. That is a read oracle for the victim's prescribed set count (and, via name matching, exercise names), plus a persistent FK from attacker data into victim plan rows. Exploitation requires knowing the victim's plan-day UUID, which bounds severity to Medium.
**Evidence:** `insertWorkoutLogSchema` omits `userId` and the adherence/device-link columns but not `planDayId`/`planId`; `updateWorkoutLogSchema = insertWorkoutLogSchema.partial()`. The create path validates ownership via `resolveActivePlanLinks` (`workouts.ts:53-61`) and the dedicated `PATCH /workouts/:id/plan-day` route validates via `getPlanDay(planDayId, userId)` (`workouts.ts:413-417`); the generic PATCH does neither.
**Fix:** In `server/routes/workouts/shared.ts`, build `updateWorkoutRouteSchema` from `updateWorkoutLogSchema.omit({ planDayId: true, planId: true })` so plan linking only happens through the ownership-checked `/plan-day` route. On create, always set `planId` from `resolveActivePlanLinks` (`planId: planLinks.planId ?? null`) instead of keeping a client value when no plan matches (`workouts.ts:64-70, 200-205`).

### [MEDIUM] — AI consent (`aiCoachEnabled`) bypassed on planned-session-estimate
**File:** `server/routes/nutrition/nutritionSummary.routes.ts:282-287`, `server/services/sessionEstimate/plannedSessionEstimate.ts:117-140`
**Risk:** Every other AI route and background job honours the opt-in consent enforced by `server/middleware/aiConsent.ts` (schema default `aiCoachEnabled = false`). This endpoint sends the plan day's focus text and exercise rows to the AI provider for users who never opted in, contradicting the privacy contract in the README.
**Evidence:** Route is mounted with only `isAuthenticated` + `rateLimiter`; `refineWithAi` checks `AI_FEATURES_ENABLED` and `checkAiBudget` but never `user.aiCoachEnabled`. `day.focus` and exercise names are also interpolated without `sanitizeUserInput` (self-scoped, minor).
**Fix:** Add `aiConsentCheck` to the route middleware (or convert to `protectedGet`-style stack with `aiConsent: true`), and inside `refineWithAi` return `fallback` when the user has not consented so the cron/queue callers are also covered. Wrap `focus`/exercise names with `sanitizeUserInput`.

### [MEDIUM] — Service worker caches authenticated `/api/*` responses; not user-scoped, never cleared on sign-out
**File:** `vite.config.ts:40-58`, `client/src/lib/userLocalData.ts:31-35`
**Risk:** Workbox `NetworkFirst` caches every fetch under `/api/` (auth/user, chat history, workouts, nutrition, analytics) in Cache Storage keyed by URL only, 50 entries, 5-minute TTL, 10-second network timeout. On a shared device, after user A signs out their API bodies remain at rest, and if user B signs in while offline or on a slow network Workbox serves A's cached responses for the same URLs. `clearUserLocalData()` never calls `caches.delete()`; there is no `caches.` usage anywhere in `client/`.
**Evidence:** `urlPattern: url.pathname.startsWith("/api/") && request.destination !== "document"` with `cacheName: "api-cache"`.
**Fix:** Exclude personal endpoints from runtime caching (or restrict the pattern to genuinely public/static API data), and add `await caches.delete("api-cache")` to `clearUserLocalData()` so sign-out and account deletion purge it.

### [MEDIUM] — Client Sentry has no `beforeSend` scrubbing; error strings embed 4xx bodies and breadcrumbs carry query strings
**File:** `client/src/lib/errorReporting.ts:24-34`, `client/src/lib/queryClient.ts:144`, `client/src/hooks/useNavigationBreadcrumb.ts:13-19`
**Risk:** The server Sentry setup scrubs bodies, cookies, headers, user email/IP and breadcrumb URLs (`server/bootstrap/observability.ts:16-92`); the client only sets `sendDefaultPii: false`. `apiRequest` throws `new Error(\`${status}: ${text}\`)` where `text` is the raw response body (Zod errors echo submitted field values, Garmin/Strava error text), and these reach Sentry via `Sentry.reactErrorHandler` / `ErrorBoundary`. Navigation breadcrumbs include `pathname?search` (`/nutrition?date=…&meal=…`, `/?workout=<id>`). Mitigated by the privacy-banner gate and per-user opt-out, but consented users still leak more than intended.
**Fix:** Add `beforeSend` / `beforeBreadcrumb` to the client `Sentry.init` that strips query strings from URLs and breadcrumbs and truncates/redacts the `NNN: <body>` message pattern; mirror the server's `SENSITIVE_REQUEST_HEADERS` approach.

### [MEDIUM] — Garmin password stored reversibly and retained after tokens are obtained
**File:** `server/garmin.ts:257-262, 436, 466-480`, `server/storage/users.ts:587-593`
**Risk:** The user's Garmin email and password are AES-256-GCM encrypted (recoverable with `ENCRYPTION_KEY`) and kept alongside long-lived OAuth1/2 tokens for automatic re-login. A DB + key compromise yields full Garmin account credentials rather than scoped tokens. The unofficial scraping library `@flow-js/garmin-connect@1.6.18` handles the password, and the error translator advises users to disable Garmin two-step verification. This is a documented design trade-off, disclosed inline in the connect form; mitigations (credential wipe on failure, 5/15-min limiter, per-user mutex, global 429 breaker, Zod body schema) are in place.
**Fix:** Drop the password once tokens are obtained and require an explicit reconnect on expiry; remove the "disable 2FA" guidance in favour of a "reconnect" prompt.

### [MEDIUM] — AI cost controls are per-user only, check-then-act, with no global cap
**File:** `server/middleware/aibudget.ts:32-42`, `server/services/aiUsageService.ts:144, 211-219`, `server/ai/providers/index.ts:287-331`
**Risk:** $2/day per user is checked before the call and recorded fire-and-forget after, so concurrent requests within one rate-limit window all pass. There is no application-wide daily cap, so total spend scales linearly with Clerk sign-ups. Under-counting paths: streaming usage recorded only if the provider emitted a usage chunk before abort; a server-side timeout after the provider billed records nothing (`retry.ts:309-314`); embeddings billed at a flat 150-token estimate.
**Fix:** Add a global daily budget (env-configurable) checked alongside the per-user one; reserve an estimated cost atomically before the call and reconcile after; record a conservative estimate on timeout.

### [MEDIUM] — Production runtime pinned to end-of-life Node 20
**File:** `nixpacks.toml:2`, `.node-version`, `package.json:666`, `.github/workflows/post-migration.yml:28`
**Risk:** Node 20 reached end-of-life on 2026-04-30; production and CI no longer receive security patches for the runtime, OpenSSL, or `undici`.
**Fix:** Move `nixPkgs` to `nodejs_22`, bump `.node-version` to `22`, set `engines.node >=22`, and update the CI matrix; run the test suite on 22 before deploying.

---

## LOW

### [LOW] — Hidden client sourcemaps ship to the public assets folder when the build has no Sentry token
**File:** `vite.config.ts:96-108, 119`, `server/static.ts:22-28`
**Risk:** `build.sourcemap: "hidden"` emits `.map` files into `dist/public/assets`; they are only deleted by the Sentry plugin's `filesToDeleteAfterUpload`, which is disabled when `SENTRY_AUTH_TOKEN` is unset. `express.static` then serves them at `/assets/*.map` with a one-year cache. This exposes readable client source (no secrets), easing reverse engineering.
**Fix:** Delete `dist/public/**/*.map` unconditionally in `script/build.ts` after the Sentry step, or set `sourcemap: false` when the token is absent.

### [LOW] — Client-settable device-provenance columns on workout create/update
**File:** `shared/schema/types/workouts.ts:38-100`, `server/services/deviceActivityLink.ts:268-272`
**Risk:** `source`, `stravaActivityId`, `garminActivityId`, `startedAt` are accepted from the client, so a user can forge a "strava" import that satisfies `linkStandaloneDeviceLog`'s checks. Dedupe queries are per-user, so integrity only.
**Fix:** Omit these from the insert/update schemas; let sync and link routes set them server-side.

### [LOW] — `updatePlanDaySchema` exposes server-managed columns
**File:** `shared/schema/types/plans.ts:45-47`, `server/routes/plans.ts:225-237`, `server/storage/plans.ts:292-308`
**Risk:** `status`, `skipReason`, `aiSource`, `aiRationale`, `aiInputsUsed`, `aiNoteUpdatedAt` are writable via PATCH, bypassing the status-transition rules in `updatePlanDayStatus` and the coach-note cooldown keyed on `aiNoteUpdatedAt`. Own data only.
**Fix:** `.omit()` those fields from `updatePlanDaySchema`; route status changes through the dedicated status endpoint.

### [LOW] — Raw error strings returned from `GET /api/v1/plans/:id/generation-status`
**File:** `server/routes/plans.ts:218-222`, `server/services/planGenerationService.ts:1032-1033`
**Risk:** `generationError` stores `error.message` verbatim from any thrown error; provider or DB messages can leak to the client.
**Fix:** Store a fixed error code plus a user-safe message; log the raw message server-side only.

### [LOW] — Authenticated routes with no rate limiter
**File:** `server/routes/plans.ts:145, 151`, `server/routes/preferences.ts:123`, `server/strava.ts:869, 872`, `server/garmin.ts:755, 763`
**Risk:** `GET /plans`, `GET /plans/:id` (full plan + all days), `GET /preferences`, Strava/Garmin `status` and `disconnect` can be hammered by an authenticated user. Every other route, including all AI/LLM, email, export, image-parse and food-search proxies, is limited.
**Fix:** Wrap with `rateLimiter("plansRead", 60)` etc., matching the existing convention.

### [LOW] — SSRF guard gaps
**File:** `server/ssrfGuard.ts`, `server/ai/providers/openaiCompatible.ts:428-436`, `server/routes/push.ts:413-417`
**Risk:** `checkSafeOutboundUrl` returns ok for `http://[::]/`, CGNAT `100.64.0.0/10` (Alibaba metadata at 100.100.100.200), `localhost.` (trailing dot), `*.localhost`, NAT64 `64:ff9b::/96`, and multicast/reserved `224/4`, `240/4`. Decimal, hex, octal, IPv4-mapped and RFC1918 forms are correctly rejected. The OpenAI-compatible client follows redirects with no post-redirect host check (Node strips `Authorization` cross-origin but the prompt body is re-POSTed), and the DNS check runs only at startup. Impact is limited because `AI_TEXT_BASE_URL` is operator-supplied; the same literal-only gaps apply to user-supplied push endpoints, offset by HTTPS-only and send-time re-resolution.
**Fix:** Add the missing ranges to `isPrivateIpv4`/`isPrivateIpv6`, reject hostnames ending in `.localhost` or a trailing dot, set `redirect: "manual"` (or re-check the redirect target) in the provider client, and cap push subscriptions per user (see below).

### [LOW] — Unsanitized user text in system instructions (self-scoped)
**File:** `server/gemini/exerciseParser/provider.ts:255-261`, `server/gemini/planAdjustmentService.ts:63-67`
**Risk:** Custom exercise names are joined raw into `systemInstruction`; client-supplied `focusPlanDayId` is interpolated raw into a prompt. Only the requesting user's own data is affected; `sanitizeUserInput` is HTML-entity escaping only, so natural-language injection defence rests on the output blacklist and strict Zod on JSON paths (which are in place).
**Fix:** Pass both through `sanitizeUserInput` and wrap in `<user_input>` delimiters like the other prompt builders.

### [LOW] — Model output length not bounded before DB write (auto-coach queue path)
**File:** `server/gemini/suggestionService.ts:43-51`, `server/services/coachService.ts:256, 321`
**Risk:** `recommendation: z.string()` has no max; the queue path writes it into `plan_days` unbounded while the manual apply route caps at 10,000.
**Fix:** `.max(10_000)` on the schema so both paths share the cap.

### [LOW] — Image parse trusts declared MIME type; base64 never decoded or validated
**File:** `shared/schema/types/requests.ts:74-82`, `server/gemini/exerciseParser/provider.ts:320`, `server/services/nutrition/visionParsing.ts:199`
**Risk:** Enum MIME + 10 MB string-length cap only; no magic-byte check. Impact is wasted spend and provider errors, not code execution.
**Fix:** Decode and check magic bytes for JPEG/PNG/WebP before forwarding.

### [LOW] — No cap on push subscriptions per user
**File:** `server/storage/push.ts:7-17`, `server/routes/push.ts:451`
**Risk:** Unlimited `(userId, endpoint)` rows plus `POST /push/test` let an authenticated user make the server POST small encrypted payloads to many arbitrary public HTTPS hosts.
**Fix:** Cap subscriptions per user (e.g. 10) and reject non-standard push service hosts.

### [LOW] — Per-user analytics/AI snapshot data persists in localStorage after sign-out
**File:** `client/src/lib/userLocalData.ts:3-19`, `client/src/lib/analyticsSnapshot.ts:23-29`
**Risk:** Keys `fitai-coach-insights-cache:<userId>`, `fitai-race-prediction-cache:<userId>`, `fitai-overview-analysis-cache:<userId>`, `fitai-maf-tests-cache:<userId>` and `weeklyReviewPrompt` dismiss keys are not in the clear list, so AI coaching narratives and heart-rate test data survive sign-out and account deletion on a shared device.
**Fix:** Add `fitai-*-cache:` and the weekly-review prefixes to `LOCAL_STORAGE_PREFIXES`.

### [LOW] — Push service worker navigates to an unvalidated URL from the payload
**File:** `client/public/sw-push.js:11, 20, 29-33`
**Risk:** `clients.openWindow(data.url)` will open any `https:` URL. Payloads are VAPID-signed and server-originated, so this requires server or key compromise.
**Fix:** Require `new URL(url, self.location.origin).origin === self.location.origin` before navigating; use `startsWith` instead of `includes` on the origin check.

### [LOW] — Two service workers registered at the same scope
**File:** `client/src/main.tsx:60-72`
**Risk:** Both `registerSW()` and `register("/sw-push.js")` use default scope `/`, so the second replaces the first; either push handling or offline caching silently stops working depending on timing. Not exploitable, but it affects whether the API-cache finding above is live.
**Fix:** Merge push handling into the Workbox SW (via `injectManifest`) or register the push worker under a distinct scope.

### [LOW] — Secrets and config hygiene nits (no real secrets found)
**File:** `.claude/settings.local.json`, `.github/workflows/post-migration.yml:37-47`, `.github/workflows/cypress.yml:148, 154`, `server/email.ts:205`, `server/strava.ts:46-49`
**Risk:** Working tree and git history were scanned for `sk_live_`, `pk_live_`, `AIza`, `re_`, `xox[bp]`, connection strings with passwords, Sentry DSNs and PEM keys: only placeholders. `.gitleaksignore` suppresses one fake test secret. Nits: `.claude/settings.local.json` is committed and contains local Windows paths; the post-migration workflow runs migrations against a live Neon database from CI; `SESSION_SECRET` in the Cypress workflow is a dead variable; a default sender address is hardcoded in `email.ts`; `STRAVA_STATE_SECRET` is optional and falls back to a per-process random secret, so OAuth states fail across replicas (availability only).
**Fix:** Untrack `.claude/settings.local.json` and add it to `.gitignore`; scope the CI database credential to a disposable branch database; delete the dead env var; make `STRAVA_STATE_SECRET` required in production.

### [LOW] — Dependency hygiene
**File:** `package.json`, `script/patch-cypress-deps.js`
**Risk:** `pnpm audit` reports 0 vulnerabilities across 1365 packages; Express 5.2.1; well-documented `pnpm.overrides`. `@modelcontextprotocol/sdk` is a direct dependency with no imports anywhere, dragging in `hono` and forcing several overrides. The `postinstall` script executes the Cypress binary and runs `npm install` into a temp dir on every dev install (skipped in production, uses `--ignore-scripts` and exact pins) — acceptable but a non-trivial supply-chain surface for a cosmetic scanner fix.
**Fix:** Remove `@modelcontextprotocol/sdk` and the overrides it required; consider dropping the Cypress patch script or pinning it behind an explicit opt-in.

---

## INFO

- **Chat role is client-settable.** `POST /api/v1/chat/message` accepts any `role` (`shared/schema/types/requests.ts:5-8`); a user can seed "assistant"/"system" turns into their own stored history. Self-only; history is sanitized and delimited before reaching the model.
- **Unbounded JSON passthrough in structure steps.** `intensity`, `tempo`, `groupMeta` are `z.record(z.string(), z.unknown())` bounded only by the 100 kb body limit (`shared/schema/types/workouts.ts:388-394`).
- **Client-only Cypress auth bypass survives in the production bundle.** `"Cypress" in window` skips `ClerkProvider` (`client/src/App.tsx:43-53`). Requires script execution already, and the server still enforces auth on every call. Guard with `import.meta.env.DEV` too.
- **Health endpoints are public by design** and expose uptime, startup phase and DB status (`server/bootstrap/health.ts`). Raw startup error text is correctly withheld.

---

## Verified OK (coverage)

- **Auth:** every `/api/v1` route uses `isAuthenticated` or the `protected*` builders. Intentional exceptions (csrf-token, Strava webhook, Strava callback, cron with `CRON_SECRET`, health) are correctly gated; secrets compared with hashed `timingSafeEqual` and fail closed when unset. Dev bypass is double-guarded on `NODE_ENV !== production` and rejected at env-parse time; `pk_live_` keys with non-production `NODE_ENV` abort boot.
- **IDOR:** every `:id`-taking path (workouts, sets, plans, plan days, proposals, coaching materials, recycle bin, annotations, MAF tests, nutrition logs/foods/servings/recipes/targets, bulk delete, combine, device link, migration resolve) traced to a `userId`-scoped query. The single exception is the workout PATCH plan-link finding above.
- **Mass assignment:** `userId` always injected server-side; no `.passthrough()` / `z.any()` in route schemas; storage `create` methods pick fields explicitly (exceptions listed above).
- **SQL:** no `sql.raw`, no string concatenation into SQL; all `sql` templates are Drizzle-parameterized; `LIKE` inputs escaped; rate-limit and runtime-cache stores use `$1/$2` placeholders.
- **CSRF:** `csrf-csrf` double-submit on all mutating `/api/v1` routes, `__Host-` cookie, `httpOnly`/`sameSite=strict`/`secure`, bound to Clerk `userId`, `CSRF_SECRET` required in prod and must differ from `ENCRYPTION_KEY`.
- **Headers:** helmet with nonce-based `script-src` (base64url nonce, no attribute-breaking chars), `frame-ancestors 'none'`, HSTS 1y + preload, `Permissions-Policy`, `x-powered-by` disabled, `upgrade-insecure-requests` in prod. `style-src 'unsafe-inline'` is a documented trade-off for Recharts/Radix.
- **CORS:** allowlist from `APP_URL` + `ALLOWED_ORIGINS`; unknown origins get no CORS headers; `trust proxy` is env-configurable.
- **Body limits:** 100 kb global, 2 mb coaching materials, 10 mb image-parse paths, with a friendly 413.
- **Encryption:** AES-256-GCM, 12-byte IV, 16-byte tag enforced, versioned keyring with rotation and re-encrypt job; weak/test keys rejected in prod.
- **OAuth (Strava):** HMAC-SHA256 state with nonce + TTL + constant-time compare + single-use claim; tokens encrypted at rest; refresh serialised under advisory lock; redirect URI fixed from `APP_URL`; all outbound calls have timeouts.
- **Webhooks (Strava):** verify token via `timingSafeEqual`, Zod-validated events, forged events can only enqueue a debounced sync for an already-connected owner, IP flood guard.
- **AI/RAG:** vector search filtered by `user_id`; retrieval caches keyed by hashed `userId`; chat, history, notes, plan names, constraints, set notes and PR names pass `sanitizeUserInput` and are delimited; no tool/function calling exposed to the model; no `eval` on model output; all model JSON parsed with Zod `safeParse`; kill switch enforced at provider entrypoints.
- **Email:** all user-controlled fields HTML-escaped; links point to authenticated pages; no guessable unsubscribe tokens.
- **Logging:** sensitive headers and body fields redacted; query strings stripped from access logs; user id withheld from success-path logs; request ids validated against log injection.
- **Client XSS:** zero `dangerouslySetInnerHTML`/`innerHTML`/`eval`; all AI markdown through `react-markdown` + `rehype-sanitize` (no `rehype-raw`); no `window.open`, `postMessage` or `window.opener`; open-redirect params compared against allowlists; CSV export prefixes formula characters; image upload re-encodes via canvas; coaching uploads check magic bytes.
- **Client secrets:** only publishable keys and feature flags in `VITE_*`; `SENTRY_AUTH_TOKEN` build-time only.
- **Account deletion:** cascades on every `user_id` FK, explicit vector-DB purge, Clerk deletion, Strava deauth, rate-limit and job purge, resumable erasure sweep.
- **Dependencies:** `pnpm audit` 0 vulnerabilities; overrides documented with CVE/GHSA ids.

---

## Summary

| Severity | Count | Top Concern |
|----------|-------|-------------|
| CRITICAL | 0 | — |
| HIGH | 0 | — |
| MEDIUM | 7 | Workout PATCH accepts an unowned `planDayId` (cross-tenant FK + adherence oracle); AI consent bypassed on session estimate; service worker caches personal API data unscoped |
| LOW | 15 | EOL Node 20 in production; shipped sourcemaps; SSRF-guard range gaps; missing rate limits on a handful of reads |
| INFO | 4 | Client-settable chat role; Cypress bypass in prod bundle |

Recommended order of remediation: (1) omit `planDayId`/`planId` from the workout update schema, (2) add `aiConsentCheck` to the planned-session-estimate route, (3) exclude personal `/api/` routes from Workbox caching and purge `api-cache` on sign-out, (4) upgrade to Node 22, (5) add client Sentry scrubbing, (6) global AI budget cap, then the Low items in any order.
