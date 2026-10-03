# Codebase Analysis — 2026-10-03

**Method.** The analysis ran in three stages.
1. **Discovery.** 28 agents reviewed the code: 18 subsystem mappers that between them cover every production file, and 10 cross-cutting lenses (security, data integrity & concurrency, privacy, client/server contract, performance, architecture, testing, the prior-audit ledger and docs, UX & accessibility, and AI reliability). Each mapper read every production file in its scope in full and skimmed the tests for what they pin and mock. Each lens swept the whole tree for its own concern. Together they read about 290k lines (lenses and subsystems overlap by design) and raised **391 findings**.
2. **Deduplication.** Three merge passes folded 69 duplicate reports into **322 distinct findings**. A duplicate here means the same root cause, fixed by a single change. For example, the Strava OAuth callback defect was reported by three reviewers.
3. **Adversarial verification.** Every distinct finding went to independent verifiers instructed to refute it.
   - Each of the 21 findings rated high or critical at any point got two verifiers with different briefs: one to trace and reproduce, one to look for guards and calibrate severity. A tie-breaker was ready for disagreements, but none was needed: the two agreed on every real-versus-refuted call.
   - Mediums went to one verifier each, in batches of five.
   - Lows got one quick-check verifier each, in batches of ten.
   - Verifiers ran code (a targeted vitest file or a tsx repro) for 48 findings.

**Result: 315 survived (259 confirmed, 56 partially confirmed with corrected details) and 7 were refuted**, all of them low. Verification changed the severity of 46 surviving findings (43 down, 3 up). Of the 20 findings raised as high or critical, 7 stay high and 13 were calibrated to medium; one medium was raised to high. About 138 agents completed. Severities below are the post-verification ones, and each table's verdict column says what the verifiers corrected.

**Snapshot.** HEAD `4ad6804` (2026-10-03).
- **Size.** About 276.9k lines of TS/TSX across 1,654 files, 4.5k of them generated. Production code, excluding tests and generated files, is about 157k lines: client 66.4k, server 71.6k, shared 14.7k, scripts 4.2k.
- **Tests and CI.** 626 vitest files (about 111k lines, 40% of all TS) and 12 Cypress specs. 9 GitHub Actions workflows.
- **Schema.** 120 SQL migrations, journal-consistent from 0000 to 0119.
- **Dependencies and markers.** 70 production and 46 dev dependencies. No TODO or FIXME markers anywhere in the TS source.
- **Baseline at HEAD** (run for this analysis on a 4-core container): `tsc` is clean; ESLint reports 0 errors and 8 warnings (`max-lines` and `complexity` only); vitest passes 607 files (2 skipped) and 6,730 tests (34 skipped) in 7m25s.
- **Since the last analysis** (`642fe2f`, 2026-08-30): 612 commits (424 of them not merges). TS/TSX changed by +93.0k/−14.5k lines over 1,058 files, of which +53.2k/−11.5k is non-test code. 29 new migrations.

---

## Executive summary

**This is a mature codebase with an unusually strong self-audit culture, and its gates are green. Its residual risk sits in four places:**
- **Unbounded work behind authenticated endpoints.** Three ways any self-registered account can stall or crash an API instance.
- **The AI layer's lifecycle and metering seams.** Chat-stream cancellation, auto-coach write safety, and spend accounting.
- **Edit persistence in the client.** Unmount and debounce saves that silently drop or revert what the athlete typed, and an offline queue that can drop or reorder writes.
- **A deploy and migration process that lets code and production schema drift apart.** Production is push-managed, so data-bearing migrations and some indexes never reach it. Railway's config-as-code, which this repo relies on, stops being read on **2026-12-01**.

The numbers need one caveat before the grades. This run verified about four times as many issues as the 2026-08-31 analysis did (315, against roughly 80 across that report's lens tables and its 2026-09-04 mapper-concern pass), and its grades and health scores are correspondingly lower. That is not evidence the code got worse. Of the 303 surviving findings whose cited line could be located, **238 (78%) cite a line whose exact text was already present at the 2026-08-31 snapshot (`642fe2f`)**, and so do all eight highs. The reviewers here were briefed to enumerate concrete defects exhaustively, and they found many that predate the last pass. Read the grades as a judgement of the residual risk this search exposed, not as a trend against the earlier report. The repo's own habits still show everywhere:
- Code comments carry audit IDs.
- Static ratchets block regressions: the route-builder compliance test, the AI dependency direction, the error-code catalogue, the cascade closed-world test, CHECK constraints pinned byte-for-byte, and a docs-sync test.
- There are no `.skip` or `.only` tests (the skipped tests are two deliberate `describe.runIf` eval gates), and every test asserts something.
- Every one of about 180 route registrations is authenticated or deliberately public, and all except the health probes and csrf-token are rate-limited.

| Dimension | Grade | High | Medium | Low |
|---|---|---|---|---|
| Security | B | 3 | 2 | 4 |
| Privacy & compliance | B+ | 0 | 7 | 11 |
| AI layer: reliability, safety & cost | B | 1 | 16 | 18 |
| Correctness (server & shared domain logic) | B+ | 1 | 22 | 30 |
| Data integrity, concurrency & resilience (server) | B+ | 0 | 23 | 33 |
| Client correctness & state | B | 2 | 32 | 38 |
| Performance | B+ | 1 | 2 | 16 |
| UX & accessibility | B+ | 0 | 6 | 31 |
| Architecture, testing, tooling & docs | A- | 0 | 0 | 16 |
| **Total** | | **8** | **110** | **197** |

| Subsystem (mapper) | Health (1–10) |
|---|---|
| Server: AI provider layer, prompts & coach chat | 6 |
| Server: AI coaching services (auto-coach, suggestions, weekly review) | 6 |
| Server: training plans, workout engine, missed-session recovery | 6 |
| Server: workouts & device sync (Strava, Garmin) | 6 |
| Server: analytics, training load, race prediction, session grades | 6 |
| Nutrition vertical (server + shared math) | 6 |
| Server: HTTP layer, auth, middleware, bootstrap | 7 |
| Server: background jobs, email/push, crypto, account lifecycle | 6 |
| Server: storage layer & DB plumbing | 7 |
| Schema, migrations, maintenance | 6 |
| Shared domain logic | 7 |
| Client: workout detail, structure & set editing | 5 |
| Client: timeline, plans UI, review, coach | 7 |
| Client: analytics & settings | 7 |
| Client: pages, nutrition UI, onboarding, log workout | 7 |
| Client: hooks | 6 |
| Client: app shell, lib, API client, offline, chat | 7 |
| Tooling, CI, scripts, deploy | 6 |

*(Per-subsystem finding counts by severity are in **Subsystem notes** below.)*

**The eight high-severity findings.** Each was confirmed by two independent verifiers.

1. **S1: one parse request can block or crash an API instance.** When the AI parse returns nothing usable, the heuristic fallback in `server/gemini/exerciseParser/fallback.ts:321` builds one set object per set the athlete typed, with no upper bound. "Back squat 10000000 x 5" blocks the event loop for about 25 s or runs the instance out of memory. Both verifiers reproduced it.
2. **S2: the push sender has no timeout and no response-size limit** (`server/pushNotifications.ts:55`). Subscribe accepts any public HTTPS endpoint, so a user who registers their own server and calls `POST /push/test` can stream about 512 MB back and make the instance `exit(1)`. An endpoint that never answers wedges the nutrition-reminder cron while it holds its advisory lock. This was raised as critical and calibrated to high because the impact is availability only.
3. **S3: the Strava OAuth callback trusts the user id inside the state and never checks the browser session** (`server/strava.ts:364`). An attacker who sends a victim their own authorize URL receives the victim's Strava activities, private ones included. Athletes who already authorized the app are linked with no consent screen at all.
4. **PF1: two nutrition endpoints accept any date span.** `/nutrition/block` and `/nutrition/summary-range` zero-fill one point per day of a span with no limit (`shared/schema/nutrition.ts:304`). `?from=0000-01-01` builds about 740k points synchronously and serialises about 100 MB of JSON.
5. **AI1: long chat replies get cut off.** The chat SSE deadline comes from Clerk's 60-second session JWT, not the 5-minute cap (`server/routes/ai.ts:239`). Any reply still streaming 5–55 s after the request is cut off. On the usual abort path the response never ends, and the truncated text is saved as the coach's turn.
6. **C1: false "Best time" PRs.** The PR code compares raw times across different distances (`server/services/analyticsService.ts:149`), so a shorter interval always "beats" a longer piece. The false PR reaches the post-save toast, the PR tab, the chat tool and the weekly email.
7. **CL1: prescription edits get reverted.** The prescription textarea's unmount effect closes over the text as it was when the textarea mounted, and writes it back on unmount (`client/src/components/workout-detail/CoachPrescriptionCollapsible.tsx:327`). Collapsing the panel or closing the sheet silently reverts edits that had already autosaved.
8. **CL2: MAF tagging re-opens calculation-audit H1.** The tag form seeds `durationSeconds` with `workout.duration`, which is in minutes (`client/src/components/workout-detail/MafTestTagSection.tsx:105`). Accepting the pre-filled value stores a pace about 60× too fast, which is the defect the 2026-08-20 calculation audit records as fixed.

**Patterns behind the medium findings.** Several mediums share a root pattern and are cheaper to fix as a class:
- **Bounded input, unbounded work.** S1, S2, PF1, S5 and the advisory-lock hold time.
- **Cancellation that does not propagate.** The client's Stop never aborts the stream (AI10), plan drafting ignores the abort and can still auto-apply (AI7), and aborts the app starts itself are counted as provider failures that open the breaker for everyone (AI5).
- **The L4 unit stamp is written or read inconsistently.** CL2; D21, where plan-day copies write unstamped sets; D22, where set PATCHes are stamped with the server's current unit; AI9, where coach prompts ignore stamps; and C9, where Strava cadence is stored at half its value.
- **Read-modify-write without a re-check.** The auto-coach writes from a stale snapshot (AI16). Its governor cuts volume again on every pass (AI14). Its replace ignores `targetField` (AI13). Batch reparse deletes sets logged by hand during the run (D17).
- **UTC where the athlete's day was meant.** C4, CL4, and AI24.

---

## Priority items

These are ranked by severity × blast radius ÷ fix cost. Items 1–3 are small, surgical fixes to the high-severity defects. Items 4–9 group the mediums that cost athletes data or wrong numbers. Item 9 also carries a hard date.

1. **Bound the three instance-killing inputs (S1, S2, PF1).**
   - S1: cap the set count in the heuristic fallback (`readPositiveInteger` / `buildHeuristicFallbackRow`) and add `.max()` to `parsedExerciseSchema.sets`.
   - S2: pass `timeout` to `webpush.sendNotification`, and accept only known push-service hosts (FCM, Mozilla autopush, Apple, WNS) at subscribe time. The allowlist also removes the unbounded-response vector.
   - PF1: give `blockViewQuerySchema` a span cap (for example 400 days) and require `from ≤ to`.

   Each fix is a few lines, and each closes a way for any free account to take an API instance down.
2. **Bind the Strava OAuth callback to the browser session (S3).** Compare the Clerk session on the callback request (the `__session` cookie is sent on a top-level GET) with `verified.userId`, or keep the state server-side keyed to the session. Add `approval_prompt=force`, and make `strava_athlete_id` unique across connections so one Strava account cannot feed two fitai.coach accounts.
3. **Fix chat-stream cancellation end to end (AI1, AI10, AI7, AI5).** These four interact today: the deadline causes the aborts that open the breaker, and the athlete's Stop does nothing.
   - AI1: take the SSE deadline from the 5-minute cap, not the session JWT.
   - AI10: listen for `res.on('close')`, not `req`.
   - AI7: thread the abort signal into plan drafting, and skip auto-apply after an abort.
   - AI5: stop counting `AbortError` as a breaker failure.
4. **Stop losing athlete edits in the workout sheets (CL1, CL18, CL12, CL8, CL7, U2).**
   - CL1: the stale-closure unmount save that reverts prescriptions.
   - CL18: the last debounced set edit is dropped when the LogSheet closes.
   - CL12: FuellingPlanPanel's debounce keeps only the last field.
   - CL8: the per-set notes textarea undoes each keystroke.
   - CL7: a decimal comma clears a stored set value.
   - U2: the quick-log sheet discards everything on dismissal.

   These are on the core logging journey, and each loses data silently.
5. **Close the remaining unit-stamp leaks (CL2, D21, D22, AI9, C9).**
   - CL2: MAF seconds-from-minutes, which re-opens calculation-audit H1.
   - D21: plan-day copies write unstamped rows, an L4 regression.
   - D22: set PATCHes are stamped with the server's current unit rather than the unit the client composed in.
   - AI9: coach prompts and chat tools ignore stamps.
   - C9: Strava cadence is halved.

   A lint or test ratchet on every `exercise_sets` insert that lacks a stamp would stop the class.
6. **Make AI spend metering and consent gates complete (AI4, PF2, P6, S5).**
   - AI4: count Gemini `thoughtsTokenCount`.
   - PF2: pass `userId` on every reparse path.
   - P6: gate `POST /workouts/migration/backfill` with consent and budget.
   - S5: window the legacy client-history chat path, or drop it, now that the chat body limit is 5 MB.
   - Extend the static compliance test to routes that reach the parser indirectly. Today it only sees routes that name the AI middleware.
7. **Make auto-coach writes safe to repeat and to race (AI13, AI14, AI15, AI16, AI12).**
   - AI13: honour `targetField` on a structured replace, and record the replaced prescription.
   - AI14: anchor the governor's downshift to the original prescription so it is idempotent.
   - AI15: keep `lastFatigueReduction` across review writes.
   - AI16: re-read and fingerprint days inside the write transaction.
   - AI12: debounce the enqueue (`singletonNextSlot`) instead of throttling it.
8. **Correct the analytics numbers athletes see (C1, C13, C4, C7, C6, CL5, CL6, CL4).**
   - C1: compare best times only across like distances.
   - C13: match the endurance regex on whole words.
   - C4: clamp `to` in the athlete's timezone.
   - C7: cap adherence at 100%.
   - C6: count partial edge weeks correctly and zero-fill the previous period.
   - CL5: finish the H8 fix in the client trend.
   - CL6: count rest days only inside the selected range.
   - CL4: date MAF tests by the workout, not by when they were tagged.
9. **Deploy and migration safety (D4, D2, D3, D7, D1, PF3, D9, D20). Dated: 2026-12-01.**
   - D4: move off `railway.toml` before Railway stops reading config-as-code on 2026-12-01. `railway config migrate` writes `.railway/railway.ts`. Validate Railpack, the nixpacks replacement, on staging.
   - D2: point the healthcheck at readiness.
   - D3: set `drainingSeconds` so the 60 s graceful shutdown actually runs.
   - D7: make readiness fail when required columns are missing.
   - D1 and PF3: run the 0117 plan-day repair and the 0074 `pg_trgm` extension and indexes in production, and record them in `docs/operations/pending-manual-steps.md`.
   - D9: replace the `expireInMinutes` job option, which pg-boss 12 does not have.
   - D20: sweep stranded plan generations on a timer, not only at boot.
10. **Privacy corrections (P1, P7, P5, P3, P4, P2).**
    - P1: "Decline analytics" must not initialise Sentry.
    - P7: export the 12 user-keyed tables the GDPR export misses.
    - P5: refuse to re-provision an erased user from a still-valid session.
    - P3: unsubscribe push on sign-out.
    - P4: update the Privacy page's processor table.
    - P2: label the master AI consent for everything it controls.
11. **Make the offline queue lossless and ordered (CL28, CL29, CL27).**
    - CL28: don't count network, 401, 429 or 5xx failures toward `MAX_RETRIES`.
    - CL29: stop replay at the first failure for the same resource.
    - CL27: retry writes that timed out while `navigator.onLine` stayed true.
12. **Server-side data-loss paths (D11, D17, D18, D16, C16, C17).**
    - D11: route Strava unlink of a sync-created log through the recycle bin.
    - D17: make batch reparse preserve hand-logged sets.
    - D18: stop a public custom food's owner from rewriting other users' logs (snapshot or version the food once others log it).
    - D16: dedupe Garmin and Strava imports of the same session.
    - C16 and C17: show every log linked to a plan day, including after a retirement cutoff.
13. **Supply-chain hygiene in the production build (S4).** Install with `--ignore-scripts` in the Railway build, as CI already does, and rebuild only the packages that need native steps. Alternatively, keep production secrets out of the build environment.

---

## Security — B

**Assessment.** The front door is still well built: parse and chat routes stack auth, CSRF, per-user rate limits, AI-consent and AI-budget checks and a 2,000-character text cap; Strava OAuth state is HMAC-signed, expires after 10 minutes and can be claimed only once; and push sends re-resolve the endpoint host just before the request, with at most 10 subscriptions per user. Production `script-src` is nonce-based, every CI workflow installs with `--ignore-scripts`, and the 2026-09-19 route schemas strip `planId` and device-provenance columns from workout create and PATCH. None of the nine findings reads another athlete's fitai.coach records directly. The risk is concentrated in three places: any self-registered user can stall or crash an API instance (S1, S2); one targeted flow can send a victim's private Strava activity into an attacker's account, reported independently by three reviewers and raised to high by both verifiers (S3); and the production build runs dependency scripts with production secrets present (S4). Three patterns tie the findings together. First, input length is bounded but the work it triggers is not: numeric magnitudes, peer response sizes, socket timeouts and advisory-lock hold times have no limit (S1, S2, S5). Second, hardening passes covered the main path and missed a sibling, and earlier audits checked the OAuth state only for forgery and replay, not for an attacker handing out a valid state of their own (S3, S5, S9). Third, the production build and dev tooling are held to a lower supply-chain standard than CI (S4, S7).

| # | Finding | Severity | Verdict |
|---|---|---|---|
| S1 | When the AI parse returns no valid rows, the heuristic fallback reads the set count from the athlete's text with no upper bound and builds one set object per set (`Array.from({ length: candidate.sets })`). It then validates every set with zod synchronously, and `parsedExerciseSchema.sets` has no `.max`. A 23-character request such as 'Back squat 10000000 x 5' from any AI-consented user can block the event loop for about 25 s (around 3M sets) or crash the instance out of memory (around 10M sets), and the 5/min parse limit lets one account repeat it (`server/gemini/exerciseParser/fallback.ts:321`). | High | **Confirmed** — 2/2 verifiers, both reproduced. Caller line numbers corrected to `text.ts:55,98,148`. Also reachable from parse-workout-structure, workout create, reparse and assisted migration. Not critical because each crash needs a fresh request. |
| S2 | `sendToSubscription` calls `webpush.sendNotification` with no options, so web-push 3.6.7 sets no socket timeout and appends the whole response body to one string; subscribe accepts any public HTTPS endpoint, with no allowlist of push-service hosts. A signed-up user who registers their own endpoint and calls `POST /api/v1/push/test` can stream more than 512 MB back, raising an uncaught RangeError that makes the instance exit(1); this repeats at 5/min per account and on every scheduled push to that endpoint. An endpoint that never responds instead hangs the nutrition-reminder cron while it holds advisory lock 42_010_013, which stops reminders for every user until restart (`server/pushNotifications.ts:55`). | High (raised as critical) | **Confirmed** — 2/2 verifiers. Calibrated down from critical because the impact is availability only (no data read or lost), each crash needs a deliberate attacker streaming about 512 MB, and push runs only when VAPID keys are configured. |
| S3 | The unauthenticated Strava callback checks the state's HMAC, TTL and single use, then stores the exchanged tokens on `verified.userId` without comparing it to the browser's Clerk session (RFC 6749 §10.12). An attacker who mints a state for their own account through `/strava/auth` and gets a victim to open the authorize URL receives the victim's Strava tokens, and the attacker's timeline then imports the victim's activities, private ones included (HR, pace, start times; no GPS), until the victim revokes access. Because the URL sets no `approval_prompt`, an athlete who has already authorized the app is linked without seeing a consent screen (`server/strava.ts:364`). | High (raised as medium) | **Confirmed** — 2/2 verifiers; the trace verifier reproduced it against the real route handler. Reported independently by 3 reviewers. Raised from medium because silent re-linking of already-authorized athletes and webhook fan-out (no unique `strava_athlete_id`) keep private data flowing. Not critical because each victim must click the link within the 10-minute state window. |
| S4 | Every CI workflow installs with `--ignore-scripts`, but the Railway build runs `pnpm install --frozen-lockfile` on pnpm 9.12.0, which runs every dependency's lifecycle scripts while Railway service variables are in the build environment. A compromised transitive release whose postinstall exfiltrates `process.env` would pass CI and run for the first time in the production build, next to ENCRYPTION_KEY, DATABASE_URL, CLERK_SECRET_KEY and the AI provider keys. `@scarf/scarf` also sends install telemetry from every production build (`railway.toml:6`). | Medium | **Confirmed** — the trigger (an upstream compromise) is uncommon, but every production secret is exposed if it happens. `--ignore-scripts` closes only the install-script route; a compromised package that the build or runtime imports would still see the secrets. |
| S5 | A chat request that omits `userMessageId`/`assistantMessageId` takes the legacy branch, where `conversationFor` returns `body.history` unchanged and skips `fitHistoryWindow` (a 30k-character budget), while the schema allows 20 history entries of 50,000 characters each. Commit 168b60f added a 5 MB parser for the chat send paths, lifting the old 100 kb bound, so one request can now carry about 1M characters (about 250k tokens) to the reasoning model. Concurrent requests all pass the check-then-act budget gate, so one account can overshoot its $2 daily AI cap (estimated at $5–10 per day) (`server/routes/ai.ts:180`). | Medium | **Confirmed** — reported independently by 2 reviewers. The overshoot is still bounded per account by the 10-per-60 s rate limit and the daily cap. The check-then-act budget gap was already an accepted risk (SECURITY_AUDIT_2026-09-19); what is new is the roughly 10x larger cost per request. |

**Low-severity findings.**

- **S6** An athlete who opens Settings → Training sees 'GEMINI_API_KEY is not configured' when the key is missing, and sees the raw embedding-provider exception text (`probeEmbeddingHealth` returns `err.message`), operator detail they cannot act on; partially confirmed, because the dimension-mismatch 'Re-embed All' prompt is per-user and does fix that user's mismatch, so most of the claimed budget waste does not happen (`client/src/components/settings/coaching/RagStatusCard.tsx:57`).
- **S7** The Cypress patch script forces axios 1.7.4 into the Cypress binary (affected by CVE-2025-27152 and CVE-2025-58754, and below the repo's own `^1.20.0` override floor), which would downgrade any newer axios Cypress bundles, and copies freshly resolved, unpinned transitive dependencies over Cypress's own tree; partially confirmed, because the impact is limited to developer machines and the Cypress CI job and the verifier could not check which packages Cypress 16.1.1 bundles (`script/patch-cypress-deps.js:28`).
- **S8** The CSP allows only Clerk's own domains and not `challenges.cloudflare.com`, so if an operator turns on Clerk bot sign-up protection the Turnstile script and iframe are blocked and new visitors cannot create accounts in the embedded sign-up modal; raised as medium, partially confirmed and calibrated down to a latent hazard, because it depends on Clerk dashboard state the repo cannot show and the app currently accepts sign-ups (`server/middleware/csp.ts:16`).
- **S9** `POST /api/v1/workouts/combine` still validates `newWorkout` with the full `insertWorkoutLogSchema` and inserts `{ ...newWorkout, userId }`, so a caller can point `planId` at another athlete's plan (and use the foreign-key error to learn whether a plan UUID exists) or stamp a manual log as a Strava import; this is the third write path, which the 2026-09-19 route-schema fix missed, and the impact is limited to the integrity of the caller's own rows (`server/routes/workouts/workoutsCrud.routes.ts:55`).

---

## Privacy & compliance — B+

**Assessment.** The privacy machinery that exists is serious engineering. AI processing is opt-in and enforced on the server: `aiConsentCheck` refuses with `403 AI_COACH_DISABLED` unless `aiCoachEnabled` is true, and onboarding and the in-place gates (`useAiConsentGate`, `GeneratePlanDialog`) show a real disclosure before it is switched on. Account erasure is an ordered, fail-loud sequence: it purges the separate vector DB before anything irreversible, then deletes the Clerk identity, deauthorizes Strava, removes the user row and private custom foods in one transaction, and purges rate-limit buckets and queued jobs, with a sweep that finishes any run stranded past the point of no return. Sentry runs with PII collection off (`sendDefaultPii: false` on the server, `dataCollection` with `urlQueryParams: false` on the client) and `beforeSend` scrubbers on both tiers, the pino redact list covers credential headers and body fields, and consent decisions are recorded in a server-side `user_consents` table. Nothing reaches high, and the residual risk sits at the edges of these mechanisms rather than inside them, where four patterns explain most of the findings. First, consent is enforced by route middleware rather than at the provider entrypoint, so AI calls reached any other way skip it: an unbudgeted migration endpoint, a cron, operator scripts, job handlers and a rollback path, contradicting the docs' claim that consent gates every provider call (P6, P14, P15). Second, the user-facing inventories are maintained by hand and have drifted from the schema and the integrations, so the Privacy page, the JSON export and the chat-retention copy each promise more than the code delivers (P4, P7, P11, P18). Third, client telemetry consent lives in localStorage, its wiring is order-sensitive and the server never reads it (P1, P8, P9, P11). Fourth, sign-out and erasure leave identity-linked state behind: a live push subscription, a seen-cache eviction that lets a stale token re-create the erased row, cached plaintext, and an erasure marker the background jobs ignore (P3, P5, P13, P17).

| # | Finding | Severity | Verdict |
|---|---|---|---|
| P1 | "Decline analytics" on the first-load privacy banner starts Sentry for the rest of the session. `acknowledge(false)` calls `recordPrivacyConsent()` first, and its synchronous change event runs the boot listener, which calls `Sentry.init` while the opt-out is still unwritten; the opt-out is stored only afterwards and nothing calls `stopErrorReporting()`. Session pings and captured errors from a visitor who explicitly declined go to Sentry until the next page load (`client/src/components/PrivacyConsentBanner.tsx:74`). | Medium | Confirmed. The verifier traced the listener path from `main.tsx` and found no banner test that asserts Sentry stays off after Decline. |
| P2 | `aiCoachEnabled`, the single server-side consent gate for every AI feature, appears in Settings only as "Auto-Adjust Workouts", described as post-workout adjustment, and the switch shows no disclosure. An athlete who turns it off to stop automatic plan edits loses chat, insights, coaching uploads and plan generation (all 403 `AI_COACH_DISABLED`); one who turns it on to get auto-adjust has consented to all AI processing without being told so (`client/src/components/settings/preferences/AiCoachCard.tsx:32`). | Medium | Confirmed. Onboarding and the in-place gates disclose properly; only the Settings path records full consent without disclosure. |
| P3 | Sign-out clears local storage and caches but never unsubscribes the browser push subscription or deletes the server `push_subscriptions` row. A shared laptop or gym tablet therefore keeps showing the signed-out athlete's notifications (session names and workout excerpts, completion rates, predicted finish times, refuel gaps). If a second athlete enables push on that browser, the same endpoint is stored for both and they receive both sets (`client/src/lib/userLocalData.ts:68`). | Medium | Confirmed. Needs a shared browser profile, and the leaked content is training notifications rather than credentials. Reported independently by 4 reviewers. |
| P4 | The Privacy page's processor table lists one "configured AI provider" and says a non-Google provider's terms apply, yet vision and embeddings always go to Google. It does not list Open Food Facts, USDA, Edamam or the web push services, it understates what Resend emails carry, and its data categories omit nutrition, body-profile and MAF health data. An operator who sets `AI_TEXT_PROVIDER=anthropic` to keep data away from Google still sends meal and chat photos and retrieval text there, while the page tells athletes otherwise (`client/src/pages/Privacy.tsx:85`). | Medium | Confirmed. The verifier noted that food-search terms reach OFF and USDA server-to-server without a user identifier, so that sub-point is debatable; the Google and data-category misstatements stand. Reported independently by 2 reviewers. |
| P5 | Erasure step 8 evicts the auth seen-cache. A request that still carries a valid Clerk session JWT (local verification, up to about 60 s after `deleteUser`) then misses the cache, and `ensureUserExists` re-inserts a `users` row with the erased id. Any write in that request, such as an offline-queue workout replay, is stored against a zombie account that has no erasure marker, so the stranded-erasure sweep never finds it; the code comment and `docs/authentication.md` claim the eviction prevents exactly this (`server/services/accountErasureService.ts:211`, `server/clerkAuth.ts:166`). | Medium | Confirmed. The verifier moved the location to the eviction step and kept medium: a real GDPR-erasure defect, but the trigger window is no longer than the token lifetime. Reported independently by 2 reviewers. |
| P6 | `POST /api/v1/workouts/migration/backfill` has only a rate limiter, with no `aiConsent` or `aiBudget` flag. Each call sends up to 50 workout and plan texts to the AI parser, and failed parses remain candidates, so a user with AI consent off or over the daily cap can drive about 100 unbudgeted provider calls a minute. Overlapping calls can also insert duplicate `exercise_sets` (`server/routes/workouts/workoutsMigration.routes.ts:26`). | Medium | Confirmed. No client code calls the endpoint, so the consent bypass needs a user calling it directly; the cost bypass and duplicate inserts are the main impact. Same class as the session-estimate bypass fixed by SECURITY_AUDIT_2026-09-19. Reported independently by 4 reviewers. |
| P7 | The GDPR JSON export reads 13 hand-picked sources. It omits at least 12 user-keyed tables, including nutrition logs and targets, the MAF tables, `weekly_reviews`, `workout_log_streams` (HR series), `plan_day_moves`, `user_consents` and `analytics_results`. It also exports plans without their days, leaves out never-scheduled plans and caps exercise sets at the 5,000 most recent logs, while `Privacy.tsx` says the file "covers everything we hold for your account" (`server/services/exportService.ts:166`). | Medium | Confirmed. The nutrition and MAF gaps were already open (docs/nutrition.md §11, CODEBASE_ANALYSIS_2026-07-19); the newer tables, the plan-day gaps and the false completeness claim are new. Reported independently by 2 reviewers. |

**Low-severity findings.**

- **P8** When browser storage is unavailable, `hasAcknowledgedPrivacyNotice()` fails open, so the banner never appears, client Sentry starts at boot and no opt-out can be saved. The verifiers rejected the original claim that closing the banner with X is a defect, because that matches the disclosed opt-out model (`client/src/lib/privacyConsent.ts:16`).
- **P9** The Settings error-reporting toggle writes only the localStorage flag and never calls `recordServerConsent`, so after a banner Accept and a later Settings opt-out the `user_consents` audit row still reads granted. Sentry itself does stop, so only the audit trail is wrong, and the finding was calibrated down from medium (`client/src/components/settings/data-tools/ErrorReportingConsentCard.tsx:20`).
- **P10** `startListening` starts speech recognition after the `getUserMedia` probe without checking whether the user stopped or the component unmounted in the meantime, so the mic can go live with no in-app indicator and its transcripts are discarded. Calibrated down from medium: the reliable window is the short probe, and the browser's own mic indicator still shows (`client/src/hooks/voice/useSpeechRecognitionSession.ts:160-169`).
- **P11** Server Sentry performance traces (10% sample) keep full query strings, including food-search terms and the Strava OAuth `code`/`state` (the state embeds the Clerk userId), because `beforeSend` does not apply to transactions. The server also never reads the athlete's error-reporting opt-out. The verifier reproduced this but calibrated it down from medium: food-search traces carry no user identity, and the OAuth code is single-use (`server/bootstrap/observability.ts:115`).
- **P12** pino-http's default response serializer logs `res.getHeaders()`, so every `GET /api/v1/csrf-token` writes the `__Host-fitai.x-csrf` Set-Cookie value to the log sink, although the same token is redacted on the request side. It is a log-hygiene leak and not directly exploitable (`server/logger.ts:32`).
- **P13** `eraseAccount` never clears the RAG retrieval cache. Plaintext excerpts of the athlete's coaching materials therefore stay in `server_runtime_cache` on the main DB until the daily 04:15 UTC sweep, up to about a day after erasure rather than the 120 s that CODEBASE_ANALYSIS_2026-07-19 recorded (`server/services/accountErasureService.ts:86`).
- **P14** With `NUTRITION_SEMANTIC_ENABLED=true`, the 30-minute food-embedding backfill sends private custom-food names and brands to Gemini regardless of the owner's AI consent, and the re-embed and structured-exercise backfill scripts and the embed and plan-generation job handlers do not re-check consent either. Calibrated down from medium: the flag defaults to off, the scripts run manually, and the job gap is a narrow window. Reported independently by 2 reviewers (`server/services/nutrition/foodEmbeddings.ts:141`).
- **P15** While the structured-write gate is rolled back (`STRUCTURED_BLOCKS_ENABLED=false`, `STRUCTURED_BLOCKS_FALLBACK_FORCE_LEGACY=true`, or after the guard's error-spike trip), text-only workout creates go to the AI parser with no AI consent or budget check. This path cannot be reached under the defaults. Reported independently by 4 reviewers (`server/services/workoutUseCases.ts:35`).
- **P16** Food search and detail responses return full `foods` rows, so any searcher receives the internal Clerk user id of whoever authored each public custom or recipe-backing food and can link all of that person's shared foods (`server/storage/nutritionFoods.ts:88`).
- **P17** Background audience queries (email notifications, nutrition push reminders, MAF baseline, Strava auto-sync) ignore `erasure_requested_at`, so a stranded erasure keeps emailing and pushing an athlete whose Clerk identity is already gone. Separately, the sweep finishes an erasure that failed before the Clerk step 15-75 minutes later, although the athlete was told "Deletion failed" (`server/storage/users.ts:962`).
- **P18** "Clear chat history" deletes only `chat_messages`. A chat message that triggered a plan proposal stays verbatim in `plan_adjustment_proposals.user_request`, a column that nothing reads, prunes or exports, for as long as the plan exists (`server/storage/users.ts:507`).

---

## AI layer: reliability, safety & cost — B

**Assessment.** The AI layer has real operational engineering behind it: a provider-neutral retry and timeout core (`server/ai/retry.ts`, where `withTimeout` also aborts the underlying request) guarded by `aiLayerDependencyDirection.test.ts`, a circuit breaker whose state survives restarts, an operator kill switch alongside a per-user $2/24 h cap with a $1.50 warning header and an optional global cap, streaming output validation that catches patterns split across chunks, and a red-flag safety layer that forces notes and blocks chat plan proposals. The auto-coach is opt-in, keeps running its deterministic load-governor stages when the AI budget is exhausted, and has a guard against repeated fatigue cuts. The one high finding is on the main surface: the chat stream's deadline comes from the 60-second Clerk session token, so long replies are routinely cut off and left hanging (AI1). Cancellation is not handled end to end: the deadline aborts too early, a client Stop never aborts at all, plan drafting ignores the abort and can still auto-apply, and aborts the app started itself are counted as provider failures (AI1, AI10, AI7, AI5). The auto-coach write path is neither idempotent nor safe under concurrency: it writes from a stale snapshot without locks (AI16), cuts the governor's volume again on every pass (AI14), erases its own repeat-guard state (AI15), lets a structured replace wipe a whole planned day without recording the original (AI13), and treats swallowed upstream failures as "no changes needed" (AI8). The model is also sometimes given wrong context that no test catches (unconverted unit stamps in AI9, future plan days counted as experience in AI11, retired-plan days in the weekly review in AI17), and cost accounting leaves out Gemini thinking tokens (AI4). The non-Gemini providers diverge silently from the default (a shared breaker, swallowed in-stream errors and object-only JSON mode; AI2, AI3, AI6), but each needs an operator to move off Gemini, which limits how far they reach.

| # | Finding | Severity | Verdict |
|---|---|---|---|
| AI1 | The chat SSE deadline is taken from the `exp` of Clerk's `__session` JWT. That token lives 60 s and is refreshed about every 50 s, so the 5-minute cap never applies to browser users and any reply still streaming 5–55 s after the request is cut off. On the usual abort path the route's catch returns with no terminal event and no `res.end()`. The athlete sees a frozen partial reply, or more rarely a false "session expired" message, and the truncated text is saved as the coach's turn; plan-edit drafts on HIGH thinking are hit hardest (`server/routes/ai.ts:239`). | **High** | **Partially confirmed**: 2/2 verifiers, severity kept at high. Both corrected the close path: the `finally` block's `clearDeadline()` cancels the 2 s force-close timer, so the socket is never destroyed and the response simply never ends. Reproduced; `computeSseDeadline.test.ts:35` pins the 60 s → 55 s result. |
| AI2 | One module-level circuit breaker is shared by Gemini embeddings, Gemini vision and whichever text provider is configured. A missing `GEMINI_API_KEY`, thrown inside `retryWithBackoff`, counts as a provider failure. With `AI_TEXT_PROVIDER=anthropic` and no Gemini key (a documented setup), one coaching-material upload fans out five failing embedding calls and opens the breaker, so every athlete's Anthropic chat fails for 30 s. A Gemini embedding or vision incident likewise blocks a healthy text provider (`server/ai/circuitBreaker.ts:174`). | Medium | **Confirmed**: reproduced. Needs a non-default provider setup, or a Gemini incident while text runs on another provider. |
| AI3 | The Anthropic and OpenAI-compatible stream parsers ignore in-stream error events (`type: "error"` / a top-level `error`) sent inside an HTTP 200 stream, so the generator ends normally. A mid-reply `overloaded_error` becomes a reply that stops mid-sentence, is marked done and saved as the coach's turn, and counts as a breaker success during an outage (`server/ai/providers/anthropic.ts:250`, `server/ai/providers/openaiCompatible.ts:194`). | Medium | **Confirmed**: reported independently by two reviewers. The verifier corrected the `http.ts` reference (the stream loop is at lines 107-145). Only non-default providers are affected; Gemini's SDK throws on in-stream errors. |
| AI4 | Gemini usage records only `promptTokenCount` and `candidatesTokenCount`, never `thoughtsTokenCount`. Yet every reasoning call runs with thinking on (HIGH for plan generation, suggestions and plan adjustment, MEDIUM for chat), and the vision model thinks dynamically. `ai_usage_logs`, and with it the $2/24 h per-user cap and `AI_GLOBAL_DAILY_LIMIT_CENTS`, therefore undercount real spend: a reproduced plan-generation call recorded 3¢ against 13¢ at the app's own prices (`server/ai/providers/gemini.ts:23`, and `trackUsageFromResponse` in `server/gemini/client.ts:128`). | Medium (raised as high) | **Confirmed**: 2/2 verifiers (one partial), reproduced. Lowered: this is a cost-control weakness, and the caps still trip, only late. Chat is input-heavy, so its undercount is tens of percent; the several-fold gap applies to output-heavy calls on HIGH thinking. The side claim about `gemini-3.1-pro-preview` pricing could not be checked offline. |
| AI5 | `streamChunks` records any thrown error as a breaker failure. That includes the `AbortError` raised when an SSE deadline or a SIGTERM drain aborts a provider read still in progress. Five such aborts in a row with no success in between (likely given AI1) open the breaker and fail every AI feature on that instance for 30 s. An aborted half-open probe re-opens it for another cooldown (`server/ai/providers/index.ts:133`). | Medium | **Partially confirmed**: reported independently by two reviewers, reproduced. The verifier corrected four details. An abort that lands at a `yield` is not counted. The five failures must be consecutive across the whole process. The breaker logic is at `circuitBreaker.ts:174-178`, not :315. The cross-instance persistence scenario is weak, because restored state keeps its original `openedAt`. |
| AI6 | With `json: true` the OpenAI-compatible adapter sends `response_format: {type: 'json_object'}`, which forces an object. The suggestions, review-notes and plan-generation prompts require a top-level array, and their parsers do not unwrap an envelope. Under `AI_TEXT_PROVIDER=openai-compatible`, every plan-generation chunk is billed and then fails with "AI response is not an array", and auto-coach suggestions and review notes silently come back empty (`server/ai/providers/openaiCompatible.ts:106`). | Medium | **Confirmed**: needs an operator to opt into the openai-compatible provider. The exercise parser's `normalizeParserPayload` already accepts both shapes and shows the fix. |
| AI7 | Plan-change drafting takes no abort signal. Once the stream's controller is aborted, the billed reasoning call runs to completion, creates the proposal and, if `coachAutoApplyPlanChanges` is on, applies it. Today that abort comes from the deadline in AI1; a client Stop never aborts at all (AI10). If the abort lands before any summary text, the empty reply is never saved, so the chat shows no card and no Undo for the plan change (`server/gemini/planAdjustmentService.ts:219`, `server/routes/ai.ts:505`). | Medium | **Confirmed**: reported independently by two reviewers. Auto-apply is opt-in (default false), so for default users the cost is a billed call and an unwanted pending proposal. |
| AI8 | `generateWorkoutSuggestions` and `generateReviewNotes` catch every provider, breaker, timeout and JSON-parse failure and return `[]`, which the auto-coach reads as "no modifications needed". During an outage the athlete's upcoming days get notes saying the plan still fits, though the model never evaluated any changes. pg-boss marks the job complete with no retry, and a manual "get suggestions" returns 200 with nothing (`server/gemini/suggestionService.ts:472`). | Medium | **Partially confirmed**: the verifier corrected that the rule-based stages (load governor, engine adaptation) still apply, so a governor deload still happens. Only the LLM modification pass is lost. |
| AI9 | The coach prompts drop the per-row unit stamp added in L4. Recent sets, structured max-weight stats, the `get_workouts`/`get_exercise_history` chat tools and the focused-workout block all print raw stored weights with the athlete's current unit. After a kg→lbs switch the coach reads "Back Squat: 5 reps, 140 lbs" for a 140 kg (309 lb) set and prescribes from a number 2.2× too low; after a lbs→kg switch it can over-prescribe (`server/prompts/exerciseSetFormatter.ts:98`, `server/services/ai/trainingStats.ts:149`). | Medium | **Confirmed**: reported independently by two reviewers. The 2026-08-31 C2 fix listed "AI coach context" as converted but covered only the PR block. Affects only athletes who switched units after migration 0088. |
| AI10 | The `/chat/stream` handler attaches `req.on("close")` only after several awaits. By then the request has already emitted `close` (its body was consumed), so client Stop, closing the panel and closing the tab never abort the controller. The full reply is still generated, billed to the athlete's $2/day budget and saved in full as the coach's turn, despite the "saved as the athlete saw it" comment. In tools mode, plan proposals made after Stop still draft and can auto-apply (`server/routes/ai.ts:847`). | Medium | **Confirmed**: reported independently by two reviewers, reproduced. `docs/ai-and-rag.md:189` says the opposite. |
| AI11 | `classifyExperienceLevel` is based on `totalWorkouts`, which counts every future scheduled plan day in the timeline window; the query has no upper date bound. A new athlete with a 12-week, 6-day plan and one logged session counts as 73 "workouts tracked" and is classified intermediate. Beginner gating in the decision engine then never applies, and the exercise brief suggests power cleans, pistol squats and nordic curls (`server/services/ai/index.ts:572`, `server/services/ai/trainingStats.ts:29`). | Medium | **Confirmed**: the test comment at `index.test.ts:525-527` states the intended rule (no completed workouts means beginner), but the test mocks the stats. |
| AI12 | The auto-coach enqueue sets `singletonKey` and `singletonSeconds: 60` without `singletonNextSlot`, which pg-boss treats as a throttle. A trigger later in the same clock-minute is dropped (`createJob` returns null), not deferred. A typo'd set corrected 30 s after the first save is never reviewed. `isAutoCoaching` is reset only on rejection, so the "Coach is reviewing" banner can stay up until the 15-minute stale reset (`server/services/autoCoachQueue.ts:34`). | Medium | **Confirmed**: reported independently by two reviewers. TECHNICAL_DEBT #23 records this path as a debounce, but pg-boss does not debounce with `singletonSeconds` alone. |
| AI13 | On a table-backed plan day, a structured `replace` deletes every `exercise_sets` row for that day, whatever its `targetField`, and inserts only the parsed recommendation. On the auto-coach path it also overwrites `mainWorkout`, nulls the accessory and notes, and saves no `replacedPrescription`. An accessory-only taper replace ("Plank 2x45s") wipes the day's back-squat main work, with no "originally planned" record and no undo (`server/services/structuredPlanDaySuggestion.ts:57`). | Medium (raised as high) | **Confirmed**: 2/2 verifiers (one partial), reproduced. Lowered: it needs the model to send a partial replace against the prompt's "complete revised prescription" rule, the auto path is opt-in (`aiCoachEnabled` defaults to false), and each incident touches one planned day. The verifiers also corrected the manual Apply path: it replaces the rows but keeps the text, which then contradicts the table. |
| AI14 | The load governor's reduce/cap downshift works out the sets to keep from the current, already-reduced rows on every auto-coach pass, with nothing to stop it repeating. A day inside an ACWR yellow-zone or on-ramp window is cut from 9 to 6, 4, then 2 sets over routine passes (a log, a set edit, a reschedule), and the original prescription is never recorded. Under the danger lock the same cause re-runs the recovery downshift and blanks the 30-minute recovery run the governor wrote in (`server/services/coachService.ts:563`, `server/services/trainingLoadGovernor.ts:207`). | Medium (raised as high) | **Confirmed**: 2/2 verifiers, reproduced against the real governor. Severity split (trace: high, guard: medium), settled at medium. It affects only planned days in the 2-3 day restriction window, needs the AI coach on and structured rows, and the change is visible on the card. |
| AI15 | Review notes and non-fatigue coach edits rebuild `aiInputsUsed` from run-level inputs and replace the whole jsonb, erasing the day's `lastFatigueReduction`/`lastModification`. A suppressed repeat reduction itself gets a review note, so the guard state is gone after one cycle. The next pass without a new completed workout then applies a second fatigue cut (4x8 → 3x8 → 2x8) (`server/services/coachService.ts:373`). | Medium | **Confirmed**: the engine-adaptation path does carry this state forward, which shows the intended rule. The existing test checks only `aiSource`/`aiRationale` on the review write. |
| AI16 | `triggerAutoCoach` snapshots the upcoming days, spends tens of seconds on model calls, then writes in a transaction with no row lock, re-read, fingerprint or status check. The queue's default policy also lets passes from different 60-second slots run at the same time. An athlete edit made while the "Coach is reviewing" banner is up (e.g. "Gym closed — dumbbells only") is silently overwritten, and two overlapping passes can duplicate appended exercise rows (`server/services/coachService.ts:327`). | Medium | **Confirmed**: reported independently by three reviewers. Contradicts `docs/ai-coach-auto-regulation-flow.md:17`, which says an athlete never gets two concurrent passes. |
| AI17 | `getPlanDaysByDateRange` filters only on user and date range and skips the plan-lifetime check. A retired plan's days on or after `retired_on` stay `planned` forever by design, and the weekly review counts them. After a mid-week plan switch, that week's review lists the old plan's remaining sessions as outstanding beside the new plan's, inflating `sessionsPlanned` and skewing week-over-week changes, while the timeline hides those days (`server/services/weeklyReviewService.ts:322`, `server/storage/analytics.ts:149`). | Medium | **Confirmed**: other queries in the same storage file already apply `planDayWithinPlanLifetime`. |

**Low-severity findings.**

- **AI18** In the half-open state, `assertBreakerClosed` throws only when the state is `open`, so every caller gets through instead of the one probe the docs describe. In a hanging outage, each 30 s cooldown is followed by up to ~120 s of full traffic to the provider, and requests fail more slowly (`server/ai/circuitBreaker.ts:189`).
- **AI19** *(raised as medium)* No test checks that `trackTextUsage` ever calls `recordAiUsage`, and none exercises the global-cap 503 branch. A change that stopped usage recording would silently disable both budget caps while CI stayed green; the compiler would not catch it because `userId` and `feature` are optional. Today all 14 call sites record correctly (`server/ai/providers/index.ts:101`).
- **AI20** `streamBreaker.test.ts` mocks `../sharedRuntimeState`, which points to a file that does not exist, so the mock does nothing. The test quietly depends on breaker persistence failing harmlessly against the unit lane's dummy `DATABASE_URL`; verifiers found no state leak between tests (`server/ai/providers/streamBreaker.test.ts:17`).
- **AI21** Text from successive tool rounds is joined with no separator, so a preamble and the answer run together ("…July sessions.In July you squatted…") in both the stream and the saved history (`server/gemini/chatService.ts:262`).
- **AI22** The chat tools path runs every tool call from one model round in parallel, with no cap. A "compare every month" question can fan out to dozens of DB reads and about 25k tokens of results, which are re-sent in later rounds and charged to the athlete's budget. This path is behind `AI_CHAT_TOOLS`, which is off by default (`server/gemini/chatService.ts:190`).
- **AI23** *(raised as medium)* The chat RAG query embedding uses the retry policy built for reasoning calls (4 retries, 90 s per attempt, 120 s budget) and runs before the SSE headers are sent. A degraded embedding endpoint stalls chat for athletes with coaching materials for ~30 s to ~2 min before the legacy fallback, and the exhausted retries count against the shared breaker. Food search is affected only when `NUTRITION_SEMANTIC_ENABLED` is on (`server/gemini/client.ts:87`).
- **AI24** `completedLast7d` measures from `Date.now()` to the log date parsed as UTC midnight, with an 8-day inclusive bound. For an athlete east of UTC, a session logged this morning gets `days = -1` and is dropped, which can put a beginner into `reset_repair` with intensity blocked right after training (`server/services/ai/index.ts:566`).
- **AI25** The fatigue-reduction classifier matches substrings ('rpe', 'less' in 'unless', 'lower' in 'lower body'). During a fatigue episode almost any edit is tagged a fatigue reduction, and a later real change to the same day is then suppressed (`server/services/aiModificationGuard.ts:66`).
- **AI26** The red-flag symptom patterns match substrings ('a faint pull' matches `faint`) yet miss 'dizzy', 'light-headed', 'trouble breathing' and 'chest tightness'. A harmless note can block auto-coach changes and chat plan edits, while a real symptom report gets no urgent notice (`server/services/aiSafety.ts:35`).
- **AI27** Manual "Get workout suggestions" passes `undefined` as the plan goal but still records `planGoalPresent`. The CoachNote then shows a "Plan goal" chip on a suggestion made without the goal (`server/services/aiSuggestionService.ts:323`).
- **AI28** The "prices every env-default model" test hard-codes the model ids instead of reading the env defaults. A new default from an unpriced model family would pass CI and bill at `DEFAULT_PRICING` (5/25 USD per M tokens), hitting athletes' $2 cap after about 3¢ of real use (`server/services/aiUsageService.test.ts:57`).
- **AI29** Race-derived days reach the auto-coach with their generated text but no `raceDerived` flag. An append on a shakeout or race day saves that generated boilerplate plus the cue into `plan_days`, replacing the stored prescription or notes, which `raceDayView` promises never change (`server/services/coachService.ts:57`).
- **AI30** On a table-backed day, a failed or empty structured parse falls back to writing `mainWorkout` text, which the card does not show (it renders the exercise chips). The coach note says "Dropped to 3 sets" while the athlete performs the unchanged 5x5. The fallback is deliberate and documented; the defect is the mismatch (`server/services/coachService.ts:183`).
- **AI31** The overview AI analysis covers the athlete's whole history, with "today" taken in UTC, while the charts beside it show the selected range (90 days by default). The RPE card can say 6.4 next to a chart showing about 7.6 (`server/services/overviewAnalysisService.ts:283`).
- **AI32** Plan generation puts the athlete's goal into the prompt without escaping it, unlike the other prompts, so instructions injected there reach the reasoning model. Only the athlete's own plan is affected, and server-side clamps and Zod parsing still bound the output (`server/services/planGenerationService.ts:207`).
- **AI33** *(raised as medium)* Per-user RAG retrieval sorts by a single HNSW index shared by all users, filters on `user_id` afterwards, and sets no `ef_search` or iterative scan. When the query planner chooses the HNSW path, an athlete can get fewer than `topK` of their own chunks, or none, and fall back to legacy materials. Whether this happens depends on the planner and could not be confirmed without a database (`server/storage/coaching.ts:221`).
- **AI34** Deleting or re-embedding a coaching material clears only the RAG cache in the current process. Another replica can keep quoting the deleted material for up to 120 s, despite the delete route's "stops surfacing immediately" comment (`server/services/ragService.ts:268`).
- **AI35** The shared RAG cache writes a `server_runtime_cache` row for every RAG chat turn, with a near-zero hit rate and a 120 s TTL, but only the daily 04:15 UTC sweep removes them. Coaching excerpts stay in the main DB for up to about 24 h, and each turn costs an extra read and write (`server/services/ragService.ts:393`).

---

## Correctness (server & shared domain logic) — B+

**Assessment.** The core arithmetic is in good shape: the verifiers reproduced many of these findings against the real modules and kept finding that the correct rule already exists elsewhere in the repo (`coachingInsights.ts` keeps speed and time in separate buckets, `bodySystemProfiles.ts` matches sport keywords on word boundaries, `bodySystemLoad` follows `heartRateReflectsEffort`), and the earlier audit fixes these findings build on are in place for the cases they named. Apart from one rarely triggered offline-replay path (C38), no finding loses or rewrites a logged workout or set; the damage that gets stored is limited to plan days written by the AI and adaptation layers (C14, C15, C23, C42, C52), and most of the rest are derived numbers that come out right as soon as the code is fixed. The one high (C1) is a derived number too, but it reaches a lot of places: "best time" ignores distance, so the shortest run or erg piece becomes the record on the PR tab, in the post-save toast, in the weekly email and in the coach's context. Four patterns tie most of the findings together. First, fixes applied to one copy of a rule but not its siblings: the calculation-audit H3 HRmax guard (C10), the mapper-concern H3 range fix (C23), the H7 zero-fill (C6), M15 (C22), the L4 unit stamp (C45, C48) and the H2 visibility gap (C16), plus keyword and heart-rate rules that have drifted apart (C1, C12, C13). Second, metrics whose inputs come from different populations, which produces adherence above 100% and two different streaks or Form values for the same athlete (C7, C18, C20, C35, C37, C44). Third, date anchors that disagree: client-local vs UTC (C4), a rounded span vs Monday-anchored weeks (C19), log date vs scheduled date (C17, C43, C44), and the in-progress local day (C8). Fourth, free-text matching looser than the vocabulary it meets, with the results stored on plan days or fed into load scores (C13, C15, C23, C51, C52). Several survived because the test fixtures happen to avoid the trigger: runs with no distance (C1), a strength log whose text has no trigger substring (C13), one MemoryStore per limiter (C5), and a mocked `getUserMedia` (C2).

| # | Finding | Severity | Verdict |
|---|---|---|---|
| C1 | The "best time" PR is the minimum raw time per exercise, whatever the set's distance, so the shortest piece always becomes the record. Logging 250 m SkiErg intervals after a 1000 m piece fires a false "New PR" toast. Every Strava-connected runner's PR tab shows their shortest-ever run, and the same value reaches the AI coach context, the `get_personal_records` tool and the weekly email's PR count (`server/services/analyticsService.ts:149`). | High | **Confirmed**, 2/2 verifiers. Neither found a guard or a test with sets of different distances, and both note the repo already keeps speed and time in separate buckets in `coachingInsights.ts`. Rated at the lower end of high: derived analytics only, no stored data changes. |
| C2 | Every response, including the SPA document, sends `Permissions-Policy: camera=()`, which turns off the camera for the top-level page. The nutrition barcode scanner's `getUserMedia` call is therefore rejected without a prompt in every Chromium browser, and those are the only engines that ship `BarcodeDetector`. The live scanner cannot work in production; athletes have to type the barcode (`server/index.ts:219`). | Medium | **Confirmed.** Manual entry and the `<input capture>` photo paths are not affected. |
| C3 | For any error that is not an `AppError`, the global handler passes on the error's own `status` and hides the message only at 500. The workout-structure parsers have no try/catch, so a Gemini 400/429 reaches the athlete as raw Google error JSON, and the client treats a provider 429 as the app's own rate limit. A provider 401/403 (for example a rotated key) also goes to the browser as 401/403 (`server/index.ts:423`). | Medium | **Confirmed.** The sibling `parseExercisesFromText` wraps the same errors as a 502. The unreachable `Sentry.setupExpressErrorHandler` is real but harmless, because Sentry capture happens inline. |
| C4 | `parseDateParams` clamps the client's athlete-local `to` down to the UTC date. For athletes east of UTC, today's sessions are missing from personal records, exercise progression and the training overview (totals, this-week count, UTSS/ACWR) until UTC midnight: until 10:00 local in Sydney and 13:00 in New Zealand (`server/routes/analytics.ts:81`). | Medium | **Confirmed.** Reported independently by three reviewers. REFACTORING_REVIEW D7 covers only the case with no `to`, not this clamp. |
| C5 | The rate-limit bucket key is `${category}:user:${userId}`, with no limit or window in it. Every limiter that shares a category therefore increments one Postgres counter but checks it against its own cap. About 60 set-cell PATCHes in a minute (cap 120) use up the 60/min "add set" and 20/min "seed from plan" budgets, and post-save refetches of the 20/min analytics routes start returning 429 (`server/routeUtils.ts:66`). | Medium | **Confirmed.** Reported independently by three reviewers. One report adds an auth-poll case that also holds: GET `/auth/user` every 2 s during auto-coaching, against a 20/min `auth` limiter. Tests can't catch any of this because under `NODE_ENV=test` each limiter has its own MemoryStore. |
| C6 | Avg/Week divides by the number of Monday-weeks touched, counting the partial first week and the in-progress current week as whole weeks. The previous-period comparison is not zero-filled at its edges. An athlete who trains a steady 4 times a week sees about 3.4 on "Last 30 days" (2.8 on a Monday), and the period-over-period change compares two different denominators (`server/services/analyticsService.ts:363`). | Medium | **Confirmed.** The H7 fix added zero-fill but did not handle the edge weeks or the previous window. Item S10 of the archived CODEBASE_REVIEW_2026-06-03-multipass.md (`avgPerWeek` counts the partial current week) is still present. The effect is largest at 30 days. |
| C7 | Avg Adherence adds up `compliancePct` over every log, then divides by a due-session count that leaves out annotated days (travel, injury, rest), let-go days and retired-plan days, and counts plan days rather than logs. Completing sessions during a declared travel week, or linking two logs to one plan day, pushes the figure above 100% (125% in the worked example), and the UI shows it unclamped (`server/services/analyticsService.ts:776`). | Medium | **Confirmed.** |
| C8 | The nutrition summary judges micronutrients on the athlete's local "today" only. The nightly `nutrition_insights` recompute runs at local midnight, when today is still empty, so every regenerated insight says there is no micronutrient data. A mid-morning regenerate compares a partial day against full-day reference intake, and the AI coach repeats the resulting false "low" flags (`server/services/nutrition/nutritionSummary.ts:120`). | Medium | **Confirmed.** Edamam rows never carry micronutrients, so coverage is partial even on a full day. |
| C9 | Strava's `average_cadence` (per-leg strides for runs, rpm for rides) is stored unchanged in the column that Garmin fills with full steps per minute, and both client surfaces label it "spm". A 172 steps/min Strava run shows "86 spm", and a 90 rpm ride shows "90 spm" (`server/services/stravaMapper.ts:143`). | Medium | **Partially confirmed.** Cited line corrected from 318 to 143 (the file has 149 lines). Display only: no server calculation uses the value. |
| C10 | The H3 fix stopped HR reserve and zone boundaries from using the assumed 190 bpm HRmax, but `estimateLthr` and `hrTss` still use it. An athlete with no age or max HR on file gets hrTSS scored against an LTHR of 167: a 52-year-old's 60 min at threshold reads 78.8 instead of about 100 on the load charts, and the AI prompt receives "estimatedLthr 167" (`server/services/trainingLoad/hrModel.ts:191`). | Medium | **Confirmed.** A test pins `estimateLthr({})` to 167. hrTSS is display- and prompt-only and never feeds UTSS. |
| C11 | `applyLoadDynamics` starts both EWMAs at the first logged day's UTSS, and that seed still makes up about 40% of chronic load when the ACWR gate opens on day 14. A new athlete whose first session was unusually long or short reads "undertraining" or "yellow" for two to four weeks, and the governor trims or softens upcoming sessions (`server/services/trainingLoad/loadDynamics.ts:193`). | Medium | **Confirmed.** Reproduced with the real `calculateTrainingLoad`. A Strava history backfill dilutes the effect. |
| C12 | `inferCardioIntensityFactor` uses heart rate whenever it is available, with no sport filter. A set-less lifting import is scored from its low average HR even when the athlete rated it: 60 min at HR 105 with RPE 8 scores 51.6 UTSS instead of 112.8. This contradicts the app's own `heartRateReflectsEffort` rule, which `bodySystemLoad` follows (`server/services/trainingLoad/stressScores.ts:159`). | Medium | **Confirmed.** The verifier narrowed it to lifting imports (Strava WeightTraining, Garmin strength_training), because yoga and Pilates are already non-training sports. |
| C13 | The endurance keyword regex (`/run\|bike\|row\|ski\|walk\|hike/i`) has no word boundaries. Any strength log that has sets and a duration, and whose text contains "rows", "crunches", "skills", "throws" or even "tomorrow", gets a full duration-based cardio score on top of its tonnage score. That roughly doubles UTSS for a realistic 60-min RPE-7 session and moves ACWR, TSB, governor downshifts and periodised nutrition targets. The trigger can be the summary auto-generated from catalogue labels, so no free text is needed (`server/services/trainingLoadService.ts:352`). | Medium (raised as high) | **Confirmed**, 2/2 verifiers (one at high, one at medium). Calibrated down because the "~10x" figure holds only for a two-set session and the trigger needs the optional duration field. Adding word boundaries alone would still match "bent-over rows"; for logs with sets, the decision should come from the sets. |
| C14 | `decide()` measures each log's surplus against that log's own planned weight, and each raise multiplies the current working target. When several logs that beat the same prescription are adapted together, the raises compound past the 5%-per-session guardrail: two front-squat sessions take Friday's 85 kg to 95 kg (+11.8%) instead of 90 kg (`server/services/workoutEngine/adaptation.ts:366`). | Medium | **Partially confirmed.** The claimed AI-outage trigger is wrong, because `generateWorkoutSuggestions` catches provider errors. The real triggers are re-enabling the coach after it was off, several logs inside the 60 s debounce, and any backfilled log, which always carries a stale prescription. |
| C15 | `rewriteExerciseLine` rewrites the first line whose text contains the exercise label. When plan generation's repair step or adaptation rewrites a primary lift (deadlift, bench press, split squat, lunges), it also overwrites a variant line in the accessory text: "Romanian Deadlift 3x10 @ 70 kg" becomes "... @ 147.5 kg". The wrong text is stored and shown to the athlete and the coach next to the correct table rows (`server/services/workoutEngine/planRepair.ts:144`). | Medium (raised as high) | **Confirmed**, 2/2 verifiers (one at high, one at medium). Calibrated down because the structured exercise table keeps the correct loads, and the trigger needs a same-name variant on the primary's day. The Hyrox lens defaults have no such variant; the lenses that default to bench press do. |
| C16 | The timeline keeps one log per plan day, in a `Map` where the last write wins and the query has no ORDER BY, and the standalone-log query excludes plan-linked rows. A second log linked to the same plan day (the picker deliberately offers "(logged)" days) therefore appears nowhere: not on the timeline, not in the GDPR JSON/CSV export (its sets are exported with an empty title), and not in the coach's recent workouts (`server/storage/timeline.ts:647`). | Medium | **Confirmed.** The H2 fix (2026-09-04) stopped the deletion but left the `Map` that hides the extra logs. |
| C17 | The "All plans" timeline excludes retired-plan days on or after `retired_on`, and their linked logs disappear with them. Both supersede and manual retire set the cutoff no earlier than today. So a session logged today against the old plan vanishes from the default timeline, the export and the coach context as soon as that plan is retired (`server/storage/timeline.ts:523-526`). | Medium | **Confirmed.** Location widened to 523-526. The log row survives and still counts toward the streak, so the streak and the timeline disagree. This contradicts the stated intent that retirement must not unattribute workouts already logged. |
| C18 | `getCompletedWorkoutDates` has no `counts_as_training` filter. A daily synced dog walk keeps the home-card and weekly-email streak growing, while the same email reports zero training sessions and the Analytics streak reads 0. The schema says such sessions must not keep a streak alive (`server/storage/timeline.ts:817`). | Medium | **Confirmed.** |
| C19 | `computePlanWeeks` rounds the start-to-end span to whole weeks, but scheduling anchors week 1 on the start week's Monday, so a non-Monday start or a Monday–Thursday race ends the plan up to a week before the race. Example: a start on Wednesday 2026-10-07 with a race on Saturday 2026-11-28 ends on 2026-11-22. Race week has no sessions and no race-day card, and the coach and nutrition phase treat the plan as ended (`shared/dateUtils.ts:42`). | Medium (raised as high) | **Confirmed**, 2/2 verifiers. Reported independently by two reviewers. Calibrated down because every start picker defaults to the next Monday, which always covers Fri–Sun races, and "this is my race date" is off by default unless onboarding supplied a race date. |
| C20 | Fuelling correlation treats any day with a carb target and an RPE or compliance value as eligible, and counts it as a miss unless carbs reach 90% of target. Nothing checks whether food was logged that day. For an athlete who logs food on about half their training days, the card's "RPE was lower on days you hit your carbs" mostly measures logged vs unlogged days (`shared/fuellingCorrelation.ts:101`). | Medium | **Confirmed.** The card's "association, not causation" disclaimer does not cover this confound. |
| C21 | `computeMealFuelTargets` uses calories alone only when all three macros are null. Otherwise each meal's calories are built from whichever macros are set, and unset macros allocate zero. A goal of 2,500 kcal plus 150 g protein produces four 150 kcal meal targets (600 kcal in total), so a normal 700 kcal lunch reads as a 4.7x overshoot (`shared/mealFuelling.ts:479`). | Medium | **Confirmed.** Reproduced with the real module. `docs/nutrition.md` explicitly allows partial goals. |
| C22 | `estimateDuration` cannot tell which block a set belongs to, so once any block is timed it drops every set linked to a block. It also never multiplies sets by a block's `roundCount`. A Hyrox session with a 10-min warm-up, a 4-round main block and a 5-min cool-down is estimated at 15 min instead of about 60. That figure feeds fuelling targets, forward-fuelling planned UTSS, the base value for the AI refinement and missed-recovery sizing (`shared/plannedSessionEstimate.ts:373`). | Medium | **Confirmed.** CALCULATION_AUDIT M15 fixed only the case with no linked sets. |
| C23 | The H3 range fix in `normalizeWorkoutTextUnits` only recognises a dash immediately before the high bound. For an imperial athlete, "60 – 70 kg" is saved as "60 – 154 lbs" and "100 to 110kg" as "100 to 243 lbs", leaving the lower bound in the wrong unit, stored permanently on the plan day (`shared/unitConversion.ts:765`). | Medium | **Confirmed.** MAPPER_CONCERNS_VERIFIED_2026-09-04 marks H3 fixed, but the fix covers only a dash directly before the high bound. |

**Low-severity findings.**

- **C24** Emails fire only when the local hour exactly equals the athlete's chosen hour, so a spring-forward DST gap skips them. A weekly review reminder set inside the skipped hour is lost for the whole week, because it is Sunday-only and US/EU transitions fall on Sundays. Zones that spring forward at midnight (Santiago, Beirut, Havana) also lose that day's analytics recompute (`server/emailScheduler.ts:311`).
- **C25** The Monday weekly summary shows the "New PRs" card only inside the streak block, so an athlete who set PRs midweek but rested on Sunday gets no PR card at all (`server/emailTemplates.ts:530`).
- **C26** Garmin sync fetches only the newest 20 activities, with no pagination, and never creates synthesised device sets. Activities beyond those 20 are never imported, and a Garmin-only athlete's Analytics shows no running slice or running PRs while the overview cards count the runs (`server/garmin.ts:635`).
- **C27** Plan import accepts up to 100,000 CSV characters, but the request goes through the global 100 kB JSON body limit, while the client allows 200 KB. A schema-valid CSV with CRLF line endings or non-ASCII text can therefore get a generic 413. The 2026-07-19 analysis already noted these mismatched size caps (`server/index.ts:250`).
- **C28** `aiConsentCheck` on `/planned-session-estimate` returns 403 to athletes with AI coaching off, even though the service already gates its AI step inline. Those athletes never get the distance-aware, pace-personalised estimate, and their fuelling panel keeps the cruder local seed (`server/routes/nutrition/nutritionSummary.routes.ts:288`).
- **C29** A yoga, soccer or other "other"-class activity whose duration and time of day match a conditioning or Hyrox day scores 0.778, above the 0.75 auto-link threshold. The plan day is then auto-completed at 100% compliance, with its wall balls and sled pushes credited (`server/services/deviceActivityMatcher.ts:258`).
- **C30** The missed-session planner offers the day before the race as a fold target, but the race-day override shows that day as "Shakeout" and hides its exercises. The session the athlete chose to move disappears from the timeline and the coach context (`server/services/missedRecovery/planner.ts:260`).
- **C31** `/summary` and `/summary-range` compute the effective nutrition target over different windows. With adaptive periodisation on, the Nutrition page and the Timeline chip show different carb targets for the same day, and a past day's preload (and its "hit" status) changes once the next day's session is logged (`server/services/nutrition/dailyLoad.ts:153`).
- **C32** Reparsing a logged workout (from text or an image), or PATCHing it with exercises, replaces every set without recomputing adherence or re-queuing the coach. A plan-linked log keeps its old `compliance_pct` and a coach note about exercises that no longer exist (`server/services/parseWorkoutUseCases.ts:84-94`).
- **C33** Pending AI plan-adjustment proposals have no date bounds and never expire. A proposal applied days after it was made can put a session on a date that has already passed, where it immediately reads as missed (`server/services/planAdjustmentService.ts:224`).
- **C34** CSV import checks only positive week numbers against the 52-week cap but keeps negative ones, so a typo row "Week=-40" schedules week 1 forty-one weeks after the chosen start. The import route also replaces the service's specific errors, such as unrecognised Day values, with a generic "Failed to parse CSV content" (`server/services/planService.ts:130`).
- **C35** The race predictor loads 90 days of logs without `onlyTraining`, so walks and other non-training sessions add load. The same athlete can see a different TSB/Form band on the Race Predictor than on the Training Overview (`server/services/racePrediction/racePredictionService.ts:184`).
- **C36** The planned-session estimate is the only fast-model call that does not pass `reasoningEffort`, so it inherits the global "high". If the fast model rejects the parameter, every AI refinement silently falls back to the deterministic value; if it accepts it, a small, tightly clamped refinement pays for high-effort thinking (`server/services/sessionEstimate/plannedSessionEstimate.ts:155`).
- **C37** With no date range selected, the adherence window ends at the athlete's last logged workout. An athlete who stopped logging while the plan ran on keeps 100% "All time" adherence (true figure about 57% in the worked example), while the 90-day view shows the drop (`server/services/trainingOverviewLoader.ts:77`).
- **C38** The SPA catch-all answers any unmatched `/api/v1` path, and any missing `/assets` chunk, with `index.html` and status 200, and the offline queue treats any 2xx as synced. A mutation queued offline against a route that a later deploy renamed is reported as synced and silently dropped (`server/static.ts:40`).
- **C39** Deleting a recipe that is an ingredient of another recipe, or deleting a recipe-backing food via `/foods/:id`, hits an `ON DELETE RESTRICT` foreign key. The transaction rolls back and returns a generic 500 every time, so the item can never be deleted. Reported independently by two reviewers (`server/storage/nutritionRecipes.ts:174`).
- **C40** A recipe's backing food is a snapshot taken at save, while the editor and detail views recompute totals from the current ingredients. After an athlete corrects an ingredient's calories, the recipe view shows the new total but logging the recipe still records the old one until it is saved again (`server/storage/nutritionRecipes.ts:216`).
- **C41** Plan weekly density counts rest-day rows, so every AI-generated plan reports 7 sessions a week and the "weekly goal exceeds plan" hint never fires for a normal goal (`server/storage/plans.ts:355`).
- **C42** Rescheduling a plan re-dates every day but keeps the absolute date stored in `recoveryUndo`. Undoing a fold afterwards (within its 7-day window) moves the session to a date from the old schedule, possibly before the plan's new start (`server/storage/plans.ts:599`).
- **C43** Timeline cursor pages bound plan days by `scheduled_date`, but linked entries are dated by their log. Once an athlete has more than 200 past entries, a completed card dragged across a page boundary is either skipped on every page or shown twice, with a duplicate React key (`server/storage/timeline.ts:533`).
- **C44** `getCompletedWorkoutDates` counts both the log date and the scheduled date of a completed plan day. Logging Monday's session on Tuesday, or dragging its card, adds a phantom Monday that can bridge a gap in the streak (`server/storage/timeline.ts:821`).
- **C45** `fetchPrSetCount` compares against all of the athlete's other workouts, including later ones, and mixes kg and lbs stamps, so a March PR reads as 0 once a heavier lift is logged in June. This is latent, because no client reads `prSetCount` today (`server/storage/workouts.ts:894`).
- **C46** Strava's `EMountainBikeRide` is missing from the non-training deny-list. E-MTB rides count toward Total Workouts, Avg/Week, the streak and the training mix, while Strava e-bike road rides and Garmin e-MTB rides do not (`shared/deviceSportTypes.ts:180`).
- **C47** When the baseline calorie target is below the floor and the computed adjustment is zero, the effective target reports `effective_calorie_floor_applied` but leaves calories unchanged. A manual 1,000 kcal target is shown with an explanation claiming a floor that was never applied (`shared/nutritionTargets.ts:493`).
- **C48** `estimateSetMinutes` reads stored distance using the athlete's current unit preference instead of the row's unit stamp. After a km-to-miles switch, a 10,000 m planned run is read as 10,000 ft, so its estimate drops from 55 to 17 min and its fuelling target and missed-recovery sizing shrink by about 3.3x (`shared/plannedSessionEstimate.ts:322`).
- **C49** The nutrition `isoDate` validator relies on `Date.parse`, which rolls an impossible date such as `2026-02-30` over to the next month instead of rejecting it. Those dates on the summary, targets and block routes return 500 instead of 400 (`shared/schema/nutrition.ts:25`).
- **C50** Several request schemas accept values their database columns reject: non-integer reps, set numbers and weekly goals, duplicate step numbers, impossible dates and an unvalidated plan-day `scheduledDate`. No Postgres error code maps to a 4xx, so these requests return 500 and roll back the whole workout save instead of a field-level 400 (`shared/schema/types/workouts.ts:400`).
- **C51** `readWrittenMinutes` reads "400s" rep slang as 400 seconds and a bare "10:30 pace" as minutes. For a plan day with no exercise table, missed-session sizing treats "8 x 400s with 90s rest" as 65 min instead of about 25 (`shared/sessionTextDuration.ts:119`).
- **C52** For imperial athletes, `normalizeWorkoutTextUnits` converts the "km" in a speed and treats rest or hold shorthand like "2m" as metres. Stored plan text reads "6000 m/h" for "6 km/h", "Rest 7 ft" for "Rest 2m" and "Plank hold 3 ft" for "Plank hold 1m" (`shared/unitConversion.ts:882`).
- **C53** The service worker's NetworkFirst rule falls back to a 5-minute API cache after 10 s. On a slow connection, the timeline refetch after a save can get the pre-save response, which React Query then keeps for its 5-minute stale time, so the just-logged workout looks missing (`vite.config.ts:77`).

---

## Data integrity, concurrency & resilience (server) — B+

**Assessment.** The transactional core holds up well, and in places it is careful. Strava reconciliation locks the plan day with `SELECT ... FOR UPDATE`. Single and bulk deletes capture rows to the recycle bin before removing them. Cron work runs under `pg_try_advisory_lock`, so a tick one replica misses is covered by another. Plan-adjustment proposals are revalidated by fingerprint against the live plan before apply, and referenced custom foods cannot be deleted. The August fixes this pass re-checked are still present: the coaching-material chunk purge and the in-flight plan-generation unique index. Client writes also still strip device provenance. No finding survived at high severity. Four were filed as high (D2, D7, D11, D21) and calibrated to medium. The only cross-account effect in this slice is a write through a shared food row (D18).

Residual risk concentrates in the deploy path, where production's hand-pushed schema and Railway config give no automated gate:
- The healthcheck promotes a deploy before any routes exist (D2).
- Code can go live ahead of the manual schema push (D7).
- The one new data-repair migration is missing from the manual ledger (D1).
- The 60 s graceful shutdown probably never completes (D3).
- The config file Railway reads stops being honoured on 2026-12-01 (D4).

The remaining findings follow three patterns:
1. **Snapshot-then-write with no fence and no recheck under a lock.** This recurs across idempotency claims, job expiry and stranded generations, batch reparse, the embed worker, key rotation, proposal apply and the pending-proposal invariant (D8, D9, D17, D20, D38, D42, D45, D51).
2. **Device-sync provenance.** A sync-created row stays machine-owned however much the athlete edits it. Unlink therefore deletes or strips their edits (D11, D40), auto-completion records the prescription as what was performed (D12), and nothing dedups Garmin against Strava (D16).
3. **Fixes recorded as closed that are only partial.** This covers L4 unit stamps (D21, D22, D41), analytics cache invalidation (D10) and the batch-reparse transaction (D17). Logged nutrition also still reads food rows that another user or a provider can rewrite (D18, D50).

| # | Finding | Severity | Verdict |
|---|---|---|---|
| D1 | Migration 0117 is a DML repair: it recomputes `plan_days.week_number`/`day_name` for sessions moved before `planSlotForMove` existed. DML never runs on push-managed production, yet 0117 has no entry in `pending-manual-steps.md` (which stops at 0094) and no restore-drill probe, and `docs/database.md:232` says it already ran. Every athlete who moved a session before 2026-10-02 keeps a stale week and weekday: a wrong week badge, race-week vs build-phase confusion in the workout engine, and earlier moves that snap back on the next reschedule (`migrations/0117_plan_day_slot_repair.sql:15`). | Medium | Confirmed. Reported independently by 2 reviewers. The H5 manual-step ledger was not maintained past 0094. |
| D2 | The Railway healthcheck targets `/api/v1/health/live`, which returns 200 as soon as the port binds, before `registerRoutes`/`serveStatic` run. A failed boot sets `startupError` but never exits, so `on_failure` never fires. If the DB is unreachable or credentials are wrong at boot, `/live` stays 200 for about 14–54 s: Railway promotes the deploy and retires the healthy one, and every non-health request gets Express's 404 until someone rolls back by hand (`railway.toml:14`, with `server/bootstrap/health.ts:118-124`). | Medium (raised as high) | Confirmed. 2/2 verifiers upheld the mechanism; one rated it high, one medium. Calibrated down: promoting a broken deploy needs an uncommon deploy-time trigger, and on a normal deploy the race is usually won. The trace verifier corrected the outage symptom to 404 rather than 503 for non-health paths. |
| D3 | `railway.toml` sets neither `drainingSeconds` nor `RAILWAY_DEPLOYMENT_DRAINING_SECONDS`. With Railway's documented default of 0 s, the old instance is SIGKILLed right after SIGTERM, so the 60 s shutdown in `lifecycle.ts` (cron stop, queue stop, pool drain, Sentry flush) does not finish. A plan-generation job killed mid-run leaves the plan 'generating' until a startup sweep on a later boot, and pending Sentry events are lost (`railway.toml:8`). | Medium | Partially confirmed. SSE streams are aborted as soon as SIGTERM arrives, so draining would not let a coach reply finish. The setting could also live in the Railway dashboard, which the repo cannot show. |
| D4 | All deploy behaviour lives in `railway.toml`: builder, build and start commands, healthcheck, restart policy. Railway's docs say config-as-code files stop being read on 2026-12-01. No `.railway/railway.ts` exists and no doc tracks the deadline. The first deploy after the cutoff falls back to dashboard settings, possibly with no healthcheck gate, a different restart policy, the Cypress build tweak lost or a builder switch, and no repo change to explain it (`railway.toml:2`). | Medium | Confirmed. `nixpacks.toml` would still supply the start command if the builder stays nixpacks; the other settings would be lost. |
| D5 | The pending 0094 backfill selects every `counts_as_training = true` row with a Strava or Garmin id and demotes deny-list sports. It has no filter on `device_link_source`, `plan_day_id` or import date, and keeps no record of the ids it flips. Running the documented `--apply` step would irreversibly drop athlete-owned sessions out of Total Workouts, Avg/Week and the streak: a manual log later linked to a Strava walk, a plan-linked recovery walk, or an import the athlete switched back on. The script header promises the opposite (`script/backfill-counts-as-training.ts:60`). | Medium | Confirmed. The step has not been run yet. The blast radius is limited to deny-list sports. |
| D6 | The Garmin cached-token path is gated on the short-lived OAuth2 expiry, although the SDK can refresh OAuth2 from the long-lived OAuth1 token without an SSO login. Most syncs therefore perform a full email/password SSO login from the shared server IP. A captcha, MFA prompt or 429 there wipes the stored credentials and forces the athlete to reconnect (`server/garmin.ts:440`). | Medium | Confirmed. Garmin sync is manual, so exposure is one SSO login per sync click rather than a background burst. The 3600 s OAuth2 lifetime comes from a test fixture, not production. |
| D7 | Production schema changes only when an operator runs `drizzle-kit push`. Boot `migrate()` treats the empty-ledger 'already exists' failure as 'schema already up to date', and neither `assertCriticalTablesExist` (five tables) nor readiness (`SELECT 1`) checks columns. A deploy that lands before the push (for example 0119's `chat_messages.attachment`) makes coach chat, chat history and export return 500 while health stays green. A missing `athlete_facts` table would fail every coach context build (`server/maintenance.ts:71`). | Medium (raised as high) | Confirmed, 2/2 verifiers. Calibrated down: the outage is confined to the tables a PR touches, shows up in Sentry, corrupts no data, and ends with one `drizzle-kit push`. Railway auto-deploying on merge is the platform default but is not shown in the repo. |
| D8 | Idempotency claims are not fenced, because `complete()`/`release()` match only user and key. On the common path the verifier found, `res.on("close")` releases the claim when the client disconnects while the handler keeps running and commits. The offline queue then replays the request with the same key and `POST /api/v1/workouts` creates the workout a second time (`server/middleware/idempotency.ts:140-142`). | Medium (raised as low) | Partially confirmed. The reported TTL takeover needs a handler slower than 60 s, which is rare under the 30 s statement timeout. Calibrated up because the disconnect-release path reaches the same duplicate on an ordinary flaky network. |
| D9 | Both job option sets pass `expireInMinutes: 60`, which pg-boss 12.35 does not recognise, and all seven `createQueue` calls pass only a name. Every job therefore expires at the 15-minute queue default, while the 50-minute `runWithTimeout` and 45-minute statement timeout were sized against a 60-minute expiry. A plan generation that passes 15 minutes is failed and its worker slot freed while the original run keeps spending AI beside the next queued generation, and retrying queues can re-dispatch a job that is still running (`server/queue.ts:63`). | Medium | Confirmed. Most retrying handlers are short, so the main exposure is plan generation. |
| D10 | `invalidateAnalyticsCachesForUser` has one production caller, the set-edit use case. Workout create, delete, update and combine, recycle-bin restore and Strava/Garmin syncs leave the 5-minute workout-log and set caches in `routes/analytics.ts` warm. The client's refetch after a write hits the same cache key, so Total Workouts, ACWR, PRs and progression show pre-write numbers, which reads as "my workout didn't save" (`server/services/analyticsRouteCache.ts:96`). | Medium | Confirmed. Reported independently by 3 reviewers. The 2026-08-31 analysis credited write-time invalidation, but that fix covers set edits only. Self-heals within 5 minutes. |
| D11 | Unlink treats any `source='strava'` log with a `planDayId` as sync-owned and hard-deletes it, cascading its sets, structure and streams, with no recycle-bin capture. The update schema never lets `source` change, and the client fires Unlink from one dropdown item with no confirmation. An athlete who corrected the copied sets and added RPE, a note and block scores, then unlinks a wrong match, loses all of it permanently, although `docs/integrations.md` calls unlink lossless (`server/services/deviceActivityLink.ts:401`). | Medium (raised as high) | Confirmed, 2/2 verifiers. Reported independently by 2 reviewers. Calibrated down: each action destroys one log, and the trigger needs auto-link, then edits, then unlink. The guard verifier notes it sits on the high/medium border, since the repo rated the analogous H2 high. |
| D12 | When Strava auto-links a recording to a plan day, every prescribed set is copied in as the actual and compliance is recorded as 100%. No set is built from the recording, and nobody reviews the link. A planned 8 km tempo actually run as 6.1 km credits 8 km to running volume and the max-distance PR. A 'Weight Training' recording can complete a strength day with a 110 kg squat nobody lifted, creating a false PR (`server/services/deviceActivityLink.ts:233`). | Medium | Confirmed. Auto-linking is on by default at a match score of 0.75 or more, and strength-to-strength compatibility is 1.0. |
| D13 | Food search awaits Edamam, USDA and OFF with up to three 8 s attempts per provider (timeouts count as retryable) and no overall deadline, against a 15 s client timeout. Food detail chains USDA fetches the same way. When one provider hangs, the client aborts with "Request timed out" instead of getting the designed cache-only `apiDegraded` response, and un-enriched USDA foods cannot be opened to log (`server/services/nutrition/foodSearch.ts:144`). | Medium | Confirmed. OFF's slow search endpoint alone is enough. The failure needs a provider to hang rather than fail fast. |
| D14 | The generation prompt tells the model to name off-list lifts `custom` with a `customLabel`. The overload clamp keys weekly heaviest loads by `exerciseName` alone, and adaptation drops `customLabel`, so all custom exercises share one identity. A 150 kg custom yoke carry that follows a 40 kg custom sandbag clean is rewritten to about 43 kg at generation (the text still says 150 kg), or capped to 47.5 kg by adaptation (`server/services/planGenerationService.ts:499`). | Medium | Confirmed. The adaptation case reproduced against the real module. |
| D15 | `isGeneratedRestDay` accepts only `focus` 'rest' or `mainWorkout` 'complete rest'. `assertTableFirstGeneratedDays` throws a 502 for any other day with no exercise rows, after every chunk has been generated and paid for. The prompt frames race day as "the event", so a 'HYROX Race Day' entry with `exercises: []` fails the whole plan, and a retry meets the same instruction (`server/services/planGenerationService.ts:425`). | Medium | Confirmed. How often it fires depends on model output. |
| D16 | The Strava reconciler only considers logs with `garmin_activity_id IS NULL`, and the Garmin import dedups only on its own id, so no code correlates the two providers. An athlete whose Garmin watch auto-uploads to Strava with both connected gets two rows per session. Weekly totals, duration, energy-balance calories and training load double, or the open plan day gets a second, plan-derived log (`server/services/stravaReconciler.ts:137`). | Medium | Confirmed. Settings do not prevent connecting both providers. |
| D17 | Batch reparse snapshots the workouts that have no sets, spends minutes on chunked AI calls, then deletes every `exercise_sets` row for each chunk and inserts the AI rows. Sets the athlete logs by hand on one of those workouts during the run are replaced by the AI's parse. The transaction added after `MAPPER_CONCERNS_VERIFIED_2026-09-04`, which named this exact scenario and marked it fixed, only protects against a failed insert (`server/services/workoutService/persistence.ts:47`). | Medium | Partially confirmed. Location corrected: the file is 99 lines, and the delete is at 46–51. The trigger needs the athlete to act during a request lasting a minute or more. |
| D18 | A custom food's owner can make it public. It is then visible to every user, and the meal parser auto-selects an exact-name public 'banana' ahead of cached provider rows. The owner can still edit the name and every per-100g macro, and food logs join foods live. Another athlete who confirmed that food has historical totals, target adherence, session fuelling and AI insights silently rewritten by a later edit (`server/storage/nutritionFoods.ts:269`). | Medium | Confirmed. Reported independently by 2 reviewers. Distinct from the open M11, which covers an athlete rewriting their own history. |
| D19 | `syncPlanDayStatusFromWorkouts` returns early for a 'missed' day whatever logs are linked to it. Restoring a log from the recycle bin, or linking a late log to a day the nightly sweep marked missed, therefore leaves the day 'missed'. The timeline shows the session done while weekly stats, the weekly review and the weekly email count it as missed, contrary to the code's own "log late = completed" rule (`server/storage/planDayStatus.ts:55`). | Medium | Confirmed. |
| D20 | Stale-generation cleanup runs only at boot and only fails rows whose `generationStartedAt` is more than an hour old. The route also does no cleanup if the enqueue fails after the pending row commits. A deploy two minutes into a generation, or a failed enqueue, leaves a 'generating'/'pending' row. Every new generation then returns 409 until a reboot at least an hour after creation, or until the athlete finds and deletes the stub (`server/storage/plans.ts:903`). | Medium | Confirmed. Reported independently by 2 reviewers. |
| D21 | `prescribedSetToLogRow` copies weights and distances from stamped plan-day sets but omits `weightUnit`/`distanceUnit`. Log-as-planned, Strava auto-complete and seed-from-plan therefore write unstamped rows, which read as the athlete's current preference. After a kg/lbs or km/miles switch, every plan-copied set is misread by 2.2× (weight) or 3.28× (distance) in PRs, volume, e1RM and coach context, and the plan and the log disagree (`server/storage/shared.ts:23`). | Medium (raised as high) | Confirmed, 2/2 verifiers. Reported independently by 2 reviewers. Both verifiers class it as an incomplete L4 fix rather than a regression. Calibrated down: only athletes who switch units are affected, and the unit stays traceable through `plan_day_id` while the plan-day rows survive. |
| D22 | Set PATCH/POST and workout writes carry bare numbers with no unit. The server stamps them with the athlete's preference at write time, while the client composed them against a cached preference that a long-open tab never refetches. An athlete who switched to lbs on their phone, then edits a set to 100 on a desktop tab still showing kg, stores 100 lb (45.4 kg): a 2.2× error that PRs, training load and the coach all read (`server/usecases/workouts/mutateExerciseSet.usecase.ts:61`). | Medium | Confirmed. The trigger is uncommon but the error persists. The athlete sees the value re-render and can correct it. |
| D23 | `splitIntoFacts` treats the '1.' of a leading decimal as a list marker and splits after abbreviations such as 'Dr.'. `moveStatementsToCard` stores the pieces as constraint facts, then clears the athlete's original note. '2.5 kg max on overhead press after shoulder surgery' becomes the fact '5 kg max …', which the coach and plan generator then program against (`shared/athleteFacts.ts:79`). | Medium | Partially confirmed. Location corrected (the file is 101 lines). The trigger is wider than reported: a decimal right after a sentence end on the same line is also cut. Reproduced. |

**Low-severity findings.**

- **D24** `post-migration.yml` runs `drizzle-kit migrate` first, which fails at 0000 on push-managed production's empty ledger (and its test section 8 requires at least 15 ledger rows). An operator who follows `pending-manual-steps.md` and dispatches it for 0081 leaves the orphaned-custom-food purge undone (`.github/workflows/post-migration.yml:37`).
- **D25** Four constraints exist only in migration SQL: 0041's two `exercise_sets` FKs and 0036's two MAF CHECKs. Databases built by `migrate()` in dev and CI therefore unlink every structure-linked set on an EMOM edit and reject some MAF writes, and push-built production does neither (`migrations/0041_workout_structure_primitives.sql:53`).
- **D26** Journal `when` values go backwards at idx 9, 11 and 19 with no CI guard, and drizzle's migrator silently skips any migration older than the newest one applied. A rebased migration can therefore go unapplied on developer databases or a future baselined ledger while boot reports success (`migrations/meta/_journal.json:1`).
- **D27** `CYPRESS_INSTALL_BINARY=0` is set on the build command, which runs after nixpacks' install phase has already run the Cypress postinstall. Production builds still download the ~250 MB binary and depend on Cypress's CDN on a build-cache miss (`railway.toml:6`). Partially confirmed: the binary lands in the build cache, not the image.
- **D28** `backfill-structured-exercises` inserts AI-parsed sets without checking again, under a lock, that the owner still has none. An athlete edit or a second concurrent run during a long batch therefore duplicates the session's sets in analytics and PRs (`script/backfill-structured-exercises.ts:263`). Partially confirmed: writing by default is documented in the usage block, and "never advances" is overstated.
- **D29** `parseBackfillFlags` silently drops `--user-id=X`, a valueless `--user-id` and unknown flags. A one-athlete `--apply` rehearsal of the 0094 or L4 backfills then rewrites every athlete (`script/backfillCli.ts:31`).
- **D30** `pnpm db:decode-entities` writes unless `--dry-run` is passed and is not idempotent. A second run turns an athlete's literal `&lt;b&gt;` into `<b>`, and a run "to see the counts" performs the table-wide UPDATEs (`script/decode-text-entities.ts:61`).
- **D31** Shutdown drains SSE before closing the listener. A chat stream that registers during or just after the drain blocks `httpServer.close()` until the 60 s forced exit, which skips `queue.stop()`, `pool.end()` and the Sentry flush (`server/bootstrap/lifecycle.ts:19`).
- **D32** node-cron 4's 1 s missed-execution tolerance drops an hourly tick after an event-loop stall of 2 s or more, with no catch-up. On a single instance, or if every replica stalls, athletes whose notify hour maps to that tick get no session brief, reminder or weekly summary that day (`server/cron.ts:130`).
- **D33** `LOG_LEVEL` is not enum-validated, so a typo such as `warning` crashes boot with a pino error that does not name the variable (`server/env.ts:110`). Partially confirmed: an enum would still fail boot, so the gap is diagnostics, not an outage.
- **D34** The catch around a Garmin sync also covers DB reads, mapping and inserts. A transient statement timeout is reported as a Garmin login failure and wipes the athlete's stored Garmin credentials and tokens, which forces a reconnect and another SSO login (`server/garmin.ts:765`).
- **D35** The 10 MB, 5 MB and 2 MB JSON parsers run at app level, before Clerk auth and every rate limiter. Anonymous clients can therefore make an instance buffer and parse multi-megabyte bodies without hitting any limiter (`server/index.ts:237`).
- **D36** pino-http is mounted after the body parsers, and the global error handler logs nothing. 413 and malformed-JSON 400 rejections, such as oversized chat photos, leave no log line and no Sentry event (`server/index.ts:264`).
- **D37** The analytics recompute worker claims the once-per-day slot before dispatching and never releases it. All three pg-boss retries exit at the claim, so a transient AI or DB failure leaves that night's analysis stale until the next local midnight (`server/queue.ts:452`).
- **D38** An embed job in flight when a coaching material is deleted re-inserts its chunks after the route's inline purge, and retrieval keeps chunks with no matching material. The deleted document keeps feeding coach prompts until the 03:50 UTC prune (`server/routes/coaching.ts:86`). Reported independently by 2 reviewers.
- **D39** `POST /workouts/combine` deletes device-imported sources without a recycle-bin capture or a carried activity id, so the next sync re-imports and double-counts the activity. It also validates with a schema that still accepts provenance fields and `planId` (`server/routes/workouts/workoutsCrud.routes.ts:55`). Raised as medium; lowered because no UI control can start a combine, so only a hand-crafted request reaches it. Reported independently by 2 reviewers.
- **D40** Unlink nulls every column recorded in `filledColumns` at attach time, even one the athlete has since edited. An RPE they changed from Strava's 6 to 8 is removed from their log and moved to the released Strava row (`server/services/deviceActivityLink.ts:407`).
- **D41** CSV and JSON exports print raw stored set weights and distances under the athlete's current unit label and ignore each row's L4 stamp. A kg-to-lbs switcher's export shows a 140 kg set as 140 lbs (`server/services/exportService.ts:325`). Raised as medium; lowered because it needs a unit switch after migration 0088, and the JSON `timeline` still carries the per-row stamps.
- **D42** The opt-in key-rotation sweep re-encrypts credentials from a snapshot with unconditional per-row UPDATEs. A Strava refresh token rotated during the sweep can be reverted, forcing a reconnect, and Garmin credentials cleared after an auth failure can be re-stored (`server/services/keyRotation.ts:56`). Raised as medium; lowered because it runs only during an operator-initiated rotation, with expected collisions well below one user.
- **D43** Barcode lookup has no try/catch around the Open Food Facts resolve. An OFF outage or 429 on an uncached barcode therefore returns a 500 instead of the documented "Barcode not recognized" path to adding a custom food (`server/services/nutrition/barcode.ts:31`).
- **D44** Imported micronutrients are only screened for non-finite and negative values. An OFF entry with mg typed into a gram field caches 400,000 mg sodium per 100 g, which shows in the micro panel and AI context as thousands of percent of the RDI (`server/services/nutrition/sanitize.ts:43`).
- **D45** Proposal apply checks fingerprints without a lock, runs the multi-second AI re-parse, then writes from the rows it read before. A concurrent edit to an affected day is overwritten, and undo restores the stale table (`server/services/planAdjustmentService.ts:807`).
- **D46** If plan generation's final transaction fails after `schedulePlan` has committed, the plan is marked 'failed' but its dated days remain. The failed plan becomes the active plan on the timeline, the superseded plan is never retired, and a retry adds a third plan (`server/services/planGenerationService.ts:1046`).
- **D47** A Strava standalone import commits its log and its synthesized exercise set in separate statements. A fault between them leaves the import permanently without a set, because later syncs dedupe it, so it is missing from set-derived analytics (`server/services/stravaReconciler.ts:305`).
- **D48** A manual "Done" on a plan day never checks for an existing linked log, and it inserts before locking the day. A confirm that overlaps or follows a Strava reconcile creates a second log with a second copy of the prescribed sets, counted twice in analytics and PRs (`server/services/workoutService/workouts.ts:167`). Partially confirmed: the verifier widened the trigger to a stale UI and showed that locking first would not fix it on its own.
- **D49** Workout create and update transactions call `loadUnitPreferences` through the global pool mid-transaction. Twenty concurrent saves on one instance can hold every pool connection while each waits for a 21st, which stalls all requests for 10 s before the saves fail with 500 (`server/services/workoutService/workouts.ts:139`).
- **D50** Provider cache upserts and the 60-day refresh overwrite name and per-100g macros in place, and food logs join foods live. An OFF or Edamam reformulation or crowd edit therefore silently changes every past day on which the athlete logged that product (`server/storage/nutritionFoods.ts:139`). Raised as medium; lowered because USDA values are immutable per fdcId and this extends the accepted-open M11 decision.
- **D51** No partial unique index backs the "one pending proposal per user" rule. Two concurrent plan-adjustment turns leave two proposals pending, and `GET /plan-proposals/pending` returns one at random (`server/storage/planProposals.ts:111`). Partially confirmed: fingerprint revalidation blocks overlapping applies, so only proposals on disjoint days can both apply.
- **D52** Boot-time `resetStaleAutoCoaching()` has no age threshold. A replica booting in a rolling deploy clears another replica's in-flight auto-coach flag, so the client stops polling early and the coach's later plan edits appear only on an unrelated refetch (`server/storage/users.ts:440`).
- **D53** A custom food that was shared, logged by another athlete and then unshared survives its owner's account erasure as an ownerless private row with its name intact. This happens despite the Privacy page's advice to unshare before deleting, and the row trips the restore drill's 0081 probe (`server/storage/users.ts:201`).
- **D54** `vectorPool` forces SSL in production even when it falls back to the Railway-internal, non-SSL `DATABASE_URL`. In documented single-DB mode, RAG, semantic food search and every account deletion fail while `/health` stays green (`server/vectorDb.ts:22`).
- **D55** The plan-day PATCH schema still accepts `weekNumber` and `dayName`, and storage writes them verbatim when no `scheduledDate` is sent. A hand-crafted request can store week -3 and shift the athlete's other sessions on the next reschedule (`shared/schema/types/plans.ts:103`).
- **D56** Workout-log `duration`, `calories`, `elevationGain`, speeds, `avgWatts` and `sufferScore` have no bounds in the schema or the DB. A client bug that sends seconds as minutes stores a 60-hour session and silently skews weekly duration, hrTSS, cardio load and fuelling estimates (`shared/schema/types/workouts.ts:44`).

---

## Client correctness & state — B

**Assessment.** The client's write paths stand on well-built primitives: per-set `expectedVersion` tracking with 409 handling, an offline queue that gives each entry its own idempotency key, reconciles its owner by userId and announces drops (max_age, max_retries, storage_full, wrong_account), debounce helpers that flush on unmount and dedupe against the last save, field-scoped rollbacks, and a `safeStorage` wrapper for blocked storage. No finding exposes another user's data. Residual risk concentrates in component lifecycle around sheets and debounced editors: sheets stay mounted with `entry=null`, collapsibles unmount their children and closures capture first-render state, so collapsing, closing or a fast tap reverts or drops the athlete's own input (CL1, CL8, CL12, CL18, CL21, CL31). Invalidation lists are written per mutation rather than derived from what the server computes, so derived views stay stale after writes that change them (CL10, CL19, CL22, CL43, CL50, CL53, CL67). Several audit fixes reached only one copy of duplicated logic, and the other copy still ships the original bug (CL2 for H1, CL5 for H8, CL58 for H2, CL66 for N1, CL52 for the 2026-09-04 rollback fix). The offline queue treats transient failures as permanent and does not keep write order (CL27, CL28, CL29, CL57), and the structure editor is lossy or blocked on every surface that hosts it (CL13, CL14, CL15, CL16). The grade reflects strong primitives held back by the number of medium-severity input-loss defects on the primary editing surfaces, which puts this dimension below the A- the Correctness lens earned in the 2026-08-31 analysis.

| # | Finding | Severity | Verdict |
|---|---|---|---|
| CL1 | The prescription/description textarea's empty-deps unmount cleanup closes over the mount-time draft and calls `onSave` with it whenever it differs from the last save. Collapsing "Coach's text / photo", closing the sheet or scanning a photo after an edit therefore silently PATCHes the old text back over the autosaved one on LogSheet plan days and ReviewSurface's prescribed fields, and wipes typed text on collapse in AdhocLogSheet (`client/src/components/workout-detail/CoachPrescriptionCollapsible.tsx:324-329`) | **High** | **Confirmed** (2/2 verifiers, both reproduced). The guard verifier added photo-scan as a third trigger and narrowed AdhocLogSheet to collapse or scan, since closing that sheet discards the draft anyway. No test covers unmount |
| CL2 | The MAF tag form seeds `durationSeconds` with `workout.duration`, which is stored in minutes, and submits it as a manual override that beats the server's correct conversion. Every default tag of a 45-minute run stores 45 seconds, and the MAF trend plots a pace about 60x too fast. This regresses CALCULATION_AUDIT_2026-08-20 H1 (`client/src/components/workout-detail/MafTestTagSection.tsx:105`) | **High** | **Confirmed** (2/2 verifiers, both reproduced). Both moved the line from :301 to :105 (the file has 293 lines). Only MAF-method athletes can reach it, but it is the only client tagging path, the bad value is persisted, and editing re-seeds from it |
| CL3 | Every authenticated route is `React.lazy`, React caches a rejected lazy import, and the server answers a missing `/assets/*.js` with index.html. After a deploy, the error boundary's "Try again" re-throws the same chunk error until the athlete reloads the browser. First-session tabs, hard reloads and mixed-replica rollouts are exposed, because the service worker covers none of them (`client/src/App.tsx:34`) | Medium | **Confirmed** |
| CL4 | MAF test history and both trend charts date each test by its `created_at` (the moment of tagging) in UTC, not by the workout date. Three older runs tagged today all plot on today, which hides the improvement MAF testing exists to show. An evening tag in the Americas lands on the next day (`client/src/components/analytics/mafTrend.helpers.ts:126`) | Medium | **Confirmed** |
| CL5 | The weekly "Avg Duration" trend divides `totalDuration` by every workout instead of `workoutsWithDuration`. That is the H8 error, which was fixed only on the server. A week with 10 workouts, 5 of them recording 60 min, plots 30 min while the stat card shows 60, and `utils.test.ts` pins the wrong division (`client/src/components/analytics/training-overview/utils.ts:82`) | Medium | **Confirmed** |
| CL6 | The consistency heatmap always draws 16 weeks ending today, but it receives workout dates only for the selected Analytics range and colours every missing day "Rest day". On the default 90-day range, real training in the leftmost 2-3 weeks renders as rest days. On 30 days, 11-12 of the 16 weeks do (`client/src/components/analytics/WorkoutHeatmap.tsx:17`) | Medium | **Confirmed** |
| CL7 | When the browser cannot parse what was typed into a number cell (e.g. "62,5" or "1,000"), the input's value is `''`, and on blur `commitDraft` saves that as a clear. A stored 60 kg becomes null while the cell keeps showing the typed text, so the loss stays invisible until the row remounts (`client/src/components/exercise-row/InlineSetEditor.tsx:420-437`) | Medium (raised as high) | **Partially confirmed** (2/2 verifiers), calibrated down. Browsers localise number inputs to the browser's own locale. The trigger is therefore a separator that does not match that locale (a European keyboard on an English-language browser, or a thousands separator), not every German- or French-locale user. The loss is one field the athlete can re-enter. The "8.5"/"-3" reps sub-claim is rejected server-side with a rollback toast, so no data is lost there |
| CL8 | NotesField resets its draft to the prop on any render where the two differ. With debounced saves the prop only changes when the 350 ms timer fires, so each keystroke snaps back. Per-set notes in LogSheet and ReviewSurface save roughly the last character typed, which makes them effectively uneditable on both main editing surfaces (`client/src/components/exercise-row/InlineSetEditor.tsx:493`) | Medium | **Confirmed**. The other set fields use the draft/lastExternal guard. NotesField does not, although a comment in AthleteNoteInput says it does |
| CL9 | The onboarding race-date input enforces only the native `min`, which typed dates bypass, and neither the wizard nor `createSamplePlanSchema` rejects a past date. A mistyped year makes every scheduled template-plan day render as post-race recovery. No route or UI can edit the plan's raceDate afterwards (`client/src/components/onboarding/GoalStep.tsx:116`) | Medium (reported as low) | **Confirmed**, calibrated up. The verifier traced the past date through `deriveRaceDayOverride`, which turns the whole plan into post-race recovery. The only fix is deleting the plan |
| CL10 | Creating or deleting an injury/illness annotation invalidates only the annotation and training-overview keys, not the timeline, whose `excused`/`status`/`recoverable` fields the server derives from annotations. Excused days keep the "Missed" badge and recovery prompt (a Fold attempt returns 409). Deleting an annotation leaves "Not counted" on days that are really missed (`client/src/components/timeline/annotations/timelineAnnotationMutations.utils.ts:9`) | Medium | **Confirmed**. Reported independently by 2 reviewers |
| CL11 | The "Pick date…" dialog calls `onMove` and closes on the first `onChange`, which a desktop date input fires on every input event. Typing a year digit moves the session to year 0002, and ArrowUp moves it one day. Either way the athlete gets a "Workout moved" toast with no undo, and the server accepts the date (`client/src/components/timeline/timeline-workout-card/TimelineWorkoutCard.tsx:895`) | Medium | **Confirmed**. Reported independently by 2 reviewers. Picking from the calendar popup with a mouse fires only once |
| CL12 | FuellingPlanPanel debounces saves through one timer that holds only the latest `updates` object, and its unmount cleanup clears the timer without flushing. Changing duration and then RPE within 500 ms saves only RPE. A change made just before closing is never sent, and reopening shows the old values and fuel target (`client/src/components/workout-detail/FuellingPlanPanel.tsx:128`) | Medium | **Partially confirmed**. The cited line :338 does not exist (the file has 263 lines); the code is at :112-132 |
| CL13 | LogSheet renders the structure editor on planned days without checking `emomBuilderEnabled`. `PATCH /plans/days/:dayId/structure` returns 403 `EMOM_BUILDER_DISABLED` for any non-empty body under the default `EMOM_BUILDER_ENABLED=false`. Every block add or edit on a planned session rolls back with "Couldn't save workout blocks" (`client/src/components/workout-detail/LogSheet.tsx:213`) | Medium | **Confirmed**. Reported independently by 2 reviewers. docs/PRODUCT_OPPORTUNITIES.md describes this state without treating it as a bug. The production flag value cannot be checked from the repo |
| CL14 | The structure editor holds every block as a `WorkoutStructureConfig` and re-sends all of them on any edit, including blocks the athlete never touched. Step metadata (category, customLabel, stepRole, intensity, tempo, numeric targets) and block-level fields are dropped, "quality" becomes "steady" and "activation" becomes "warmup" (`client/src/components/workout-structure/configToStructureBlocks.ts:28`) | Medium | **Partially confirmed**. The cited :466 and :493 do not exist (the file has 78 lines). The server's `mirrorStructureStepsFromExerciseRows` restores some fields on linked work steps. The ReviewSurface scenario persists nothing, because a structure-only `PATCH /workouts/:id` throws drizzle's "No values to set". The loss is reachable through the ungated /log ConfirmStep, and through LogSheet only with the EMOM flag on |
| CL15 | Reordering or removing a structure step renumbers steps by position but leaves linked exercise rows in place. The server then copies step names back from the rows still linked at each old position and unlinks rows whose step number is gone. Removing "Min 1 Wall balls" from [Wall balls, Burpees, Row] saves [Wall balls, Burpees] and orphans the Row sets, and moves are silently reverted (`client/src/components/workout-structure/WorkoutStructureEditor.tsx:250`) | Medium | **Confirmed**. It reaches production through the /log ConfirmStep. The ReviewSurface path fails earlier, and the LogSheet path needs the EMOM flag |
| CL16 | DraftExerciseTable reads the block from its render closure, patches one set and replaces the whole block. The row menu's block assignment calls `onUpdateSet` for every set in the same tick, so only the last set keeps the assignment. Assigning a 3-set exercise to an EMOM minute on the /log Confirm step links one set and leaves two unassigned (`client/src/components/workout/DraftExerciseTable.tsx:285`) | Medium | **Confirmed** |
| CL17 | After "Clear conversation" succeeds, the hydration effect sees `historyLoaded=false` while the old cached history is still in place. It re-applies that history before the refetch returns, then ignores the empty refetch. Every cleared message reappears and stays until the panel remounts, although the server has deleted them (`client/src/hooks/chat/useChatHistory.ts:46`) | Medium | **Confirmed**. The existing unit test mocks `data: []`, so it cannot catch this |
| CL18 | LogSheet stays mounted with `entry=null` after closing, so the owner-change branch calls `cancelPending()` and discards queued 350 ms set PATCHes. Only the footer buttons flush. An athlete who edits a planned-session cell and taps X (or touch-taps the overlay) silently loses that edit, and "Log as planned" later copies the old prescription (`client/src/hooks/useExerciseSetsForOwner.ts:172`) | Medium (raised as high) | **Confirmed** (trace confirmed, guard partially confirmed), calibrated down by both: each occurrence loses one visible field the athlete can re-enter. The guard verifier found that Escape, a desktop overlay click and a swipe lose the draft before it reaches the debouncer, so a flush in `onOpenChange` alone would not fix those |
| CL19 | Saving nutrition targets invalidates only the targets key, not the day summary (effectiveTarget, mealTargets) or the timeline fuel chips. After raising calories from 2000 to 2500 the header still reads "of 2000 kcal" for up to 5 minutes, and a first-time user still sees the "Set targets" prompt. The onboarding wizard has the same gap (`client/src/hooks/useNutrition.ts:424`) | Medium | **Confirmed**. Reported independently by 3 reviewers |
| CL20 | Re-running onboarding with any changed body field posts bare macros, which writes a new target version with periodisation, recovery and phase-awareness off and every knob nulled. The preview also uses 0.25 kg/wk while the save uses the Settings rate (2,381 kcal previewed vs 2,106 stored in the cited case). Conversely, an unchanged profile skips target creation despite the checked switch (`client/src/hooks/useOnboardingWizard.ts:343`) | Medium | **Confirmed**. All three sub-claims hold. The switch label discloses that macros will be replaced, but not that periodisation will be lost |
| CL21 | The reparse mutations have no mutationKey, so TanStack copies the latest render's options (with `planDayId=null` once the sheet closes) onto the pending mutation. If LogSheet is closed during an AI parse, nothing is invalidated. Reopening within 5 minutes shows the pre-parse rows, which invites a second paid parse, and edits PATCH set ids that no longer exist (`client/src/hooks/usePlanDayExercises.ts:179`) | Medium | **Confirmed**. The set-PATCH rollback half needs a failure exactly at close and is the rarer path |
| CL22 | Closed-week reviews are cached with `staleTime: Infinity` on the premise that a closed week never changes. The server builds the review live, though, and no timeline write invalidates it: a late log, complete, skip, move, delete or annotation. An athlete who logs a missed session late and returns to that week's review within 30 minutes still sees it as Missed, with the old counts (`client/src/hooks/useWeeklyReview.ts:37`) | Medium | **Confirmed**. Reported independently by 2 reviewers |
| CL23 | `handleDelete` prefers `planDayId`, and completed planned sessions carry both ids, so ReviewSurface's delete confirmation ("This workout and all of its data will be permanently removed") deletes only the plan day. The log survives (`plan_day_id` is ON DELETE SET NULL) and reappears as an unplanned workout after the refetch. Bulk delete uses the same precedence (`client/src/hooks/useWorkoutActions.ts:84`) | Medium | **Confirmed**. The precedence was meant for "remove from plan". The undo toast, the recycle bin or a second delete recovers the data, which caps the severity at medium |
| CL24 | `logWorkoutMutation` primes the workout-detail cache with the POST response, which omits `structureBlocks` and `suggestedRpe`, and nothing refetches it for 5 minutes. After "Log as planned" on an EMOM or interval day, the review sheet shows zero blocks and no block-score controls, which is exactly when the athlete would score rounds (`client/src/hooks/workout-actions/useWorkoutActionMutations.ts:166`) | Medium | **Confirmed**. The further claim that adding a block from the empty view replaces the copied structure does not hold today. A structure-only `PATCH /workouts/:id` fails server-side before writing (see CL14), so the add is rolled back |
| CL25 | `runAutoParse`'s `finally` clears `autoParsing` unconditionally, so an aborted earlier parse clears the flag while the newer parse started by Next is still running. The Confirm step then hides the parsing indicator and enables Save, and the workout can be saved without the newly typed exercises. If the newer parse fails, Back/Next will not re-parse (`client/src/hooks/workout-editor/useAutoParse.ts:128`) | Medium | **Confirmed** |
| CL26 | Six calls use the client's 15 s default timeout: image/AI parse, meal photo/label/text parse, nutrition-insights regeneration, Strava sync and the non-streaming chat fallback. The server allows 90 s per AI call (120 s budget) and up to 30 s of Strava enrichment. A slow whiteboard scan shows "AI couldn't parse that photo" while the server finishes the parse, charges the AI budget and counts it toward the 5/min parse limiter (`client/src/lib/api/exercises.ts:46`) | Medium | **Confirmed**. One location corrected: `coaching.ts:92` is `sendStream`, which already sets 60 s. The 15 s call is `chat.send` at `coaching.ts:102-103` |
| CL27 | A write queued after a 15 s timeout while `navigator.onLine` stays true is retried only on a later `online` event or a reload. There is no interval, no visibilitychange flush and no "Sync now" control. If the timed-out POST actually committed, the timeline shows the real row next to the synthetic pending entry, so the workout appears twice (`client/src/lib/offlineMutationFallback.ts:42`) | Medium | **Confirmed** |
| CL28 | Replay counts every failure toward `MAX_RETRIES=5`, with no backoff and no status classification: a transport error, a 401 from an expired Clerk session, a 429 or a 5xx. At five the entry is dropped. A queued workout or food log is permanently discarded after five failing reconnect triggers (`client/src/lib/offlineQueue.ts:320`) | Medium (raised as high) | **Partially confirmed** (2/2 verifiers), calibrated down. A reconnect burns one try, not two, unless triggers overlap. A page-load flush usually succeeds and ends the chain. Captive-portal Wi-Fi does not fire repeated `online` events. A toast announces the drop |
| CL29 | The replay loop catches each error and carries on. A later queued edit to the same record lands first; the earlier one, which failed transiently, replays on the next flush and wins. An athlete who marks a plan day skipped and then completed while offline can end with "skipped" on the server, the opposite of their last action (`client/src/lib/offlineQueue.ts:294`) | Medium | **Confirmed**. Reported independently by 2 reviewers. It contradicts the code's own "must land in the order they were made" comment |
| CL30 | "Continue to exercises" parses the current text and changes step without stopping the continuous speech session, and the mic controls unmount with the Capture step. Everything said afterwards, including talk with a training partner, is appended invisibly to the saved description. Exercises spoken after Continue miss the parse and are absent from the sets, PRs and load (`client/src/pages/log-workout/LogWorkoutStepperLayout.tsx:94`) | Medium | **Confirmed**. WorkoutComposer already guards the same hazard on panel collapse |
| CL31 | Snap-a-meal and Scan-label own their parse mutation inside the Log food sheet, which can be dismissed mid-parse, and once the observer unmounts TanStack skips the mutate-level `onSuccess`. The 5-15 s vision call still completes and is billed against the AI budget, but no review sheet or toast appears. The button shows no progress during the call, which makes dismissal likely (`client/src/pages/nutrition/LogFoodActions.tsx:54`) | Medium | **Confirmed** |
| CL32 | In edit mode, the goal projection adds the entry's new serving on top of day totals that already include its old serving. Opening Edit on an unchanged 600 kcal dinner shows "Calories 75% → 100%" and can flag "over target", nudging the athlete to under-eat (`client/src/pages/nutrition/LogFoodDialog.tsx:349`) | Medium | **Confirmed**. Display only, but it fires on every edit wherever a target exists. Only create mode is tested |
| CL33 | Saving a new carb baseline in TargetsDialog copies the old periodisation slope, cap and preload rate forward, although all three derive from the baseline. Cutting from 400 g to 150 g gives 0 g carbs on rest days and 430 g (2.9x baseline) on a UTSS-120 day; a fresh config gives 75 g and 255 g (`client/src/pages/nutrition/TargetsDialog.tsx:105`) | Medium | **Confirmed**. The numbers were checked by hand, and nothing else recalibrates these fields |
| CL34 | `handleSave` requires a MAF category for every save while the training style is `maf_method`. Accounts set up before audit M6 have `mafCategory` NULL, because migration 0090 did not backfill it. Those athletes cannot save units, notifications, AI consent or any other setting until they answer the category question, which also overwrites their stored mafHr (`client/src/pages/settings/usePreferencesForm.tsx:180`) | Medium | **Confirmed**. Reproduced with a renderHook test. The code's own comment says saving other settings never disturbs legacy accounts |

**Low-severity findings.** Nine of these were reported as medium and calibrated down by their verifiers (CL38, CL41, CL46, CL52, CL54, CL55, CL61, CL65, CL67), mostly because the trigger is narrow, the effect is display-only, or the loss is visible and recoverable.

- **CL35** The PR list prints the stored fractional minutes with a "min" suffix, so a 3:46 row reads "3.7666667min" and a 45 s plank "0.75min" (`client/src/components/analytics/PersonalRecordItem.tsx:77`).
- **CL36** Applying a coach suggestion checks the target plan day against the plan-filtered, paged timeline, so with another plan selected the chat replies "Could not find the workout" and every retry fails until the filter changes (`client/src/components/coach/SuggestionsTab.tsx:59`).
- **CL37** The onboarding fuelling step accepts a decimal age such as 34.5, which the server's integer schema rejects, so the whole body profile and the suggested targets are lost behind a generic "Could not save your fuelling profile" toast (`client/src/components/onboarding/FuellingStep.tsx:66`).
- **CL38** A cancelled training-style switch leaves `pendingStyleId` set, so a later "Save MAF setup" silently applies it and the next Save Settings takes the athlete off MAF (`client/src/components/settings/TrainingStyleSection.tsx:376`).
- **CL39** "Complete workout" proceeds after the flushed cell PATCH fails (409, 400 or 429), because the flush swallows rejections, so the workout is logged with the pre-edit value (`client/src/components/workout-detail/LogSheet.tsx:569`).
- **CL40** FuellingPlanPanel seeds duration, RPE, start time and touched-state only on mount, so when an open sheet is re-targeted (deep link, notification, back/forward) it shows the previous entry's values and a stepper tap PATCHes the new day with values derived from the old one (`client/src/components/workout-detail/LogSheet.tsx:628`).
- **CL41** A coach message sent before the saved history loads disappears with its streaming reply when the history arrives; both turns are persisted and reappear on the next mount (`client/src/hooks/chat/useChatHistory.ts:37`).
- **CL42** Debounced autosaves for set cells, notes and prescriptions (350-600 ms) flush only on React unmount, and no pagehide or visibilitychange listener exists, so swiping the app away right after typing loses the edit (`client/src/hooks/useDebouncedSetPatches.ts:86`).
- **CL43** No workout or set write invalidates the "Last time" exercise history, so a corrected or deleted session keeps driving the line and its suggested next target for up to 10 minutes (`client/src/hooks/useExerciseHistory.ts:31`).
- **CL44** A restored log-workout draft can resume on step 2 or 3, where its stale date is not shown, and offers no way to discard it, so an abandoned Monday draft finished on Thursday is saved on Monday (`client/src/pages/log-workout/LogWorkoutForm.tsx:142`).
- **CL45** The local onboarding-complete flag is not scoped to a user, so if one athlete's session ends without the sidebar sign-out, a new account on that device skips onboarding (units, MAF, fuelling, AI consent) and is marked complete on the server (`client/src/hooks/useOnboarding.ts:44`).
- **CL46** If the athlete goes back and switches kg/lbs after typing a bodyweight on the fuelling step, the number is reinterpreted rather than converted, so 80 kg saves as 36.3 kg and the targets are computed for that weight (`client/src/hooks/useOnboardingWizard.ts:129`).
- **CL47** Plan-generation polling has no cap or error exit, and the dialog cannot be closed while it polls, so a job stranded by a worker crash traps the athlete until a page reload (`client/src/hooks/usePlanGeneration.ts:50`).
- **CL48** Scheduling a plan invalidates only that plan's timeline key, so switching back to "All plans" within 5 minutes shows the pre-schedule timeline without the new sessions (`client/src/hooks/usePlanImport.ts:133`).
- **CL49** The CSV import preview splits on raw commas, overcounts "more workouts" when the file ends with a newline, and gives two sessions on the same day the same React key; the server-side import itself is unaffected (`client/src/hooks/usePlanImport.ts:169`).
- **CL50** No delete mutation invalidates the recycle-bin list, so an athlete who lets the Undo toast expire may not find the deleted workout in Settings → Recycle bin for up to 5 minutes (`client/src/hooks/useRecycleBin.tsx:31`).
- **CL51** Saving a weekly intent invalidates the Monday key while the page queried the raw `?week=` date, so on a non-Monday link the saved text never comes back and Save stays enabled, and next week's `previousIntent` is never refreshed (`client/src/hooks/useWeeklyReview.ts:54`).
- **CL52** A failed set PATCH restores the whole cached workout, so an RPE, title or other set saved in the meantime reverts on screen (display only, healed by the next refetch) (`client/src/hooks/useWorkoutDetail.ts:175`).
- **CL53** Editing RPE in the review sheet leaves the adjacent "Fuelling around session" target and the training-overview load at their pre-RPE values until a remount (`client/src/hooks/useWorkoutDetail.ts:393`).
- **CL54** Saving while dictating builds the payload before speech recognition delivers its final result, so the last spoken phrase is not saved, although the screen showed it as interim text (`client/src/hooks/useWorkoutForm.tsx:32`).
- **CL55** Logging a planned session from the timeline circle or LogSheet's "Log workout" has no offline-queue fallback, so on a connection the browser still reports as online but that fails, the athlete gets "Failed to log workout" where /log would have queued the write (`client/src/hooks/workout-actions/useWorkoutActionMutations.ts:151`).
- **CL56** The client never reads chat history's `X-Next-Cursor` header, so coach messages older than the newest 50 rows cannot be reached (`client/src/lib/api/coaching.ts:122`).
- **CL57** Offline replay requests have no timeout and later flushes join the in-flight run, so one hung POST blocks every queued write until the browser's TCP timeout or a reload (`client/src/lib/offlineQueue.ts:315`).
- **CL58** The new-PR toast prints time PRs as decimal minutes ("Best time 3.9" for 3:52) and weight or distance with no unit, the H2 defect that was fixed only in WeeklyReviewHighlights (`client/src/lib/personalRecordAchievements.ts:12`).
- **CL59** The Coach panel's completion rate (labelled "all-time" for screen readers) and its weekly counts come from the loaded, plan-filtered timeline pages, so they shift with the plan filter and with "Load older workouts" (`client/src/lib/statsUtils.ts:23`).
- **CL60** `migrateLegacyKeys` reads `localStorage` in a default parameter outside its try, so a browser with site data blocked throws at module load and shows a blank page instead of the landing page (`client/src/lib/storageMigration.ts:9`).
- **CL61** Deliberately signing out with pending offline writes clears the queue with no confirmation and no drop toast, unlike every other drop path (`client/src/lib/userLocalData.ts:69`).
- **CL62** Pressing Enter in food search within the 300 ms debounce picks the top hit of the previous query, and RecipeBuilderDialog appends that ingredient without confirmation (`client/src/pages/nutrition/FoodSearch.tsx:40`).
- **CL63** Editing only an entry's meal re-saves its grams through portion snapping or whole-gram rounding, so 240 g becomes 236 g and 7.5 g becomes 8 g although the athlete never touched the amount (`client/src/pages/nutrition/LogFoodDialog.tsx:417`).
- **CL64** "Calculate from profile" treats an unset goal rate as 0, so a "lose" goal with no rate gets maintenance calories (2,656 kcal in the cited case vs about 2,381 from onboarding's 0.25 kg/wk default) (`client/src/pages/nutrition/TargetsDialog.tsx:83`).
- **CL65** The nutrition page dates entries by device time, but the server derives `logDate` from the stored profile timezone, which syncs once per session and swallows failures, so a travelling athlete's dinner can land on tomorrow and be logged twice (`client/src/pages/nutrition/utils.ts:29`).
- **CL66** The create-mode and parsed-meal food previews use a client copy of the scaling that lacks the N1 macro-derived calorie fallback, so a product with no energy field previews 0 kcal while the server stores 860 kcal (`client/src/pages/nutrition/utils.ts:58`).
- **CL67** Changing weight or distance units relabels cached PR and exercise-analytics numbers at once but does not refetch them, so for up to 5 minutes a 100 kg PR reads "100 lbs" (`client/src/pages/settings/usePreferencesForm.tsx:105`).
- **CL68** If the athlete edits a setting while Save is in flight, the post-save refetch overwrites the edit and the Save bar disappears, so the change is lost without a prompt (`client/src/pages/settings/usePreferencesForm.tsx:116`).
- **CL69** Undoing a MAF age/category change reverts the inputs but not `users.mafHr`, so session grading and MAF compliance keep the undone ceiling (e.g. 130 instead of 140 bpm) until a later save (`client/src/pages/settings/usePreferencesForm.tsx:141`).
- **CL70** Every future day is a drop target for a logged workout, but those drops always fail with "Couldn't move workout", and because the server's not-in-the-future check runs in UTC, "Move to tomorrow" fails for UTC+N athletes until late morning; the drag-and-drop half was already open in CODEBASE_ANALYSIS_2026-07-19 (`client/src/pages/Timeline.tsx:281`).
- **CL71** When a status filter matches nothing in the loaded pages, the empty state renders before the "Load older workouts" button, so "No skipped workouts" shows even though older skipped sessions exist (`client/src/pages/timeline/TimelineContent.tsx:112`).
- **CL72** The missed-recovery Undo button has no pending guard, so a double tap sends two reopens and an error toast appears beside the success toast, leaving the athlete unsure whether the undo worked (`client/src/pages/timeline/useMissedRecoveryFlow.ts:22`).

---

## Performance — B+

**Assessment.** Most of the server's performance engineering is deliberate and bounded: every mutable server cache except `userSeenCache` (PF9) is size-capped (RAG 2000-entry LRU, embeddings 256, training context 500, analytics 500, exercise-name normalisation 1000), the chat tools refine date ranges to 92 days and the weekly zero-fill stops at 1040, the workout reparse fan-out runs through `pLimit(3)`, and an atomic `markRecomputedOn` claim limits nightly analytics regeneration to once per feature per day. The residual risk is concentrated in one place: the nutrition `/block` and `/summary-range` endpoints take any four-digit-year date span, and with `to=9999-12-31` a string-compared `dateRange` keeps going past year 9999, so one request from a signed-in user can block an instance's event loop for over a minute and exhaust its heap (PF1). Several findings come from caps applied call site by call site instead of through a shared helper: the same unbounded query schema lets the Timeline fetch multi-year fuelling ranges (PF7), batch reparse selects candidates with no LIMIT (PF2), the coaching list returns full material text with no count cap (PF4), and the embedding backfill never moves past an unordered 5000-row prefix (PF12). A second group is AI work that escapes metering or cancellation: the reparse paths never record usage (PF2), queued plan chunks keep running after the generation has failed (PF15), plan-proposal apply parses serially where its sibling uses `pLimit(3)` (PF14), and the staleness anchor counts walks and so queues regenerations whose inputs did not change (PF10). Third, the push-managed schema lags the queries: `pg_trgm` and its GIN indexes exist only in migration SQL that production never runs (PF3), and several lookup and cascade columns have no index (PF16, PF17, PF18), the last of which postdates the previous analysis's "no unindexed scan found". A smaller client-side cluster is eager-chunk weight that `bundle-check.ts` does not guard: unused fonts precached, and the markdown stack and every lucide icon loaded on first paint (PF6, PF8, PF19). Most low findings are held in check by per-user rate limits, default-off flags or current scale, so the grade reflects PF1's blast radius rather than the number of findings.

| # | Finding | Severity | Verdict |
|---|---|---|---|
| PF1 | `blockViewQuerySchema` checks `from`/`to` only for YYYY-MM-DD format, with no year bound, span cap or `from <= to` check, and the zero-fill and training-load loops behind `/api/v1/nutrition/block` and `/summary-range` run synchronously on the event loop. Because `addDaysToISODate` does not zero-pad the year and `dateRange` stops on a string comparison, `to=9999-12-31` keeps looping past year 10000 (one verifier measured about 65 s of blocked event loop and 5.7 GB RSS, the other a fatal heap OOM after about 100 s), so a single request from any self-serve signed-in user can stall or crash an instance. Even `from=0001-01-01` alone builds about 740k points and about 101 MB of JSON (`shared/schema/nutrition.ts:304`; amplifier `server/services/trainingLoad/utils.ts:56`). | High | Confirmed — 2/2 verifiers, both reproduced; reported independently by 2 reviewers. Both verifiers found the year-rollover runaway, which the reports missed. It needs no workout log and no wide span (`from=to=9999-12-31` is enough), so a span cap alone will not fix it. The report's literal `from=0000-01-01` example fails fast because Postgres rejects year 0; `0001-01-01` reproduces it. |
| PF2 | The workout, plan-day and batch reparse paths call the text parser without `userId`, so `trackTextUsage` returns early and none of their AI calls reach `ai_usage_logs`. The route-level budget check therefore never sees this spend, and neither the per-user nor the global cap can trip. Batch reparse selects every text-only workout with no LIMIT and re-sends the ones whose parse yields nothing on every run, so an athlete with hundreds of imported free-text sessions gets unmetered fast-model calls on each press (`server/services/workoutService/reparse.ts:147`, `server/services/workoutService/setRows.ts:263`). | Medium | Confirmed — reported independently by 3 reviewers; the image-parse path, by contrast, passes `userId`. |
| PF3 | `pg_trgm` and the two trigram GIN indexes from migration 0074 exist only in migration SQL, which push-managed environments never run: boot creates only the `vector` extension and `tables.ts` leaves the indexes undeclared. With fuzzy search on by default, every local food search on a push-built database (including the meal parser's local lookup) returns 500 because `similarity()` does not exist. If an operator creates the indexes by hand, the next `drizzle-kit push` silently drops them and the `%` predicate falls back to sequential scans of the shared foods cache (`server/storage/nutritionFoods.ts:72`; indexes undeclared at `shared/schema/tables.ts:1816`). | Medium | Partially confirmed — the verifier could not tell whether today's production database has `pg_trgm`. The outage is therefore a hazard for any push-built environment (new environment, rebuild, fresh staging), not a demonstrated one. The `tables.ts` comment saying `gin_trgm_ops` cannot be declared is wrong, because Drizzle supports `.op()`. |

**Low-severity findings.**

- **PF4** The Settings Training tab downloads every coaching material's full `content` (up to 1.5M characters each, with no count cap) only to show its length, so an athlete with 20 long PDFs parses about 30 MB on the main thread each time the tab remounts after the 5-minute staleTime (`client/src/components/settings/coaching/CoachingMaterialList.tsx:50`).
- **PF5** Drag-reordering exercises sends one debounced PATCH per moved set, so the list snaps back to the old order for about 350 ms, and a 40-set drag can exhaust the per-category set-write rate limit shared with structure edits and set reads; a partial 429 interleaves rows and splits an exercise group, and the split survives a refetch because the failed rows were never saved (`client/src/components/workout-detail/exercise-table/state.ts:11`).
- **PF6** `main.tsx` imports four Open Sans weights that no font stack uses, and the Workbox glob precaches every emitted font file in every unicode subset plus the woff fallbacks, so each new service-worker install downloads 118 font files (1.48 MB, 886 KB of it Open Sans), and about 64 KB of base64 fonts is inlined into the render-blocking entry CSS (`client/src/main.tsx:1`).
- **PF7** The Timeline's fuelling-range query runs from the oldest visible row to the newest, including annotation-only rows from any year, so with show-all or "Load older" every change at either end refetches years of food entries plus a training-load computation for a few visible chips (`client/src/pages/Timeline.tsx:205`).
- **PF8** The Timeline home chunk statically imports CoachPanel, and through it react-markdown, remark-gfm and rehype-sanitize, so every athlete downloads and parses the markdown stack on a cold start even though the coach panel starts closed (`client/src/pages/timeline/TimelineCoachPanels.tsx:2`).
- **PF9** `userSeenCache` keeps a last-seen time for every authenticated user and never deletes expired entries, unlike every other server cache, so a long-lived instance grows by about 100-150 bytes per distinct user; frequent deploys hide this today (`server/clerkAuth.ts:116`).
- **PF10** The workout staleness anchor counts non-training imports such as walks and yoga, so after a walk-only day `race_prediction` and `overview_analysis` read as stale and are regenerated overnight with unchanged inputs, at most about two extra AI calls a day per affected athlete; `coach_insights` is correctly included, because walks feed its load governor (`server/services/analyticsPersistence.ts:39`).
- **PF11** Opening a USDA Branded food that has no portions calls the USDA detail API again on every open (and `enrichUsdaMicros` can call the same URL a second time), which uses up the shared 1000/hour key and adds latency, and two concurrent first opens of a food with portions insert duplicate shared serving rows because `food_servings` has no unique key (`server/services/nutrition/foodDetail.ts:33`).
- **PF12** The food-embedding backfill scans an unordered 5000-row prefix of `foods` with no cursor and no missing-embedding filter, so once that prefix is embedded, foods cached later are rarely or never embedded and semantic typo/synonym recovery misses them; the feature sits behind `NUTRITION_SEMANTIC_ENABLED`, which defaults to off (`server/services/nutrition/foodEmbeddings.ts:146`).
- **PF13** A stale food whose upstream refetch returns nothing or throws is never re-stamped, so every search or barcode response that serves it fires another Edamam or Open Food Facts call with no backoff or in-flight dedupe, which burns paid quota and pushes the shared OFF rate limit toward 429s (`server/services/nutrition/refresh.ts:67`).
- **PF14** Applying a plan proposal re-parses each changed structured day with one sequential AI call (up to 14), where the equivalent reparse fan-out uses `pLimit(3)`, so a large all-structured proposal or a slow provider can exceed the client's 90 s timeout and show "Request timed out" while the server finishes the apply (`server/services/planAdjustmentService.ts:676`).
- **PF15** When one plan-generation chunk fails, `Promise.all` rejects but `p-limit` keeps starting the queued chunks with no abort, so a failed 24-week generation can still run about nine more reasoning calls billed to the athlete's AI budget, overlapping any immediate retry (`server/services/planGenerationService.ts:778`).
- **PF16** The hourly email cron reruns the missed-plan-day sweep for every distinct timezone, one sequential UPDATE per zone that scans the unindexed `users.user_timezone`, even though each zone's date changes once a day; the cost grows as users × zones × 24 and delays email enqueueing inside the cron lock as the user base grows, though it is modest today (`server/storage/plans.ts:851`).
- **PF17** The Strava webhook resolves each event's owner with `WHERE strava_athlete_id = $1` on a column with no index, so every delivery sequentially scans `strava_connections`, a cost that grows linearly with connected athletes but is a few milliseconds today (`server/storage/users.ts:661`).
- **PF18** `chat_messages.proposal_id`, `plan_adjustment_proposals.plan_id` and `plan_day_moves.plan_day_id` are FK columns with ON DELETE actions but no index, so deleting a plan or erasing an account runs one sequential scan of the ever-growing `chat_messages` table per deleted proposal, which can hit the 30 s statement timeout once the table reaches millions of rows (`shared/schema/tables.ts:1467`).
- **PF19** The `vendor-ui` code-splitting group puts every lucide-react icon used anywhere into a chunk the eager shell imports, so first paint, including the signed-out Landing page, loads over 100 icons that only lazy routes use (roughly 40-60 KB minified), and `bundle-check.ts` does not guard against it (`vite.config.ts:171`).

---

## UX & accessibility — B+

**Assessment.** The groundwork is sound. Every overlay except the mobile coach panel is built on Radix Dialog or Sheet, the semantic `--warning` and `--success` tokens are tuned to 5.1:1 and 5.7:1 on white, the icon Button primitive gives a 44px touch target on mobile, the Timeline drag list speaks its own announcements, `/log` keeps a localStorage draft, and Settings guards unsaved changes and confirms its irreversible actions. No finding is high, and verification moved only one severity (U35, from medium to low). The residual risk sits on the two surfaces athletes use most. On the timeline home screen, keyboard and screen-reader use of the workout card and the mobile coach breaks down (U1, U4, U20), and a failed fetch looks like a brand-new account (U5). On the logging surfaces, entered work can be thrown away or garbled (U2, U3, U27). Four patterns tie the findings together. First, a fix or guard lands at one site and misses its siblings: `workerSrc` lists `blob:` but `img-src` does not, and the onboarding radio-group labels, the Timeline drag announcements, the S9 touch target, the MoveEntryMenu date clamp and the Race Predictor consent copy each stop short of a sibling (U6, U17, U24, U26, U19, U29). Second, failure looks like empty data or generic copy: failed queries render as a welcome screen or a 0 kcal day, and server rejections appear as 'Failed to read', raw JSON or 'Please try again' (U5, U31, U16, U28, U29, U35). Third, the timeline card is a `role=button` that holds other controls, and its a11y test passes only because the fixture renders none of them (U1, U20, U22, U34). Fourth, lossy actions have no guard or undo: dismissing the quick-log sheet, 'Duplicate last', 'Delete forever' and Escape in the title editor all throw work away without asking (U2, U30, U15, U23).

| # | Finding | Severity | Verdict |
|---|---|---|---|
| U1 | The workout card's Enter/Space handler calls `preventDefault` and opens the card for any keydown that bubbles up from a child. The 'Mark X as complete' button, the dnd-kit drag handle and the move-menu trigger do not stop propagation. A keyboard user who presses Enter on 'Mark complete' gets the log sheet, and the session is not completed. Space on the drag handle opens a modal sheet that takes focus, so the arrow-key reschedule cannot be finished (`client/src/components/timeline/timeline-workout-card/TimelineWorkoutCard.tsx:133`). | Medium | **Confirmed** — reproduced with a scratch vitest against the real component: Enter or Space on each of the three controls opened the card, `onMarkComplete` never ran, and every keydown came back default-prevented. Reported independently by 2 reviewers. The card's a11y test renders a fixture without `planDayId` or `onMove`, so none of these controls appear in it. |
| U2 | The quick 'Log Workout' sheet clears every field on any close: an 80px swipe down on the header, an outside tap or Escape. There is no dirty check. 'Open full editor (voice, draft saving)' goes to `/log` without passing on what was entered. An athlete who enters six exercises between sets and catches the sheet header loses them all, and the full editor opens empty (`client/src/components/workout-detail/AdhocLogSheet.tsx:251`). | Medium | **Confirmed** — the component comment says draft persistence was skipped on purpose, but nothing documents the missing discard guard or the lossy hand-off to `/log`. The same gap is reported in RecipeBuilderDialog and CustomFoodDialog, which the verifier did not check. |
| U3 | LogSheet and ReviewSurface send the structure builder's onChange straight to a full-structure save, with no debounce. Every server echo or rollback rebuilds the drafts with a fresh `crypto.randomUUID()` for each step, so the step rows remount and the focused input loses focus partway through a number. Typing '45' into a step's Time can lose the '5' (`client/src/components/workout-structure/StructureBlocksEditor.tsx:160`). | Medium | **Partially confirmed** — the per-keystroke save and the remount hold. With default production settings the plan-day save returns 403 (EMOM_BUILDER_ENABLED is off) and the workout PATCH fails with 'No values to set', so each keystroke there brings an error toast and a rollback, which also remounts the rows. The claimed primary-key collision between overlapping saves can happen only on the flag-gated plan-day route. |
| U4 | On phones the AI Coach opens in a plain `fixed inset-0` div. It has no dialog role or `aria-modal`, does not move or trap focus, and ignores Escape. The FAB that had focus gets `max-md:hidden`, so focus drops to body. A VoiceOver user swipes through the hidden timeline cards behind the panel and is never told the coach opened. A keyboard user tabs onto controls the overlay covers (`client/src/pages/timeline/TimelineCoachPanels.tsx:48`). | Medium | **Confirmed** — reached from the Timeline FAB on any viewport under 768px. No component under the coach panel calls focus, sets a role or handles Escape. |
| U5 | Failed queries show up as empty or first-run states. `useTimelineData` defaults plans to `[]` and never reads `isError`, so when the timeline fetch fails a returning athlete sees 'Welcome to fitai.coach' with 'Generate AI Plan' and 'Use 8-Week Template'. Nutrition shows a 0 kcal day and the analytics tabs show 'No workout data yet'. Tapping the template can create a duplicate plan, and an athlete may re-log meals already recorded. Only 11 of the 39 modules that consume queries check `isError` (`client/src/pages/timeline/TimelineContent.tsx:112`). | Medium | **Confirmed** — the verifier narrowed the trigger. TanStack pauses rather than fails queries when the browser reports offline, which gives the same empty render plus the 'You're offline' pill. The clearest trigger is a backend 5xx, or a server that cannot be reached while the browser reports online, and then there is no indication at all. A failed auth query can also auto-launch onboarding for a returning user on a device without the local completion flag. |
| U6 | The CSP `img-src` (prod and dev) omits `blob:`, and browsers do not match `blob:` against `'self'`. Every preview built with `URL.createObjectURL` is therefore blocked: chat-attachment and workout-scan thumbnails render as broken images, and the athlete confirms a photo they cannot see (`server/middleware/csp.ts:41`). | Medium | **Confirmed** — reported independently by 2 reviewers. The upload and the AI parse still work and only the preview breaks, but it breaks on every photo attach and scan. `workerSrc` already lists `blob:`, and `csp.test.ts` never asserts `img-src`. |

**Low-severity findings.**

- **U7** The weekly Avg RPE, duration and mileage tooltips always read `payload.date`, but these charts are keyed on `weekStart`, so tapping a point shows a value with no week, on charts that can span all time with tick labels that omit the year (`client/src/components/analytics/MultiLineChart.tsx:44`).
- **U8** Race Predictor's 'Set it in Settings' and 'Enable AI Coach' links go to bare `/settings`, which opens the Account tab instead of Training, where the race profile and AI Coach toggle live; other copy names a 'Health Metrics' section that does not exist and a 'Data Tools section above' that is on another tab, so some athletes will conclude the feature is unavailable (`client/src/components/analytics/RacePredictorTab.tsx:316`).
- **U9** The running-distance delta tooltip and aria text use the unrounded `metersToUserDistance` value with no space before the unit, so a miles user reads 'Previous period: 3.1068559611866697miles' (`client/src/components/analytics/training-overview/OverviewStatsGrid.tsx:77`).
- **U10** Below 768px the sidebar is a modal Sheet with a hidden close button, and nothing calls `setOpenMobile(false)` on navigation, so after a tap on 'Analytics' the drawer keeps covering the new page and trapping focus until the backdrop is tapped (`client/src/components/AppSidebar.tsx:56`).
- **U11** The chat textarea is `disabled` for the whole reply, so focus drops to body, the phone keyboard closes after every send, the next message cannot be drafted, and nothing restores focus when the stream ends, even though `cannotSend` already blocks a second send (`client/src/components/ChatInput.tsx:189`).
- **U12** The chat input sends on any Enter without checking `isComposing`, so the Enter that confirms a CJK IME candidate sends a half-composed message to the coach and spends an AI call; reported independently by 2 reviewers (`client/src/components/ChatInput.tsx:152`).
- **U13** The inline set grid needs at least 340px for exercises with four per-set fields (custom exercises and walking lunges, a Hyrox station) but gets about 260-290px inside the mobile sheet, so the note and remove buttons sit off screen and the sheet scrolls sideways; three-field rows also overflow at 360px and 375px, contrary to the code comment (`client/src/components/exercise-row/InlineSetEditor.tsx:81`).
- **U14** The AI-plan 'Days/Week' field snaps back to 5 when cleared and turns '53' into 7 when a digit is typed next to the existing one, resetting the rest days each time, so on a phone only select-all-and-replace works (`client/src/components/plans/generate-plan/GeneratePlanScheduleStep.tsx:96`).
- **U15** The athlete-card 'Delete forever' button, next to 'Restore', permanently deletes a retired fact with one tap, with no confirmation or undo, unlike every other irreversible action in Settings; the harm is limited because the coach no longer reads retired facts (`client/src/components/settings/athlete-card/RetiredFactList.tsx:63`).
- **U16** Batch coaching-material upload reports every per-file failure, including 429 rate limits, AI consent being off and 413s, as 'Failed to read: …', so an athlete uploading 12 PDFs is told that readable files are unreadable, and the existing test pins that wording (`client/src/components/settings/coaching/useCoachingUpload.ts:165`).
- **U17** The three radio groups in the Combine Workouts dialog have no accessible name and identical options, so a screen-reader user hears 'Workout 1, radio button, 1 of 4' for Focus, Main Workout and Notes alike and can merge the wrong source's text; the onboarding fix for the same pattern (ONBOARDING_AUDIT M4) never reached this dialog (`client/src/components/timeline/combine-workouts-dialog/FieldSelector.tsx:21`).
- **U18** The AI Coach FAB declares `aria-controls="coach-panel"` but no element has that id, so screen readers get no route to the open panel, and axe reports aria-valid-attr-value once it is open (`client/src/components/timeline/FloatingActionButton.tsx:35`).
- **U19** The 'Mark complete' circle appears on every future planned card and drag-and-drop accepts any future date, but the server rejects workout dates more than 24h ahead, so ticking Saturday's run on Wednesday vibrates, flips the card and then reverts with 'Failed to log workout'; `MoveEntryMenu` already clamps to tomorrow for exactly this reason (`client/src/components/timeline/timeline-workout-card/TimelineWorkoutCard.tsx:522`).
- **U20** The planned, movable card is a `role=button` that contains the complete button, drag handle, move menu and missed-recovery buttons (axe nested-interactive, serious), so screen readers can drop the recovery actions from swipe navigation; a test comment admits the a11y fixture renders none of them, which is why the test passes (`client/src/components/timeline/timeline-workout-card/TimelineWorkoutCard.tsx:382`).
- **U21** The Skipped, Pending sync and RAG badges, the 10px parse-confidence percentage and the over-target calorie number use raw Tailwind palette colours at about 1.9:1 to 3.5:1 contrast in light mode instead of the tuned tokens, so they are hard to read and the low-confidence signal on AI-parsed exercises is nearly invisible; the verifier recomputed the ratios (`client/src/components/timeline/timeline-workout-card/utils.tsx:121`).
- **U22** The welcome card's 'Import Your Own' is a `span` inside a label for a `display:none` input, so keyboard-only new users cannot reach it and its disabled state does nothing during a pending import, and 'Or just log a workout' nests a button inside a link; reported independently by 2 reviewers (`client/src/components/timeline/TimelineEmptyState.tsx:101`).
- **U23** Escape in the inline title editor closes the whole Log or Review sheet instead of cancelling the edit, because Radix's document-level capture listener dismisses the dialog before the input's handler runs; partially confirmed: the handler is at line 66, not 144, and the claimed loss of an uncommitted cell draft on Escape was judged weak as a separate defect (`client/src/components/workout-detail/EditableWorkoutTitle.tsx:66`).
- **U24** The exercise table keeps dnd-kit's default announcements, so a VoiceOver user who reorders exercises with the keyboard hears 'Picked up draggable item 3f2a9c1e-…' instead of the exercise name; Timeline overrides these after an earlier review, but the table was never fixed; reported independently by 2 reviewers (`client/src/components/workout-detail/ExerciseTable.tsx:259`).
- **U25** The migration review callout stays up after Accept (reading 'Migration review: resolved' with the same three buttons on every later open), prints raw status and reason codes, hides resolve failures and can show the previous workout's flag; review rows exist only after a backfill endpoint that no client code calls, so most athletes never see it (`client/src/components/workout-detail/ReviewSurface.tsx:807`).
- **U26** Twenty-three icon buttons override the 44px mobile touch target from S9 (CODEBASE_REVIEW_2026-05-31) with unprefixed 28-32px size classes, among them 'Remove' 2px from 'Move later' in the structure editor and 'Remove portion' in Log food, so a thumb slip removes a step or deletes a saved serving; the verifier notes that a removed step is only local editor state, which can be discarded (`client/src/components/workout-structure/WorkoutStructureEditor.tsx:516`).
- **U27** Tapping a set's X just after editing it blurs the cell, which queues the 350ms debounced PATCH, and then deletes the set, so the PATCH hits a deleted row and the athlete sees 'Couldn't save that change' (or 'This set was updated elsewhere') and a 'Couldn't save' pill when nothing failed; partially confirmed: group delete goes through a confirm dialog that outlasts the debounce window, so it has no race (`client/src/hooks/useExerciseSetsForOwner.ts:193`).
- **U28** The Garmin connect and sync toasts and the coaching-material error toasts print `error.message` directly, bypassing `humanizeApiError`, so a wrong Garmin password shows `401: {"error":"Garmin rejected your email or password...","code":"GARMIN_AUTH_FAILED"}`; the tests mock a plain Error and pass; reported independently by 3 reviewers (`client/src/hooks/useGarminMutations.ts:23`).
- **U29** 'Generate insights' on Coach Insights, the Overview and Nutrition Insights is enabled when AI consent is off (the default for new users), and `describeAiError` has no branch for the 403 AI_COACH_DISABLED response, so the athlete is told to 'Please try again', which cannot work; Race Predictor already shows consent-off copy with an Enable AI Coach link; reported independently by 2 reviewers (`client/src/lib/describeAiError.ts:18`).
- **U30** 'Duplicate last' on `/log` replaces the restored in-progress draft's exercises, title and notes with no check and no undo, and draft persistence then overwrites the saved localStorage draft, so the earlier entry cannot be recovered (`client/src/pages/log-workout/useDuplicateLastWorkout.ts:52`).
- **U31** When the Nutrition day-summary fetch fails, the page shows 0/0/0/0 and the 'Set daily targets' prompt with no error or retry, so an athlete who has logged 1,900 kcal against set targets sees an empty day; the verifier called the duplicate re-logging consequence speculative (`client/src/pages/Nutrition.tsx:171`).
- **U32** Live barcode scanning stops after the first detection, so after 'Barcode not recognized' the camera keeps running but scans nothing until the dialog is reopened, the stale error carries into the next open, and after an earlier camera error a later open can leave a stream running with no video shown (`client/src/pages/nutrition/BarcodeScanner.tsx:84`).
- **U33** The meal target dialog prefills all four fields from the viewed day's load-scaled target and sends every one, so raising dinner protein alone pins that day's carbs and fat as a permanent override from today and stops per-meal periodisation for that meal; the copy's 'Leave a field blank' works only if the athlete clears each field by hand (`client/src/pages/nutrition/MealTargetDialog.tsx:37`).
- **U34** Snap-meal and scan-label reuse a focusable hidden input labelled 'Capture workout image', every parsed-meal row is labelled just 'Quantity in grams' and 'Meal', and Privacy nests a button in a link, so a VoiceOver user reviewing a four-item meal hears 'Quantity in grams, 150' four times with no food name (`client/src/pages/nutrition/SnapMealButton.tsx:32`).
- **U35** Settings sends out-of-range values (for example resting HR 25, or a weekly rate of 5 lbs) to a schema that rejects the whole PATCH, and the single Save bar shared by every tab shows only 'Failed to save settings. Please try again.', so every later save fails with nothing pointing to the bad field; calibrated down from medium because it needs out-of-range input and blocks the save without corrupting data (`client/src/pages/settings/usePreferencesForm.tsx:149`).
- **U36** The annotation card's 'Edit' pencil opens the create-only annotations dialog, still holding its previous values, so an athlete trying to extend an injury annotation creates a second, overlapping one and the original stays unchanged (`client/src/pages/timeline/useTimelineDialogState.ts:14`).
- **U37** The MAF baseline-test reminder is due exactly seven days after the athlete saves the MAF setting and goes out on the next hourly tick with no timezone or notify-hour check, so the email and push can arrive in the middle of the night (`server/emailScheduler.ts:635`).

---

## Architecture, testing, tooling & docs — A-

**Assessment.** Nothing in this dimension rose above low after verification, and no finding corrupts or exposes athlete data; the athlete-visible effects are small (style advice that stays stale after a switch, a combine feature with no way in, MAF test dates labelled a day late). The structural guards are in place at HEAD: `aiLayerDependencyDirection.test.ts`, `errorCodeCatalogue.test.ts`, `trackedPathCaseCollisions.test.ts`, `protectedRouteBuilderCompliance.test.ts` and `test/docs/docsSync.test.ts` all exist, `server/` carries 16 real-Postgres integration suites, and the verifiers found every install path pinned with `--frozen-lockfile` (A8), the M26 monotony fix pinned by tests (A12) and the plan-day owner filter asserted at the storage layer (A14). The residual risk is in maintainability and in what CI can see, not in current runtime behaviour. Three patterns tie the findings together. First, replaced code stays wired in: barrel exports with no importers, a combine flow nothing can enter, an uncalled `createWorkout` sharing its name with the live use case, a flag written but never read, and a dead dependency override (A1, A2, A3, A8, A13). Second, docs and comments have drifted from the code: two cases invite a harmful fix or the wrong operational plan (A5, A12), and others overstate what is done or what the system does (A1, A6, A7, A15). Third, several test lanes exercise a stand-in rather than the production path: a test-only error handler, a `MemoryStore` selected by `NODE_ENV`, a suite pinned to UTC, a bundle check that runs after the sourcemaps are deleted, an e2e cron test that never sends the header, and a create path reached only through mocks (A4, A9, A10, A11, A14, A16). The grade reflects the absence of any medium finding and the strength of the existing guards; the patterns matter because each lets a future regression pass CI.

No high, critical or medium finding survived verification in this dimension. A14 was reported as medium and calibrated down to low (see below).

**Low-severity findings.**

- **A1** A training-style change sends `trainingStyleRecomputeNow=true` and the Settings audit shows the athlete "Training-style recompute flag set for downstream AI calculations", but no server code reads the column, so after a switch from Balanced to MAF the stored Coach Insights and Overview analysis keep showing Balanced-style advice until the midnight cron or a manual Regenerate, and `docs/new-training-style-checklist.md:53` tells developers the flag forces a fresh recompute (`client/src/components/settings/TrainingStyleSection.tsx:51`).
- **A2** `EditWorkoutDialog` (209 lines) and `SuggestionsPanel` (113 lines) are re-exported from the timeline barrel but have no production or test importer, so a fix made in either never reaches athletes, and `docs/client.md` still lists `SuggestionsPanel` as a top-level component (`client/src/components/timeline/index.ts:7`).
- **A3** Combine mode can never be entered, because `handleCombine` is the only code that sets `combiningEntry` and it is reachable only when `isCombining` is already true, so athletes cannot merge a duplicate manual log with a Strava import from the timeline even though the dialog, mutation, server route and unit tests exist, and the combine props threaded through five components are dead (`client/src/hooks/useCombineWorkouts.ts:52`).
- **A4** The Cypress "wrong cron secret" test sends `?secret=wrong-secret` as a query string, which the route ignores because it reads only the `x-cron-secret` header, and CI sets no `CRON_SECRET`, so both e2e cron tests return 401 from the early return and a regression in the timing-safe comparison would still pass e2e; only `server/routes/__tests__/email.test.ts:55` covers that path (`cypress/e2e/api-validation.cy.ts:71`).
- **A5** The "Adding Indexes on Large Tables" section says boot-time `runDrizzleMigrations()` applies new indexes at deploy, while `docs/operations/backup-restore.md` and `server/maintenance.ts` say production schema arrives only through a hand-run `drizzle-kit push`, so an operator following it expects the deploy to apply the index, and if they skip the out-of-band `CREATE INDEX CONCURRENTLY` step the push builds it non-concurrently and blocks writes (`docs/database.md:1538`).
- **A6** The audit's remediation header says all 7 Medium findings are fixed, but the same section keeps the Garmin reversible-password Medium unchanged and only partly addresses AI cost (no atomic reservation, and the global cap is off unless `AI_GLOBAL_DAILY_LIMIT_CENTS` is set), so an owner reading the header that `README.md:149` points to concludes no Medium security risk remains (`docs/SECURITY_AUDIT_2026-09-19.md:11`).
- **A7** `server.md`'s body-size list still says "All other routes: 100 KB JSON" although `server/index.ts:236` mounts a 5 MB JSON parser ahead of auth for the chat send routes, a 50x larger pre-auth parse allowance than documented; partially confirmed, because the matched paths are `/api/v1/chat` and `/api/v1/chat/stream` (not `/chat/message`), and the doc already lists a larger 10 MB pre-auth parser for image parse while `api-reference.md` records the 5 MB allowance (`docs/server.md:168`).
- **A8** The `uuid` override targets a package no longer in the lockfile (its own documented removal condition is met), and the open-ended `>=` overrides on `qs`, `hono`, `serialize-javascript` and `browserslist` break the repo's own capping policy for protobufjs and tmp, so a lockfile regeneration after `qs` ships 7.x would force it into express 5's query parsing in production; partially confirmed, because every install path uses `--frozen-lockfile` (the change would arrive as a reviewable lockfile diff), only `qs` reaches runtime code, and the dependency-placement items have no concrete consequence (`package.json:583`).
- **A9** `script/build.ts` deletes every `.map` file before running the bundle check and CI runs `pnpm check:bundle` after the build, so the sourcemap path in `shipsDrizzle` never runs and only a `drizzle:` substring fallback does, which would miss a future client module that pulls in `zod-to-openapi` without drizzle (today its only importer, `shared/openapi.ts`, also brings drizzle in and would still trip the fallback) (`script/bundle-check.ts:30`).
- **A10** The test-only `setupTestErrorHandler` (76 uses across about 28 server test files) ignores `statusCode`, returns "Internal Server Error" for 4xx and has no 413 rewrite, while the untested production handler inline at `server/index.ts:419` passes 4xx messages through, so a regression that masked every 400 and 409 message the client shows (validation copy, the food-in-use delete message, Strava reauth copy) would pass every route test (`server/routes/__tests__/testUtils.ts:55`).
- **A11** `createRateLimitStore` returns a `MemoryStore` whenever `NODE_ENV=test`, which the integration, smoke and Cypress lanes all use, and the unit test only echoes a mocked row, so the Postgres upsert, window-reset and decrement SQL behind the fail-closed limiter on every mutating route first runs in production, where a broken reset would make every POST, PATCH and DELETE return 429 after the first window with all lanes green (`server/routeUtils.ts:41`).
- **A12** The comment at `loadDynamics.ts:62-71` still calls monotony's population SD "UNRESOLVED (audit M26)" and `types.ts:122` says population SD, while the code has used sample SD since the 2026-08-23 fix, so a maintainer who "resolves" the note would raise every athlete's monotony by about 8% and flag a true 1.85 as a high-risk 2.00, which the M26 tests catch only if they are not edited alongside (`server/services/trainingLoad/loadDynamics.ts:62`).
- **A13** The `workoutService` barrel still exports a `createWorkout` with no callers (not even tests) that skips auto-coach scheduling and PR detection, so a new write path importing it from the same barrel as `createWorkoutAndScheduleCoaching` would type-check and save workouts without coaching, and `autoHydrateExerciseSetsFromTextIfNeeded`, `saveParsedWorkout` and the `useWorkoutVoiceForm` hook are also dead; partially confirmed, because `workoutService/parsing.ts` is still imported by `assistedMigrationService.ts` and the custom-exercises and AI-suggestions debug routes are documented API, not dead code (`server/services/workoutService/workouts.ts:215`).
- **A14** Create-path plan linking (`resolveActivePlanLinks` / `applyResolvedPlanLinks`) is the only check before the prescription copy, which reads by `planDayId` alone, yet `workouts.ts` lines 54-383 run in no test lane (16.8% line coverage, reproduced; route tests mock `workoutUseCases` and integration posts only plan-less workouts), so a refactor that fell back to the client's `planDayId` would let `POST /api/v1/workouts` copy another athlete's prescribed sets into the caller's log with every test green; reported as medium and calibrated down because no defect exists today and dropping `getPlanDay`'s owner filter would fail `server/storage/__tests__/plans.test.ts` (`server/services/workoutService/workouts.ts:50`).
- **A15** `TECHNICAL_DEBT.md` describes itself as a living catalogue and reports 28 of 29 items resolved, but carries none of the open items later audits verified (REFACTORING_REVIEW R1-R6 and D1-D11, calculation-audit M11, H20 and L5), so an owner planning from it misses traps such as R1, where a new email kind copying `sendPushToUser` without `.catch` reintroduces the C1 process crash; partially confirmed, because the count is accurate for the file's own entries and `docs/README.md` indexes the refactoring review's deferred list (`TECHNICAL_DEBT.md:92`).
- **A16** `vitest.setup.ts` pins `TZ=UTC` and client fixtures are UTC instants, so a regression of `getTodayString` to `toISOString().slice(0,10)` would pass CI while moving a Los Angeles athlete's today row, "Jump to today" target and completion stats to tomorrow after 5 pm (re-running under Pacific/Auckland gave 14 fixture failures in 3 files), and the suite pins as expected `mafTrend.helpers.ts:35`, which labels a US-evening MAF test with the next day's UTC date (`vitest.setup.ts:8`).

---

## Subsystem notes

Eighteen mappers each read one slice of the tree end to end: ten on the server, one on `shared/`, six on the client and one on tooling. Each note says what the subsystem does and how it is built, names its genuine strengths, and lists the report IDs of its high and medium findings. Lows are in the findings index.

How to read the numbers:

- **Health scores** are each mapper's own, given at discovery time before skeptic verification.
- **"LOC read"** is the figure the mapper disclosed. It includes out-of-scope code followed to confirm a finding, so it is not the size of the scope.
- **Finding counts** list a merged finding under every subsystem that raised it. The counts therefore add up to more than the 315 kept findings.
- **Comparison with 2026-08-31:** that analysis used 11 mappers, not 18, and cut the scopes differently. Its scores do not compare one-to-one with these.

| Subsystem | Health | Files / LOC read | High | Medium | Low |
|---|---|---|---|---|---|
| Server: AI providers & coach chat | 6 | 52 / ~10.4k | 2 | 7 | 6 |
| Server: AI coaching services | 6 | 42 / ~10.4k | 0 | 8 | 6 |
| Server: plan generation, workout engine & recovery | 6 | 44 / ~12.1k | 0 | 7 | 7 |
| Server: workouts & device integrations | 6 | 49 / ~11.7k | 1 | 8 | 6 |
| Server: analytics, training load, race prediction & grades | 6 | 44 / ~10.2k | 1 | 8 | 5 |
| Server: nutrition | 6 | 57 / ~9.2k | 1 | 6 | 14 |
| Server: HTTP layer, auth & middleware | 7 | 38 / ~4.6k | 0 | 7 | 7 |
| Server: data layer (storage) | 7 | 20 / ~4.4k | 0 | 5 | 6 |
| Server: schema & migrations | 6 | 46 / ~8.2k | 0 | 2 | 7 |
| Server: jobs, email, erasure & crypto | 6 | 28 / ~6.9k | 1 | 5 | 7 |
| Shared domain logic | 7 | 29 / ~5.4k | 0 | 4 | 4 |
| Client: workout detail & set editing | 5 | 58 / ~11.6k | 2 | 7 | 7 |
| Client: timeline & weekly review | 7 | 115 / ~14.5k | 0 | 4 | 16 |
| Client: nutrition, log-workout & onboarding pages | 7 | 82 / ~12.4k | 0 | 7 | 13 |
| Client: analytics & settings | 7 | 120 / ~17.5k | 0 | 5 | 16 |
| Client: data hooks | 6 | 118 / ~12.4k | 0 | 6 | 10 |
| Client: app shell, API client & offline queue | 7 | 104 / ~10.9k | 0 | 7 | 8 |
| Tooling, CI, deploy & operator scripts | 6 | 76 / ~7.6k | 0 | 5 | 7 |

### Server: AI providers & coach chat — 6/10 (~10.4k LOC read)

This is the coach chat and the provider layer beneath it.

- **Routes and conversation.** `server/routes/ai.ts` takes turns behind consent, budget and zod guards. `loadConversation` rebuilds the server-owned thread from `chat_messages`. It splits sessions at a 12-hour gap and folds long ones into rolling notes and fast-model handover summaries. A legacy client path still sends its own `history`.
- **Context.** `prepareChatContext` assembles four inputs in parallel: the cached training context, RAG retrieval over the split vector DB, the focused workout, and a Gemini photo reading.
- **Modes.** Classic mode sends plan-edit intent through a keyword gate and a fast-model classifier into the proposal path. Tools mode (`AI_CHAT_TOOLS`) runs up to three rounds of userId-bound read tools.
- **Streaming.** The SSE layer registers an AbortController. Its deadline is the earlier of 5 minutes and the Clerk JWT expiry minus 5 s.
- **Providers.** `generateText`/`streamText` resolve provider, model role and effort. They record usage against a $2/24 h per-user cap and an optional global cap. Non-streaming calls go through `retryWithBackoff` (90 s per attempt, 120 s budget) and a process-local circuit breaker persisted to `server_runtime_cache`.

The design relies on two invariants: aborts propagate from the client socket to the provider, and every billed token reaches the budget. AI4, AI7 and AI10 each break one of them. The prompt section renderers were checked by grep for unsanitized interpolations, not read line by line.

**Strengths:**

- Prompt-injection hygiene is unusually thorough: athlete text is escaped and fenced as data, even in system-instruction positions.
- Chat tools take userId from the request, never from model arguments, and validate arguments with zod under a 92-day range cap.
- The streaming output validator catches restricted phrases split across chunks.

**Key findings:** S1, AI1 (high); S5, AI3, AI4, AI5, AI7, AI8, AI10 (medium).

### Server: AI coaching services — 6/10 (~10.4k LOC read)

The auto-coach is the centre of this subsystem. Five producers enqueue the pg-boss `auto-coach` job under one `auto-coach:<userId>` singleton key with a 60-second window: workout created, date changed, sets edited, plan day completed, and plan day rescheduled.

`triggerAutoCoach` runs in four steps:

1. **Context.** About ten parallel reads, anchored to the athlete's local today: a 400-entry timeline window, 70 days of load data, and the next seven planned days with race-day overrides applied.
2. **Deterministic stages.** Load-governor suggestions, then workout-engine plan adaptation.
3. **Budget-gated model stages.** Suggestions, a safety and repeat-fatigue filter, a structured parse per suggestion, and review notes for unchanged days.
4. **Apply.** One transaction updates plan days and deletes and re-inserts `exercise_sets` by plan day. `aiInputsUsed` holds both the "Based on" provenance and the repeat-guard state, and is rebuilt on every write.

The subsystem also serves:

- timeline suggestions and apply, and coach-note regeneration;
- coach insights and overview analysis, which the midnight recompute cron also runs;
- the weekly review and the chat welcome;
- coaching-material CRUD, with an embed job onto the vector DB;
- athlete facts.

Two invariants it relies on are not enforced:

- The upcoming slate is filtered to today-or-later when it is read, but not re-checked when it is written.
- The docs claim one pass per athlete at a time, but nothing guarantees it (AI16).

The training-context cache is per instance. A 5-minute TTL is the only cross-instance backstop.

**Strengths:**

- Suggestions, review notes and adaptation apply atomically.
- The deterministic stages still run when the AI budget is exhausted.
- Every storage query is userId-scoped, including vector-DB chunk deletes.
- Review-note routing drops hallucinated, modified and duplicate day ids.

**Key findings:** AI9, AI11, AI12, AI13, AI14, AI15, AI16, AI17 (medium).

### Server: plan generation, workout engine & recovery — 6/10 (~12.1k LOC read)

**Generation.** `POST /plans/generate` checks for an in-flight generation, backed by the partial unique index `uq_training_plans_user_in_flight`. It then creates a pending plan and enqueues a no-retry job. `executePlanGeneration` reads the athlete card, a 70-day calibration and a deterministic engine plan: blueprint, lift programs, run paces and volume, week skeleton, and station doses. It generates two-week chunks in parallel under `pLimit(3)`. It then:

- checks for exact 7×N coverage and enforces table-first days;
- repairs primary lifts;
- applies an overload clamp of 8% per week, aware of unit stamps and deloads.

It writes in three steps:

1. Insert the days and sets.
2. Run `schedulePlan`, which makes week 1 the Monday of the start week.
3. In a final transaction, retire the superseded plans and mark the new one ready.

**Other parts.** The subsystem also holds:

- the pure adaptation engine the auto-coach calls, which raises, holds or deloads lifts, rescales paces and rewrites lift text;
- missed-session recovery: a pure planner and shorten step, written through the row-locked `applyPlanDayRecovery`, with chained undo;
- chat-proposal apply, which revalidates per-day fingerprints and re-parses outside the transaction.

**Known weak points.** The design treats an exercise's name as its identity for loads, clamps and adaptation. That breaks for custom lifts, which all share one identity (D14). Also, `aiBudgetCheck` gates a generation once, although one generation makes up to 12 reasoning calls.

**Strengths:**

- The engine modules are pure and deterministic, with good DB-free tests.
- Recovery writes lock and re-check, so a racing log becomes a 409 rather than an overwrite.
- A failed generation leaves the old plan untouched, because the cut-over happens only in the final transaction.

**Key findings:** AI16, C14, C15, C19, D14, D15, D20 (medium).

### Server: workouts & device integrations — 6/10 (~11.7k LOC read)

**Scope.** This subsystem covers workout CRUD, combine, bulk delete, reparse, device link, MAF and export routes. It also covers the Strava OAuth, webhook and sync surface, manual Garmin sync, and the background `strava-sync` queue (debounced 60 s per user) and `session-streams` queue.

**Strava sync.** `syncStravaForUser` runs in four steps:

1. Take a token under a per-user advisory try-lock, with a re-read and a reauth tombstone.
2. List activities from the cursor minus 7 days, or a 90-day backfill of at most 5 pages.
3. Dedup against live and binned rows, and enrich up to 25 activities within a 30 s budget.
4. Pass the results to a pure matcher. It scores type, duration, time, distance and name, assigns greedily one-to-one, auto-links at 0.75 and suggests at 0.45. Each decision runs in its own transaction.

A plan-day link locks the day `FOR UPDATE` and builds the log through `createWorkoutInTx`. That copies the prescribed sets and marks the day completed. Unmatched activities are inserted standalone, with `onConflictDoNothing` and one synthesized set.

**Garmin sync.** It runs the breaker, a preflight, a per-user lock, then cached tokens or an SSO login. It inserts the latest 20 activities with no reconciler, no synthesized set and no cross-provider dedup (D16).

**Gaps.** Recycle-bin capture covers single and bulk delete but not combine, unlink or link. `autoHydrateExerciseSetsFromTextIfNeeded` is exported but has no production caller.

**Strengths:**

- Strava token refresh is serialized across instances.
- Import dedup is layered: a pre-read, then partial unique indexes, then counts taken from the rows actually returned.
- The Garmin safety stack is careful: word-bounded 429/401 checks, a persisted cross-instance breaker, a shared per-user lock, and a wall-clock timeout.

**Key findings:** S3 (high); C9, D6, D11, D12, D16, D17, D21, PF2 (medium).

### Server: analytics, training load, race prediction & session grades — 6/10 (~10.2k LOC read)

The analytics routes are read-only and scope every read by `getUserId`. They cover PRs, exercise analytics, training overview and summary, race prediction, the weekly review, and session grades.

**Overview path.** It clamps `to` to UTC today (C4). It then makes one wide fetch covering the requested window and the trailing 70-day load window. The fetch goes through in-process coalescing caches (5-minute TTL, 500 entries), which only `mutateExerciseSet` clears per user (D10). The pure `calculateTrainingOverview` does the rest.

**Load model.**

- Strength is scored as tonnage × RPE × tag modifiers.
- Cardio is scored as duration × an intensity factor, taken from HR, then power, then RPE, then keywords.
- Karvonen HRR withholds HR when there is no age or measured max, but hrTSS and LTHR do not (C10).
- Williams EWMAs (N = 7 and 28) are seeded with the first log's UTSS (C11). ACWR and TSB are gated at 14 days.

**Stored analyses.** Each captures a history anchor before generating. They are recomputed at each athlete's local midnight behind an advisory lock, a pg-boss singleton key and an atomic claim.

**Race predictor.** It projects logged sets to full stations within a 0.5–2× trust band and bounds them to 0.8–1.5× the cohort benchmark. AI output is clamped to the same band.

**Session grades.** They are recomputed on every read, from stream buckets (Otsu segmentation) or from summary data.

The 3,549-line generated cohort table was sampled; the code that reads it was read in full.

**Strengths:**

- The math is pure and injectable.
- Reads that respect unit stamps are applied consistently across PRs, analytics, mileage, tonnage and race loads.
- Load dynamics handle two-pass variance, flat weeks and history gating carefully.

**Key findings:** C1 (high); C4, C6, C7, C10, C11, C12, C13, D10 (medium).

### Server: nutrition — 6/10 (~9.2k LOC read)

Nutrition is a feature-flagged sub-router: it returns 404 when `NUTRITION_ENABLED` is off. Eight route modules sit over a `NutritionStorage` facade.

**Data model.** One `foods` table mixes two kinds of row:

- the shared provider cache (USDA, OFF, Edamam), keyed by a partial unique `(source, source_id)`;
- per-user custom and recipe foods, which can be made public.

Visibility is one predicate, `visibleTo()`. Values are per 100 g. `food_log_entries` hold only the food id, grams and a server-derived local `log_date`, so every total is computed at read time by a live join.

**Search.** It runs a local trigram/synonym query. When that returns fewer than 10 hits, it fans out to the three providers and caches every mapped hit through `sanitizeMappedFood`. It also appends a semantic tier over the vector DB, and refreshes rows older than 60 days fire-and-forget.

**AI parsing.** Gemini text and vision parses produce suggestions only. They are saved through a batch endpoint gated on consent and budget.

**Targets.** They are versioned by `effective_from` and adjusted for load, recovery, preload, phase, a cap and a calorie floor. They are then split across meals by session anchors.

**The live join's cost.** It causes a known open item: editing a custom food rewrites days already logged. It also opens two further ways to change logged data, found here: provider upserts and refreshes, and owner edits to a public food (D18).

**Strengths:**

- Storage is per 100 g, with one shared scaling function summed raw and rounded once.
- One visibility predicate, pinned by SQL-shape tests.
- Target versions are protected by unique indexes plus a retry on 23505.
- AI parses never auto-log.

**Key findings:** PF1 (high); C8, C20, C21, D13, D18, CL33 (medium).

### Server: HTTP layer, auth & middleware — 7/10 (~4.6k LOC read)

**Boot.** Env is validated with zod, and production refinements fail fast. The server listens before the startup phases run. A dependency-free liveness route is kept separate from a readiness route backed by 5 s-cached pool probes.

**Parsers and mounting.** Route-scoped JSON parsers run ahead of the global 100 KB parser: 10 MB for image parse, 5 MB for chat, 2 MB for coaching. `registerRoutes` then mounts Clerk, the double-submit CSRF guard on `/api/v1` (the Strava webhook and unsubscribe are exempt), a training-context invalidation hook, and the feature routers.

**Mutations.** Every mutation goes through `protectedRouteBuilder`, in this order:

1. `isAuthenticated`: Clerk plus `ensureUserExists`, with a local and a DB-backed seen-cache.
2. Atomic idempotency claims: 60 s claim TTL, with 2xx responses cached for 7 days.
3. A Postgres-backed limiter keyed `category:user|ip`. Reads fail open; writes fail closed.
4. Consent and budget checks, which fail closed.
5. Zod validation, then the handler.

**Errors.** The inline error handler keeps the status and code of an `AppError`. For any other error it trusts `err.status` or `err.statusCode` and masks the message only on an exact 500. That is the mechanism behind C3.

**Recycle bin.** A delete captures the full graph into jsonb inside the deleting transaction. Restore runs under `FOR UPDATE`, re-inserts the original ids and nulls FKs that no longer resolve.

**Strengths:**

- Phased boot, with liveness and readiness split.
- Idempotency is genuinely atomic.
- A single CSP source of truth, with per-request nonces and no unsafe-inline.
- Production env refinements: a weak-key denylist and separate CSRF and encryption keys.

**Key findings:** P5, C2, C3, C5, D8, D10, U6 (medium).

### Server: data layer (storage) — 7/10 (~4.4k LOC read)

**Structure.** `storage/index.ts` composes one instance per domain into the `storage` facade. All domains share a single Drizzle `db`, with a pool of 20 and a 30 s statement timeout. Vector and RAG code use a separate `vectorPool`. A `DbExecutor` type lets a storage method join a transaction the caller owns.

**Set CRUD.** It goes through an owner adapter (workout or plan day) whose ownership check doubles as a row lock. sortOrder comes from a correlated MAX, an optimistic version gate guards updates, and each change is mirrored to the structure step. Deletes are captured to the recycle bin in the same transaction, and plan-day status is then re-synced under `FOR UPDATE`.

**Sweeps and retirement.** The missed-day sweep runs per timezone. Its guard predicates live in driverless modules, so tests render and check the real SQL. Retirement uses a half-open `[start, retired_on)` window.

**Timeline.** It merges three sources: scheduled plan days (capped at 3× the limit), logs linked through a `planDayId → log` Map, and standalone logs. It then windows the result by offset or date cursor and hydrates it.

That Map breaks the layer's own invariant. The schema allows many logs per plan day, but the merge keeps only one (C16). It is the same last-write-wins Map that hid the H2 data loss.

Storage tests were read by case name only, and no test that needs a database was run.

**Strengths:**

- Tenant scoping is consistent.
- Check-then-act races are closed with row locks.
- Plan-lifecycle predicates are tested by rendering the real SQL.
- Real-Postgres suites cover ownership, scheduling, the cursor window and completed dates.

**Key findings:** C16, C17, C18, D19, D21 (medium).

### Server: schema & migrations — 6/10 (~8.2k LOC read)

**Single source.** `shared/schema` defines:

- the 40 tables in `tables.ts`;
- the enum constants, rendered into CHECK constraints through `inValues()`;
- the exercise catalogue and the structure lint;
- the drizzle-zod request schemas, whose route variants omit server-owned columns.

**CI.** CI checks for drift, regenerates and diffs the migrations (120 journal entries), and applies the full chain twice to a fresh pgvector database. Cypress and the integration lane build their databases with `drizzle-kit push` instead.

**Production.** Production schema is managed by hand with `drizzle-kit push`, and its migration ledger is empty. At boot, this happens:

1. `migrate()` starts at 0000 and fails on "already exists".
2. `isBenignIdempotencyError` reports that failure as a benign skip.
3. `assertCriticalTablesExist` checks only five tables.
4. Readiness runs only `SELECT 1`.

As a result, only what push can express reaches production. Data DML, extensions, views, and constraints or indexes that exist only in SQL never do. `pending-manual-steps.md` is the human ledger for them. This is the mechanism behind D7, PF3 and the untracked 0117 repair (D1).

**Cascades.** The vector tables are created outside Drizzle, with no FKs. Every user-keyed table cascades from `users.id`, enforced by a test. The documented exception is `foods.created_by_user_id`, which is set to null instead.

Migrations 0000–0090 were checked by grep and a scripted comparison of definitions, not read line by line.

**Strengths:**

- The schema matches the snapshots: `drizzle-kit generate` against a scratch copy reported no changes.
- A scripted comparison of every CHECK, index and FK in the 0119 snapshot found no unexpected differences.
- Enum CHECKs are pinned byte-for-byte to their TypeScript constants.

**Key findings:** D7, PF3 (medium).

### Server: jobs, email, erasure & crypto — 6/10 (~6.9k LOC read)

**Boot.** Boot runs maintenance: the missed-day sweep, an unconditional `resetStaleAutoCoaching`, and re-encryption. It then starts the queue and the node-cron tasks. Each cron task runs at a fixed UTC time under an advisory lock from a key registry.

**Email.** The hourly tick marks missed days per timezone and gates every email-enabled user on their local hour and weekday. It then enqueues no-retry pg-boss jobs. Each worker re-checks opt-in and takes an atomic claim before sending. The claim is a conditional `UPDATE … RETURNING` over a 20-hour or 6-day window. The send goes through Resend, plus a fire-and-forget web push with an SSRF DNS re-check.

**Other queues.** Auto-coach, embed, plan generation, recompute, Strava sync and session streams share default or no-retry job options, `runBatch` (p-limit 2) and a 50-minute timeout.

**Account erasure.** It runs in this order:

1. Stamp `erasure_requested_at`.
2. Purge the vector DB.
3. Delete the Clerk user and deauthorize Strava.
4. In one transaction, delete the user row and private foods.
5. Purge rate-limit buckets and pg-boss jobs.

An hourly sweep re-runs erasure for any marker left behind.

**Crypto.** `crypto.ts` is a two-slot, versioned AES-256-GCM keyring.

**Broken invariants.** Two things the design relies on do not hold:

- pg-boss expiry is meant to exceed handler runtime. But `expireInMinutes` is not a pg-boss 12 option, so every job expires at the 15-minute default (D9).
- A Clerk JWT is assumed dead once the identity is gone. But `ensureUserExists` re-creates an erased account from a still-valid token (P5).

**Strengths:**

- Every scheduled email takes an atomic claim before sending. Duplicate enqueues from the tick, the catch-up scan, the cron endpoint or a second replica cannot double-send.
- Erasure is resumable and idempotent.
- Unsubscribe tokens are HMACs, compared in constant time under both key versions.

**Key findings:** S2 (high); P3, P5, P6, P7, D9 (medium).

### Shared domain logic — 7/10 (~5.4k LOC read)

`shared/` is the domain layer with no I/O, imported by both the browser bundle and the server. A bundle check forbids value imports of the drizzle schema barrel into the client. That is why there are many small leaf modules.

**Units.** The chain starts with branded `Minutes`/`Seconds`/`Metres` types and a single `METRES_PER_MILE`. It runs through `unitConversion.ts`, which holds:

- the L4 per-row unit-stamp helpers;
- `normalizeWorkoutTextUnits`, a hand-rolled scanner that rewrites AI and coach prose into the athlete's units. Plan generation, the auto-coach, plan adjustment and suggestions all save its output.

**Session estimates.** `plannedSessionEstimate.ts` estimates session duration and UTSS, mirroring the server's stress scores. Fuelling chips, nutrition forward-fuelling, AI context, missed recovery and body-system load all use it.

**Race.** The race cluster holds rulebook loads, 34 generated cohorts and a cohort fallback chain. It feeds race prediction.

**Dates.** `dateUtils` and `planPhase` own UTC date-only math, `computePlanWeeks`, and the Monday-anchored week 1. Plan generation and `schedulePlan` both depend on them.

Everything rests on one invariant. `exercise_sets` weight and distance are not stored in a canonical unit. Stamped rows carry their unit; legacy rows assume the athlete's current preference.

**Strengths:**

- Numeric and date edge cases were checked by running them: pace roll-over at 59.5 s, leap day, DST weekends, and deload rounding down to plate increments.
- Prior audit fixes were confirmed present. The exception is C23: the H3 fix still misses spaced ranges and "to" ranges.

**Key findings:** C19, C22, C23, D23 (medium).

### Client: workout detail & set editing — 5/10 (~11.6k LOC read)

**Surfaces.** These are the sheets that show and edit one session:

- `LogSheet`, for a planned day;
- `ReviewSurface`, for a logged workout;
- the read-only preview and skipped sheets;
- the FAB's `AdhocLogSheet`.

They all share `WorkoutCoachSheet` and `WorkoutContentsLayout`. `WorkoutCoachSheet` is a Radix dialog on desktop and a bottom sheet on mobile, with an embedded coach chat. The `/log` page turns its block state into synthetic set rows for the same `ExerciseTable`.

**Table.** `ExerciseTable` converts rows to the athlete's current unit once. It groups consecutive rows by block, step and exercise name, and emits one sortOrder patch per set when rows are dragged.

**Editing.** Cell edits go through `InlineSetEditor`'s `FieldInput`, which commits on blur, into the owning hook's 350 ms per-set debounce. That debounce applies:

- optimistic patching;
- a sequence guard and a per-set version lock;
- a flush on unmount and a cancel when the owner switches.

Free-text fields autosave on a 600 ms debounce, with a flush on unmount.

**Structure.** `StructureBlocksEditor` re-derives its draft from the value prop whenever the JSON differs. On every edit it sends every block back to the server as a full replace. The server then copies step names from exercise rows keyed `blockId:stepNumber`.

Most defects sit in these persistence seams (unmount flushes, debounce keying, lossy round-trips), not in rendering. This is the lowest-scored subsystem in the analysis and holds two of the eight highs.

**Strengths:**

- Unit stamps are handled once at the surface boundary, with tests that pin both display and edit-back.
- `FieldInput`'s state machine handles pending saves, rolled-back saves and edits from another device.
- Accessibility basics are consistent: named icon buttons and cells, aria-pressed and aria-expanded, and screen-reader-only text for prescriptions.

**Key findings:** CL1, CL2 (high); CL7, CL8, CL12, CL14, CL15, CL16, U3 (medium).

### Client: timeline & weekly review — 7/10 (~14.5k LOC read)

**State.** `pages/Timeline.tsx` builds on `useTimelineState`, which combines:

- an infinite query over the timeline endpoint, paged by date cursor. The first page is today onward plus 200 past entries, keyed by plan.
- filters that group entries by date string and insert annotation and today rows;
- plan import, workout actions and combine.

**Rendering.** A TanStack virtualizer lays rows out in normal flow between spacers, inside a `DndContext`. Each date group is a drop target holding `TimelineWorkoutCard`s. A card has `role=button` and contains a drag handle, a move menu, a date picker, a recovery prompt, a coach note, Strava controls and fuelling/MAF chips. Scroll-to-today uses a requestAnimationFrame loop that repeats until the position settles, and stops if the user scrolls.

**Interactions.**

- Selecting an entry opens its preview, log, review or skipped sheet, and keeps `?workout=` in sync.
- The missed-recovery dialog fetches its preview uncached and invalidates after apply.
- A title rename updates every cached timeline and open sheet optimistically.

**Review page.** It reads `?week=` through `useWeeklyReview`, which caches closed weeks with `staleTime: Infinity`.

The subsystem relies on two invariants. The server computes status, excused and recoverable state in the athlete's timezone. And every write invalidates each cached view derived from it. The mapper reports that most defects cluster on the second.

**Strengths:**

- Missed-session recovery is built on state the server decides, with uncached previews that refresh on stale errors.
- The virtualizer handles real layout problems deliberately.
- Accessibility work is broad: drag-and-drop announcements in date terms, live regions, 44 px targets, and status never shown by colour alone.

**Key findings:** CL10, CL11, CL22, U1 (medium).

### Client: nutrition, log-workout & onboarding pages — 7/10 (~12.4k LOC read)

The scope is three flows plus the static landing and privacy pages.

**Nutrition.** `Nutrition.tsx` owns every dialog: log or edit food, barcode, custom food, recipe builder, describe-meal review, targets, meal targets, and snap and scan-label. They read through hooks in `useNutrition.ts`.

- **Freshness.** The global staleTime is 5 minutes, with no refetch on focus and retry 1. Explicit invalidation is therefore the only way data refreshes. The day summary carries the server's effective target separately from the targets list query.
- **Offline.** Single food logs go through the offline fallback with an idempotency key. Batch, update and delete work only online.
- **AI.** Describe, snap and label go through `useAiConsentGate`, which keeps the input and resumes after consent.

**Log workout.** `LogWorkout` runs a Capture → Confirm → Reflect stepper over three pieces:

- the block editor, with auto-parse;
- a form hook with two speech-recognition sessions and an offline-capable save;
- a versioned localStorage draft scoped to the user.

**Onboarding.** It runs 6–7 steps, layers its state over saved preferences, and PATCHes only the fields that changed. An optional fuelling step writes a body profile and a nutrition target. The plan step offers a template, AI generation, CSV import or skip.

**Strengths:**

- Previews reuse the shared scaling, so the preview, meal totals and server totals agree.
- Offline logging reuses the idempotency key generated up front.
- Accessibility work is unusually thorough: named radio groups, reasons on disabled buttons, live regions, focus moved to step headings, and jest-axe tests.

**Key findings:** P4, CL9, CL19, CL20, CL30, CL31, CL32 (medium).

### Client: analytics & settings — 7/10 (~17.5k LOC read)

**Analytics.** `Analytics.tsx` keeps the date range in the URL and converts it to `from`/`to` in the browser's local time. Overview and Progress load eagerly; the other six tabs load on demand.

- **Server-computed numbers.** Most numbers come from the server: zero-filled weekly rollups with previous-period deltas, load trends, body-system load, PRs already in display units, session grades, and stored AI analyses. The AI analyses are regenerated behind consent and budget checks. Their snapshots are cached in per-user localStorage as placeholder data.
- **Client-side maths.** The client does a small amount of its own maths: trend building, the MAF trend, coverage analysis and grade chart data. That is where it drifts from the server; CL4, CL5 and CL6 all sit in those helpers.

**Settings.** `usePreferencesForm` holds a string-typed draft. Its dirty state is a JSON comparison against a saved baseline. Saving PATCHes an all-or-nothing preferences schema and adds MAF bookkeeping: the client computes `mafHr` and the server stores it as sent. An Undo replays the previous baseline.

Several actions bypass the Save bar: push reminders, athlete facts, coaching uploads (extracted from PDF or DOCX in the browser), Strava and Garmin connect, the recycle bin and account deletion.

**Consent.** The design treats `aiCoachEnabled` as the single master AI consent. P2 finds it is shown to users only as "Auto-Adjust Workouts".

**Strengths:**

- Body-composition edits go through a string buffer over canonical kg/cm, so a unit switch never touches stored data.
- Dirty tracking survives background refetches, with guards on page unload and in-app navigation.
- Chart accessibility is above average: labels that carry the data, a table toggle, and status shown as icon plus word.

**Key findings:** P2, CL4, CL5, CL6, CL34 (medium).

### Client: data hooks — 6/10 (~12.4k LOC read)

`client/src/hooks` sits between React Query and the components.

**Coach chat.** It keeps a local message buffer that `chatStream.ts` fills through the shared SSE reader. The reader batches flushes per animation frame, uses an AbortController, and guards against stale streams with a generation counter. `useChatHistory` fills the buffer once from a cache entry with infinite staleTime and gcTime. The server saves both turns under ids the client generates, so a retry reuses them.

**Set editing.** `useExerciseSetsForOwner` is the engine behind two hooks:

- `useWorkoutDetail`, used in `ReviewSurface`, which is keyed per entry;
- `usePlanDayExercises`, used in `LogSheet`, which is not keyed.

The engine provides:

- per-set debounce;
- optimistic patching with unit restamping;
- a sequence guard and a version tracker that serializes requests per set;
- rollback to a per-owner snapshot;
- batched invalidation of derived views.

**Workout composer.** It combines block state, manual parse and a 1.2 s debounced auto-parse sharing one AbortController. It saves through the offline fallback with idempotency keys.

**Assumptions.** The hooks rely on three things:

- invalidation works because QUERY_KEYS nest by prefix;
- TanStack v5 gives a pending mutation the latest render's callbacks;
- `LogSheet` and `ReviewSurface` are keyed as described above.

CL18 and CL21 both turn on the unkeyed `LogSheet` closing while an edit or parse is still running.

**Strengths:**

- The set editor's concurrency handling is deliberate: a version lock that rolls back and refetches on conflict, and rollbacks scoped to the edited field.
- Offline writes reuse idempotency keys and check which user owns the queue.
- The chat stream aborts on unmount and retries under the same turn ids.

**Key findings:** CL17, CL18, CL19, CL21, CL23, CL25 (medium).

### Client: app shell, API client & offline queue — 7/10 (~10.9k LOC read)

**Startup.** `main.tsx` holds back `Sentry.init` until the privacy notice is acknowledged and the per-device opt-out is clear. It then registers a Workbox service worker that:

- precaches the app shell;
- handles push, opening same-origin URLs only;
- serves same-origin `/api` GETs network-first into an `api-cache`, which sign-out and account deletion purge.

The query cache is never cleared when the signed-in user changes. The code relies on Clerk's full-page navigation instead.

**API client.**

- It applies a 15 s timeout unless a caller overrides it.
- It fetches a cached CSRF token for mutations, and retries once on a 403 with no code or a CSRF code.
- It maps 429 to typed rate-limit and budget errors.
- Any other failure throws `Error("${status}: ${body}")`, a string that several call sites parse back apart.

**Offline queue.** `runWithOfflineFallback` queues three write types when the browser is offline or the error looks like a connectivity failure. It reuses the request's idempotency key. The queue is a zod-validated localStorage array capped at 100 entries, 7 days and 5 tries. It is replayed in order on the `online` event, when the layout mounts, and once more if a flush was requested mid-run.

**Images.** Photos are compressed to a 1600 px JPEG with a `blob:` preview URL. CSP `img-src` does not allow `blob:` URLs (U6).

The stock shadcn primitives were skimmed. The clone is shallow, so its history could not show which of them had been customised.

**Strengths:**

- The CSRF retry is narrowly scoped.
- Error reporting has two gates, with tests that run the real Sentry SDK.
- The offline queue tells the user when it drops an entry and why.
- CSP `img-src` closes the route by which a markdown image could leak data.

**Key findings:** P1, CL3, CL26, CL27, CL28, CL29, U6 (medium).

### Tooling, CI, deploy & operator scripts — 6/10 (~7.6k LOC read)

**Merge gates.**

| Workflow | What it runs |
|---|---|
| `build.yml` | ESLint; tsc through the TS 7 alias; `check:strict` over `shared/`; `check:test` over all tests except about 60 excluded files; an OpenAPI snapshot diff |
| `test.yml` | vitest with coverage thresholds |
| `migrations.yml` | a drift check; regenerate-and-diff; two applies to a fresh DB, with a journal count |
| `cypress.yml` | a hard `check:bundle` gate; the integration and smoke suites; then Cypress against the built server, with the dev-auth bypass and mostly stubbed APIs |

Gitleaks and dependency review also run. Bearer and DevSkim only upload SARIF reports and never fail a run.

**Build.** Railway builds from `railway.toml` with nixpacks. It runs `pnpm install --frozen-lockfile` without the `--ignore-scripts` flag that CI uses. It then runs `script/build.ts`, which runs vite, bundles the server with esbuild, checks minimum artifact sizes and deletes every sourcemap.

**Start.** `script/start.js` falls back to a 503 server if the bundle fails to import. The server binds its port before maintenance, queue, cron and routes, and only then reports ready. But the Railway healthcheck targets the liveness route, which returns 200 unless startup has already failed (D2).

**Schema and scripts.** Production schema changes are a manual `drizzle-kit push`. Data backfills are manual scripts tracked in `pending-manual-steps.md`. Most operator scripts default to dry-run through a shared CLI skeleton. Three older ones write unless `--dry-run` is passed.

**Coverage gaps.** Cypress specs other than `api-validation` were checked only for stubbing. `pnpm-lock.yaml` was spot-checked.

**Strengths:**

- Every third-party action is pinned to a commit SHA, with least-privilege permissions and no `pull_request_target`.
- The typecheck and coverage ratchets are real; every excluded test file was confirmed to exist.
- `docsSync.test.ts` pins the documented catalogues to the code.

**Key findings:** S4, D2, D3, D4, D5 (medium).

---

## Cross-cutting reviews

Ten lenses each swept the whole repository for one concern. Each note below gives the sweep, the systemic pattern the lens found, and its key findings: its highs and mediums, plus the lows that carry its main point. Each lens counted routes and call sites with its own method, so counts differ between notes; route registrations, for example, range from about 150 to 182. Each count is as that lens measured it.

| Lens | Health | Grade | Files / LOC read | High | Medium | Low |
|---|---|---|---|---|---|---|
| Security | 7 | B+ | 48 / ~7.6k | 1 | 4 | 1 |
| Privacy & compliance | 6 | B- | 72 / ~11.5k | 0 | 4 | 7 |
| AI reliability, safety & cost | 6 | B- | 62 / ~9.6k | 0 | 8 | 7 |
| Data integrity & concurrency | 7 | B+ | 48 / ~12.5k | 0 | 7 | 4 |
| Client/server contract | 7 | B- | 78 / ~11.5k | 0 | 7 | 8 |
| Performance & scalability | 7 | B | 74 / ~9.8k | 1 | 1 | 10 |
| Architecture & maintainability | 7 | B | 62 / ~7.5k | 0 | 6 | 4 |
| Testing | 7 | B+ | 62 / ~9.5k | 1 | 0 | 9 |
| Accessibility & UX | 7 | B | 52 / ~7.8k | 0 | 5 | 12 |
| Ledger status & doc drift | 8 | B+ | 78 / ~13.5k | 0 | 2 | 6 |

### Security — 7/10, B+

**Sweep.**

- About 179 route registrations across 33 files, checked for auth guards and userId scoping.
- Nine storage methods without a userId parameter and 17 writes keyed only by id; all are reached after an ownership check.
- 45 raw-SQL sites, HTML injection points (none found) and 16 outbound fetches.
- An AST scan of every regex literal: 17 have nested quantifiers, none prone to catastrophic backtracking.
- The SSRF guard, tested against 31 bypass candidates.

**What holds.** Authorization holds in three layers that agree with each other. AI write paths check the ids the model chooses against the user's own days, so prompt injection can only reach the injector's own data.

**Gaps.** They sit where trust rests on something other than the session, or where shared rows cross tenants:

- the Strava OAuth state is not bound to the browser that completes the flow;
- the owner of a public custom food can still edit it under other users' logs, the only cross-tenant write channel found;
- a legacy chat path skips the history cap;
- request bodies are parsed before authentication;
- limiter buckets are shared by routes with different maxima.

**Key findings:** S3 (high); S5, P3, C5, D18 (medium); D35 (low).

### Privacy & compliance — 6/10, B-

**Sweep.**

- An inventory of 43 Drizzle tables, 2 vector-DB tables and 45 `CREATE TABLE` migrations.
- Every AI egress point, about 35 call sites in 24 files, traced to its consent gate.
- Erasure and export compared against that inventory.
- A runtime repro against the installed server Sentry SDK.
- 15 client storage keys.
- `Privacy.tsx` read claim by claim against the code.

**Consent.** It is enforced at the edges rather than in the shared provider layer, even though that layer already receives `userId`. Every path that does not come through a route has to remember the check, and four do not.

**Erasure and export.** Erasure is closed-world: a test scans every `users.id` FK. Export is a hand-kept list of 13 reads, so it drifts by design.

**Residual leaks.** They sit in side stores that cascades cannot reach: the runtime cache, pg-boss jobs, Sentry transactions, browser push subscriptions and Workbox caches. The Privacy page's list of data processors has also fallen behind the integrations.

**Key findings:** P3, P4, P6, P7 (medium); P11, P13, P14, P18, D53 (low).

### AI reliability, safety & cost — 6/10, B-

**Sweep.**

- 17 text-generation call sites in 12 modules, and 3 direct Gemini vision or embedding sites.
- Consent and budget gating on 25 routes, and every caller that does not come through a route, including the 7 callers of the exercise parser.
- `sanitizeUserInput` use in 30 modules that build prompts.
- Repros of how the adapters handle stream errors and `max_tokens`, and of how the breaker admits calls when half-open.

**Shared layer.** The text-generation layer is clean, but embeddings and vision bypass it. They still share its single breaker, and a retry policy sized for slow reasoning calls.

**Cost accounting.** It depends on each caller passing an optional `userId` and on each adapter normalizing usage. Neither is enforced. The Gemini normalizer drops thinking tokens, and the reparse paths record nothing.

**Gating and parity.** Consent and budget gating is a per-route convention. Provider parity is asserted only through capability flags. The evals cover chat only and have never run against a live model.

**Key findings:** P6, AI2, AI3, AI4, AI5, AI6, AI7, PF2 (medium); AI18, AI23 (low).

### Data integrity & concurrency — 7/10, B+

**Sweep.**

- Every `CREATE UNIQUE INDEX` compared against the schema; they match.
- 54 production transaction sites.
- The 17 inserts and 6 updates of `exercise_sets`.
- 10 hard-delete sites.
- Every pg-boss producer and worker, checked against the singleton and debounce semantics of the installed 12.35 release.
- The vector-DB lifecycle, the offline queue and migrations 0095–0119.

**Model.** Integrity rests on three layers. DB constraints are the backstop. Transactions that lock rows provide atomicity. Postgres primitives coordinate work across processes.

**Gaps.** The defects are the seams where one layer is missing:

- The auto-coach pass and the embed job apply a stale snapshot without revalidating it.
- Unlink, link-merge and combine hard-delete athlete data outside the recycle bin.
- The auto-coach queue drops a trigger that arrives too soon after the last one, where Strava sync waits and runs the latest.
- Stranded plan generations are swept only at boot.
- Migration 0117 shipped with no manual-steps entry.

**Key findings:** P3, AI12, AI16, D1, D11, D20, CL29 (medium); D38, D39, D47, D48 (low).

### Client/server contract — 7/10, B-

**Sweep.**

- 167 server route registrations matched against 147 distinct client `/api/v1` URLs.
- Each client API module compared against its handler.
- All 72 query sites classified.
- A matrix of which cached queries each mutation affects, built from every invalidation and cache write.

**Shapes.** Shape drift is rare, because types come from `@shared/schema` and every client URL resolves to a live route.

**Cache coherence.** It depends entirely on each caller. There are at least nine hand-kept variants of the "workout data changed" key list. Meanwhile the server derives more and more fields at read time: excused status, effective targets, unit-converted PRs. The mutations that change their inputs do not refresh them.

**Units.** The unit contract for writes is implicit. Request bodies carry bare numbers, and the server stamps them with its own current unit preference.

**Key findings:** C4, D22, CL10, CL13, CL19, CL22, CL24 (medium); CL56, CL66, CL67 (low).

### Performance & scalability — 7/10, B

**Sweep.**

- AST scans: 13 awaits inside loops, and 22 of 48 transactions that await work outside the transaction.
- An import-graph trace from `main.tsx` and every lazily loaded page.
- About 90 module-level caches and 118 `Promise.all` fan-outs.
- eq() predicates on about 60 columns, compared against 89 index declarations.
- Six runtime repros.

**Main weakness.** No N+1 query sits on a hot path. The systemic weakness is now input-driven work amplification: a number the user controls sets a loop count. Some places cap it (92-day chat tools, 1040-week summaries, `pLimit(3)` parse fan-out) and others do not. A `from=0000-01-01` request to a nutrition range endpoint cost 2.2 s of synchronous CPU and returned 101 MB of JSON.

**Other issues.**

- The hourly crons each load every eligible user and filter by local hour in JS.
- Cancellation on client disconnect listens for `close` on `req` when it should listen on `res`.

**Key findings:** PF1 (high); AI10 (medium); D49, PF6, PF12, PF14 (low).

### Architecture & maintainability — 7/10, B

**Sweep.**

- A full import graph built with the TypeScript compiler API: 1,659 files, 965 of them production.
- Cycle detection, a matrix of dependencies between layers, and unused-export analysis: 122 unreferenced value exports, each confirmed by grep.
- Resolution of all 913 `vi.mock` targets.
- 176 route registrations, 11 feature flags, 14 limiter categories and 25 AI call sites.

**Dependency direction.** It is good. `shared/` imports only zod and drizzle, and the client never imports the server. There are two runtime cycles: the known storage/AI-usage cycle, and an eight-module cycle through the pg-boss registry that had not been recorded.

**Oversized modules.** The modules doing too many jobs are `storage/users.ts` (seven concerns), `routes/ai.ts`, `strava.ts` and `garmin.ts`. `prompts.ts` has grown back to 873 lines after being split to 285.

**Drift.** The defects are drift between mechanisms that should agree. Bot commits land without doc updates, and one of them contradicts the documented consent design.

**Key findings:** P6, C4, C5, D10, CL13, PF2 (medium); C28, A13 (low).

### Testing — 7/10, B+

**Sweep.**

- All 638 tracked test files: no `.skip`, `.only` or `.todo`.
- An AST scan of about 6,300 test callbacks: none lacks an assertion.
- 13 targeted coverage runs over about 45 high-risk modules.
- The 38 date-related client test files, re-run under two non-UTC time zones; 14 tests fail under Pacific/Auckland.

**Mock placement.** This is the structural problem:

- services that call AI mock the whole provider layer;
- route tests use a test-only error handler;
- storage tests mock `db`.

So spend metering, plan-link ownership and the error contract are tested on neither side of their seam.

**Test-mode branches.** Production code branches on `NODE_ENV === "test"` in four places, and every lane that runs a real server runs in test mode. The paths that coordinate across server instances therefore run only in production.

**Coverage gaps.** Global coverage thresholds hide files with 0% coverage. The Strava callback, where S3 lives, is one of them.

**Key findings:** S3 (high); AI19, C39, A10, A11, A14, A16 (low).

### Accessibility & UX — 7/10, B

**Sweep.** 319 production `.tsx` files, checked with AST and regex sweeps:

- 406 buttons and triggers for accessible names (none unnamed);
- 148 form controls for labels (one unnamed radio group);
- 23 icon controls below the touch-target size;
- 52 live regions;
- the 39 modules that consume queries, for `isError` handling (11 handle it);
- about 45 delete paths, for confirmation or undo.

A jsdom repro against the real timeline card confirmed the keyboard defect.

**Systemic patterns.** Five patterns explain most findings:

- a card that is itself a button but contains other controls;
- no shared state for a failed query, so 28 of the 39 modules fall into empty or first-run states on error;
- no shared guard against dismissing entry surfaces;
- offline support opted into per mutation;
- error toasts that pass a raw `401: {json}` string through.

**Key findings:** CL11, U1, U2, U4, U5 (medium); CL55, U26, U27, U28 (low).

### Ledger status & doc drift — 8/10, B+

**Sweep.**

- About 60 open, deferred, accepted-risk and manual-step items in 9 ledger documents, re-checked against HEAD 4ad6804.
- More than 40 RESOLVED items, spot-checked while searching for sibling code paths added since each fix.
- All 182 route registrations, checked for a rate limiter.
- Migrations 0095–0119, checked for data changes.
- The reference docs, compared against the code.

**Change since 642fe2f.** Measured through the GitHub API, because the clone is shallow:

- 612 commits;
- server code from 91.2k to 143.5k lines;
- test files from 416 to 626;
- migrations from 91 to 120.

**What holds.** The code-level audit trail works, and the doc enumerations that tests pin are correct.

**What drifts.**

- Nothing ties a migration that changes data to a manual-steps entry. That is how 0117 slipped through.
- Fixes land one route or reader at a time rather than at a single enforced choke point. The combine route missed the plan-link fix, and chat tools added new readers that ignore the L4 unit stamp.
- Two status headers overstate how much is closed.
- Auto-generated Bolt comments grew from 72 to 97.

**Key findings:** AI9, D1 (medium); S9, D41, A5, A6, A7, A15 (low).

---

## What changed since 2026-08-31

The last analysis ran at `642fe2f`. Between it and `4ad6804` there are 612 commits (424 non-merge, 188 merges), spanning PRs #1887 to #2104. Measured with tests included:

| Area | 2026-08-30 | 2026-10-03 | Change |
|---|---|---|---|
| Server | 91.2k lines | 143.5k lines | +57% |
| Client | 84.7k lines | 102.6k lines | |
| Shared | 15.9k lines | 21.9k lines | |
| Scripts | 4.0k lines | 4.8k lines | |
| Test files | 416 | 626 | |
| Migrations | 91 | 120 (0091–0119 added) | |

The Cypress specs (12) and workflows (9) are unchanged.

Most commits fall into four groups:
- **Audit remediation.**
  - The 2026-08-31 priority items.
  - Six fix passes on the 2026-09-04 mapper concerns.
  - The 2026-09-19 security audit.
  - The 2026-09-23 refactoring and onboarding audits.
  - Three waves from the 2026-10-01 chat review.
- **About 72 static-analysis cleanups** (Sonar, Codacy, DeepSource, Bearer, DevSkim).
- **About 51 bot PRs** (Bolt, Palette, Sentinel).
- **About 42 docs-drift fixes and about 25 dependency bumps.**

The new subsystems are:
- **Strava, end to end.** Enrichment, device-linking, webhooks with auto-sync, and HR and pace streams.
- **Logging and data controls.** `counts_as_training` and the recycle bin.
- **Email.** An hourly per-athlete email scheduler with three new emails and one-click unsubscribe.
- **The deterministic workout engine** (`workoutEngine/`, about 3.6k lines).
- **Session grading** (about 2.3k lines).
- **Missed-session recovery with priority tiers** (about 1.6k lines).
- **Body-system load.**
- **The athlete card**, the coach's memory of the athlete.
- **A rebuilt, server-owned coach chat** (`services/chat*`, about 3.2k lines). It has threads, rolling notes, tools behind a flag, evals, telemetry, partial apply and undo, `plan_day_moves` and photos.

Production code grew by about 53k lines. Even so, 78% of this analysis's datable findings sit on lines that predate this window (see the executive summary).

## Prior-audit ledger

Each item below is something an earlier document records as open, deferred, accepted, or waiting on a manual step. The prior-audit reviewer re-checked every item against the code at HEAD. Where this analysis raised its own finding about an item, the finding's report ID is cited.

| Source & item | Status now | Evidence / note |
|---|---|---|
| **CODEBASE_ANALYSIS_2026-08-31** | | |
| #10 / S1: Garmin credential custody (reversible stored password; the UI advises disabling 2-step verification) | Still open (owner decision) | `server/garmin.ts` re-login still uses the stored `encryptedPassword` and still advises disabling Garmin 2-step verification. Repeated as the open Medium in SECURITY_AUDIT_2026-09-19. Related: D6 (most syncs do a full SSO login). |
| H5: production has never run its data-bearing migrations | Still open, and worse | All six boxes in `pending-manual-steps.md` are still unticked, and migration 0117 is not listed at all (D1). The 0074 `pg_trgm` extension and indexes never reach production either (PF3). |
| A4: three orchestration patterns | Still open | `server/usecases/{ai,plans,workouts}` coexist with `services/*UseCases.ts` and logic written inline in routes. |
| A6: two error envelopes | Still open, now documented | `{code,message,details}` (`routeUtils.ts`) and `{error,code,details}` (`index.ts`) both remain; `api-reference.md` documents both. |
| T2: stale Cypress fixtures | Still open | |
| T3: nutrition e2e coverage | Still open | None of the 12 Cypress specs covers nutrition. |
| T4: WorkoutStructureEditor reorder untested | Still open | The file has no test, and CL15 is a reorder defect in it. |
| D3: OpenAPI coverage | Still open (disclosed) | `docs/openapi.json` still has 3 paths. |
| Sled-pull race loads unverified | Still open | `shared/raceConstants.ts` still carries the ⚠️ markers on `sled_pull`. |
| Bolt comments left in place | Accepted, but outgrown | There are 97 "⚡ Bolt" comment lines now, against 72 when the decision was made, and the bot keeps adding them. |
| **MAPPER_CONCERNS_VERIFIED_2026-09-04** | | |
| `timeline-benchmark-check` not wired into CI | Open by design | Only the `bench:timeline:check` script in `package.json` runs it. |
| Idempotency dedupe only covers `res.json` | Latent, unchanged | No mutating route replies through `res.send` today. |
| GDPR export reads the unfiltered `users` row | Latent, unchanged | See also P7: the export misses 12 tables. |
| pg-boss `batchSize > 1` hazard | Latent | All 7 `queue.work` sites use the default `batchSize` of 1, and the comment in `queue.ts` is now accurate. Separately, the `expireInMinutes` option is a no-op (D9). |
| Analytics tab grid / divergent `mean()` | Latent, unchanged | |
| **SECURITY_AUDIT_2026-09-19** | | |
| Garmin reversible password (Medium) | Open (owner decision) | Same evidence as 08-31 #10. |
| AI budget check-then-act; streaming and timeout under-count | Open | The global cap is opt-in (`AI_GLOBAL_DAILY_LIMIT_CENTS` unset means off). Since then, Gemini thinking tokens are found not to be counted at all (AI4). Reparse paths are unmetered (PF2), and the legacy chat history path is about 10× costlier per request (S5). |
| Cypress auth bypass in the production bundle | Accepted | Now defined in one place, `client/src/lib/authBypass.ts`. |
| Live DB credential in CI (`post-migration.yml`); Cypress postinstall patch | Accepted, unchanged | The patch script still forces axios 1.7.4 into Cypress (S7). |
| Unbounded `z.record` JSON on structure steps | Accepted, unchanged | |
| Chat `role` (INFO) | Narrowed | Requests allow only `user` or `assistant`, but the legacy `POST /chat/message` can still store an `assistant` turn the athlete wrote. |
| The header claiming "All 7 Medium … are fixed" | Overstated | Two Mediums are open or partial (A6). |
| **REFACTORING_REVIEW_2026-09-23** | | |
| D1: unitless max weight and distance in the coach context | Partially fixed | The values are now labelled with a unit but not converted (AI9). |
| D2: two plan-day PATCH routes | Still open | The scoped route records moves but skips `missedSessionMoveFields` and the auto-coach enqueue (`plans.ts`). |
| D3: device-sync invalidation omits `trainingOverview` | Still open | `useStravaMutations.ts`, `useGarminMutations.ts`. |
| D4: `formatBlockType` shows "Rounds" for every non-EMOM/AMRAP block | Still open | `StructureBlocksEditor.tsx`. |
| D5: `useMigrationReview` uses raw `fetch` without checking `res.ok` | Still open | `ReviewSurface.tsx`. An error body is swallowed by `ignoreAsyncError`. |
| D6: AdhocLogSheet create has no offline fallback | Still open | `AdhocLogSheet.tsx`. Related: U2. |
| D7: `trainingOverviewLoader` anchors on UTC today | Still open | `trainingOverviewLoader.ts`. The same class of bug as C4. |
| D8: `getLocalDateStr` throws | Still open | 11 calls in the nutrition routes and none use the Safe variant. The scheduler and AI services also call it. |
| D9: `stationsForFreeText` matches substrings | Still open | Executed: "Med ball throws", "Narrow-grip push-ups" and "Bent-over rows" map to rowing, and "Brunch" maps to running. |
| D10: RPE-trend flags hidden from the prompt at 3–4 rated workouts | Still open | `coachingAnalysis.ts` returns early. |
| D11: a Garmin 429 wipes the credentials | Still open | `garmin.ts` calls `setGarminError` right after telling the athlete to try again in 30 minutes. |
| R1: six copies of the `sendPushToUser` `.catch` | Still open | All six sites have `.catch`, but the test pins only two, and its comment still says "three". |
| R2–R6 and the deferred moderate refactors | Still open | The seven copy-pasted email-claim ledgers in `storage/users.ts`, the inline absence `NOT EXISTS`, advisory-lock keys spread over three files, four copies of the AI gate, and the cosmetic items. |
| **ONBOARDING_AUDIT_2026-09-23** | | |
| M2, M3, L3, L7 and the "optimizations beyond the bugs" list | Open by decision / not started | New this round: CL9 (past race dates accepted) and CL20 (the fuelling step overwrites tuned targets). |
| **AI_COACH_CHAT_REVIEW_2026-10-01** | | |
| I13: Anthropic prompt caching | Still open | No `cache_control` anywhere in `server/`. |
| I18: message actions | Partial | Thumbs and Retry are done; copy, regenerate and edit-last are not. |
| I3: message kinds | Partial by decision | |
| Evals and the tools path never run against a live model | Open | `AI_CHAT_TOOLS` defaults to `false`. |
| Training-context cache staleness; whole-plan reschedule missing from `plan_day_moves` | Accepted / open as documented | New this round: the chat-stream lifecycle defects AI1, AI10 and AI7. |
| **CALCULATION_AUDIT_2026-08-20** | | |
| M11: editing a recipe rewrites logged history | Still open | `storage/nutritionRecipes.ts` updates the backing food in place, and log entries keep no snapshot. Related: D18 (the same mechanism for public custom foods). |
| H20: the set-less UTSS cliff | Open by design | Needs recalibration. |
| L5: `mafHrDataAvailable` is read by no calculation | Still open | |
| L16 residual: editing a workout in place does not mark analyses stale | Still open | `workout_logs` still has no `updated_at`. Related: D10. |
| USDA serving-unit codes unverified against live data | Still open | Raised again in this run and refuted as already recorded (see Refuted findings). |
| **TECHNICAL_DEBT.md** | | |
| #29: dual TypeScript installs | Still open | TypeScript 6.0.3 plus `typescript7`. Blocked on the TS 7.1 API and typescript-eslint support. |
| #14: colocated constants | No action, by decision | |
| The "28/29 resolved, 1 remaining" header | Overstated | About 50 verified deferred items live only in the audit documents (A15). |
| **docs/operations/pending-manual-steps.md** | | |
| Audit the ten older data-bearing migrations (0049 `exercise_load_tags` seed first) | Unticked | |
| 0081: purge orphaned private custom foods | Unticked | Probed by the restore drill. |
| 0082: orphaned backfill-review rows | Unticked | Probed by the restore drill. |
| 0091: target-version and in-flight plan dedupe | Unticked | Probed by the restore drill. |
| 0093: `backfill-device-activity-sets` script | Unticked | |
| 0094: `backfill-counts-as-training` script | Unticked | The script itself would also demote sessions its header promises to keep (D5). |
| 0117: plan-day week/weekday slot repair | Missing from the list | D1. `database.md` says it already ran. |

**Regressions and incomplete fixes.** These findings re-open items that earlier audits recorded as fixed:
- **CL2** brings back calculation-audit H1's 60× MAF pace error, through the client tag form.
- **C23** (H3, the range conversion in `normalizeWorkoutTextUnits`) is incomplete for spaced and "to" ranges.
- **C10** keeps the assumed 190 HRmax in hrTSS and estimated LTHR that the H3 fix withheld elsewhere.
- **The L4 unit stamp** has three leaks:
  - **D21**: plan-day copies write unstamped rows.
  - **AI9**: the 08-31 C2 fix listed the coach context as converted, but it covered only the PR block.
  - **D41**: the CSV and JSON exports print raw stored values.
- **CL5** applies audit H8 on the server but not to the client's trend chart.
- **CL58** misses the H2 formatting fix in the new-PR toast.
- **CL66** misses the calculation-audit N1 calorie fallback in a client copy of the scaling.
- **CL52** is the 2026-09-04 rollback fix left incomplete.
- **S9**: the 2026-09-19 route-schema fix missed the combine route.
- **D1**: the H5 process slipped a new data-bearing migration.

Two documentation headers overstate closure (A6, A15). A7 and A5 are prose claims in `server.md` and `database.md` that drifted from the code.

**Ledger hygiene.** The code-level audit lineage works; the operational ledger does not keep up on its own. The open set is spread over nine documents with no consolidated register, and nothing ties a DML-bearing migration to a `pending-manual-steps.md` entry. Two changes would close both gaps:
- A test that lists every migration containing `UPDATE`, `DELETE` or `INSERT` and requires a matching entry in `pending-manual-steps.md` would have caught 0117.
- One open-items register, for example `TECHNICAL_DEBT.md` rebuilt from the "still open" rows above, would make the debt visible in one place.

---

## What is exceptional (keep doing this)

- **Gates that hold.** At HEAD, `tsc`, ESLint (0 errors) and all 6,730 unit tests pass. A sweep found no `.skip`, `.only` or `.todo` tests anywhere. An AST scan of about 6,300 `it`/`test` blocks found none without an assertion. There are no TODO or FIXME markers in the source.
- **Static ratchets instead of reminders.**
  - The route-builder compliance test.
  - The AI-layer dependency-direction test.
  - The error-code catalogue.
  - Path-case-collision and bearer-suppression tests.
  - `tables.cascade.test.ts`, which fails if any `users.id` foreign key does not cascade without a documented exception.
  - CHECK constraints rendered from the TS enum constants and pinned byte for byte.
  - `docsSync.test.ts`, which keeps `env-reference.md` exactly in step with `server/env.ts` (66 variables, 25 defaults).
  
  Past fixes stay fixed because something fails when they regress.
- **Route and tenant discipline.**
  - Every one of about 180 route registrations is authenticated or deliberately public, and all but the health probes and csrf-token are rate-limited.
  - Every `:id` route resolves through a userId-scoped getter or an ownership join, nested resources included.
  - `sql.raw` appears only for constant DDL and in an offline script.
  - All 45 raw `pool`/`vectorPool.query` calls use placeholders.
- **The schema and migrations agree.** `drizzle-kit generate` against a scratch copy reported no schema changes. The snapshot `id`/`prevId` chain is unbroken. CI applies the real migration SQL to a fresh pgvector database twice, the second time as an idempotency check.
- **Careful concurrency engineering on the main paths.**
  - Every cron runs under its own advisory lock, with a documented key registry.
  - Scheduled emails take an atomic claim before they send.
  - Plan-day links and missed-session recovery lock the plan-day row (`FOR UPDATE`) and re-check their guard.
  - The idempotency middleware claims its key atomically.
  - Strava token refresh is serialised per user across instances.
  - The recycle bin captures inside the same transaction as each delete.
  - Account erasure is idempotent and resumable, and it reaches the separate vector database.
- **Prompt-injection hygiene.**
  - A sweep of 30 prompt-building modules found athlete-authored text escaped and fenced as data almost everywhere. The one gap is the plan goal in plan generation (AI32).
  - Chat tools take `userId` from the request, never from model arguments. Their arguments are zod-validated, their date ranges capped at 92 days, and their result sizes capped.
- **Domain math as pure, shared code.**
  - Unit conversion, pacing, fuelling and load models are DB-free and used verbatim by client and server.
  - Their date math was checked by running it across DST, leap days and year boundaries.
  - The audit-M22 class of rounding drift is gone by construction: values are stored per 100 g, scaled by one shared function, and rounded once.
- **Accessibility basics are complete.**
  - A sweep of 406 buttons and triggers and 148 inputs, selects and switches found no unnamed control.
  - The streamed chat reply is `aria-busy` while it streams and announced once when it finishes. Stream errors go to a permanently mounted assertive live region.
- **A supply chain that is careful in CI.** Every action is pinned to a full commit SHA, permissions follow least privilege, there is no `pull_request_target`, and installs use `--ignore-scripts`. The production build is the gap (S4).

---

## Refuted findings

Seven findings did not survive verification. They are recorded here so they are not re-raised:

- **An 8-module runtime import cycle through the pg-boss registry** (`server/services/autoCoachQueue.ts:2`). The cycle exists, but no module-scope code reads a binding inside it. A future TDZ error would crash every boot and fail the Cypress job's boot of the built bundle before deploy. This is an architecture smell, not a defect.
- **A retired plan's single-plan view showing past post-cutoff days as "missed"** (`server/storage/timeline.ts:98`). This is documented, intended behaviour (`docs/client.md`), and the claimed impact was wrong.
- **The ad-hoc sheet dropping parsed set fields** (`client/src/components/workout-detail/AdhocLogSheet.tsx:171`). The fields it rebuilds without are never filled in on that path, so nothing is lost.
- **A retry after a 90 s AI timeout that cannot finish** (`server/ai/retry.ts:60`). A per-attempt timeout is never retried, because the message "timed out" does not match the retryable "timeout" substring.
- **AI evals covering only coach chat** (`test/evals/chatScenarios.eval.test.ts:14`). This is a coverage observation with no failure of its own. The provider adapter tests it said were missing already exist.
- **The USDA serving-unit mapping ignoring GDSN codes** (`server/services/nutrition/usdaClient.ts:153`). The behaviour is real, but it is already recorded as an open, deliberately deferred question in `docs/CALCULATION_AUDIT_2026-08-20.md`.
- **Garmin "Reconnect needed" offering no reconnect action** (`client/src/components/settings/GarminSection.tsx:44`). The forced disconnect-then-reconnect is deliberate (Garmin safety-stack layer 4), and the banner tells the athlete what to do.

---

## Coverage & honesty

- **What was read.**
  - All 18 mappers read every production file in their scope in full, apart from these disclosed skims: generated data (`raceRankingData.generated.ts`, `raceBenchmarks.generated.ts`), stock shadcn primitives in `client/src/components/ui/`, the migration snapshots, migrations 0000–0090 (which were scanned for destructive and data-bearing statements), and test files (described from their test names and mocks).
  - The lenses read selectively by design, and each records its sweep method in the cross-cutting notes above.
  -
- **How deep each verdict goes.** Verification depth depends on severity.
  - Every high or critical candidate got two independent verifiers, and their verdicts agree.
  - Mediums were checked by one verifier each, in batches of five, with a budget of about 35 tool calls.
  - Lows were checked by one quick-check verifier each, in batches of ten, with a budget of about 25.
  - The refutation rate came out at 2% (7 of 322). The 2026-08-31 lens findings were refuted at about 6%, and the 2026-09-04 mapper pass at about 11%. That suggests the single-vote passes lean permissive. Read the mediums as checked once against the code, and the lows as plausible and checked once. Expect a few lows to fall on closer inspection.
- **The run was interrupted.** It hit the account's usage limit twice. No discovery output was lost: completed agents were replayed from cache, and 16 discovery agents were restarted. The first-round verification design (two verifiers on every high, batches of four) was replaced by the cheaper one above. Only the first 28 findings ran under the original design, and their verdicts are kept.
- **Deduplication was judged by agents.** Three passes merged 69 reports that share a root cause. Related but distinct defects in the same function were kept apart on purpose. A few true duplicates may remain, and they would show up as two IDs whose fix is the same change.
- **Line dating is an approximation.** The 78% figure checks whether each finding's cited line, as text, was already present in the same file at `642fe2f`. It does not use `git blame`, because the clone is shallow and boundary commits would mis-date lines. A defect can also come from a change elsewhere, such as a caller, so this estimates where defects sit, not when they were introduced.
- **Nothing ran against a database or the network.** Storage SQL was reasoned about and checked against the existing real-Postgres integration tests, not executed. The Railway deprecation date (D4) comes from Railway's own documentation and was re-checked for this report. A small number of other provider-specific claims, such as the Gemini preview-model pricing in AI4, could not be checked offline and are marked as such in their rows.
- **Grades and health scores are judgement.** They follow the severity mix and the strengths each reviewer saw. As the executive summary explains, they are not comparable with the 2026-08-31 scores.
