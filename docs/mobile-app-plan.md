[Back to docs index](README.md)

# Mobile App Plan: Compose Multiplatform

**Status:** decided 2026-11-07.

The mobile app is native: Kotlin with **Compose Multiplatform** (CMP). **Android ships first**;
iOS comes later from the same code. The web app (PWA) stays as it is and remains the
full-featured client. This replaces the Capacitor recommendation in
[native-mobile.md](native-mobile.md).

## Decision

One Kotlin codebase holds the UI, state and data layer for Android and, later, iOS. That gives
native feel and performance (long timelines, charts, gestures) and direct access to Health
Connect, FCM, WorkManager, Glance widgets and Wear OS.

Considered and rejected:

- **Capacitor.** Reuses the web UI, but the app stays a WebView, with its limits on scroll and
  chart performance and on background work.
- **Android-only Kotlin.** iOS would then need a third UI, alongside the web and the Android app.
- **Trusted Web Activity.** No access to native APIs.

## The cost, and how the plan contains it

Going native means two UIs from now on: the React web app and the Kotlin app. The web client is
~72,600 lines (tests excluded) in 549 files, and in the month of history checked (Oct 5 – Nov 7,
2026) 43 commits touched it. Three rules keep the two from drifting apart:

1. **The server computes; the app renders.** Domain calculations stay on the server, and the app
   displays what the API returns. Logic is ported to Kotlin only when the app needs it offline or
   while the user types, and every port is pinned to its TypeScript original by shared golden
   fixtures (Phase 2).
2. **A generated contract.** The app's API models are generated from the server's OpenAPI
   document, and CI fails on breaking API changes. Today `docs/openapi.json` covers 6 operations
   on 3 paths, out of ~140 endpoints (`docs/api-reference.md`). Completing it is Phase 1 work.
3. **A scoped v1.** The app covers daily training use; the long tail stays on the web (see the
   scope table in Phase 4). Every web feature PR states its mobile impact.

## Architecture

```text
mobile/                         Gradle build, Android Gradle Plugin 9 layout
├─ androidApp/                  Android entry point only: Application (Clerk init), MainActivity,
│                               manifest, FCM service, Glance widget receiver
├─ composeApp/                  KMP library (com.android.kotlin.multiplatform.library)
│  ├─ commonMain/               Compose UI, navigation, ViewModels, design system
│  └─ androidMain/, iosMain/    platform actuals: haptics, share, speech, pickers
├─ core/                        KMP library
│  ├─ commonMain/               API client (Ktor + generated models), Room database,
│  │                            sync engine + outbox, AuthTokenProvider / HealthDataSource ports
│  └─ androidMain/, iosMain/    Health Connect / HealthKit, platform HTTP engines
└─ iosApp/                      (later) Xcode host and Swift auth bridge
```

Under AGP 9, the Kotlin Multiplatform plugin can no longer share a module with
`com.android.application`. The Android entry point therefore lives in its own module, as
JetBrains' recommended project structure describes.

The app lives in this repository, so one PR can change an endpoint, its contract and the app
together. A separate CI workflow is path-filtered to `mobile/**`, `shared/**` and
`docs/openapi.json`.

### Stack

| Concern | Choice | Notes |
| --- | --- | --- |
| UI | Compose Multiplatform + Material 3 | Brand theme from `docs/BrandKit/BRAND.md` and the tokens in `client/src/index.css`. Geist, Geist Mono and Space Grotesk bundled as Compose resources |
| Navigation | Navigation 3 (multiplatform) | Type-safe routes; deep links for App Links and notification taps |
| State | AndroidX ViewModel (KMP) + Kotlin Flow | |
| Dependency injection | Koin | |
| Networking | Ktor client + kotlinx.serialization | Coach replies stream as SSE `data: <json>` lines (`server/routes/ai.ts:847`), today parsed by `client/src/lib/sseStream.ts` |
| Local data | Room (KMP) | Offline source of truth for timeline, workouts, plan and food log |
| Preferences | DataStore (KMP) | |
| Auth | Clerk Android SDK | Native email code and native Google sign-in (Credential Manager); `Clerk.auth.getToken()` (60 s TTL, refreshed by the SDK) sent as the bearer token |
| Images | Coil 3 | |
| Charts | Vico (multiplatform) for standard charts; Compose Canvas for bespoke ones | Chosen in the Phase 0 spike |
| Coach markdown | A Compose Multiplatform markdown renderer | No raw HTML; links open in Custom Tabs (the web sanitizes with `rehype-sanitize`) |
| Dates | kotlinx-datetime | |
| Error reporting | Sentry Kotlin Multiplatform | Starts only after consent, as on the web (`server/routes/consent.ts`, `client/src/lib/errorReporting.ts`) |
| Tests | kotlin.test, Compose UI tests, Roborazzi screenshots, Maestro end to end | |

## Phases

### Phase 0: spikes

Prove the risky parts before fixing the structure. Each spike has a pass bar.

1. **Auth.** The Clerk Android SDK signs in with an email code and with native Google sign-in;
   its token is accepted by `clerkMiddleware()` (`server/clerkAuth.ts:71`); the session survives
   force-stop and reboot.
2. **Streaming chat.** A coach reply streams over Ktor SSE and renders markdown incrementally
   without dropped frames.
3. **Performance.** A timeline of 1,000+ entries scrolls smoothly from Room with paging, and the
   chosen chart library renders the analytics overview on a mid-range phone.
4. **Multiplatform discipline.** The same `composeApp` screen compiles for the iOS simulator on a
   macOS CI runner, so Android-only APIs can't creep into `commonMain`.

### Phase 1: server work for native clients

All of this ships to production first. The web is unaffected.

1. **CSRF for bearer-authenticated requests** (`server/middleware/csrf.ts`). Native HTTP sends no
   cookies, so the double-submit check would reject every mutation from the app. Skip the check
   when a request authenticated with an `Authorization: Bearer` header and carries no Clerk
   session cookie. A cross-site page cannot attach that header without a CORS preflight the
   allowlist refuses. Any request carrying a session cookie keeps the check. Tests: header-only
   mutation passes; cookie-only without a token gets 403; cookie plus header without a token
   gets 403. CORS itself needs no change, since native HTTP isn't subject to it.
2. **App version gate.** The app sends `X-App-Platform` and `X-App-Version`. The server logs them
   and answers `426 Upgrade Required` below a configured minimum per platform.
3. **A complete OpenAPI document.**
   - Register every endpoint in the Zod-backed registry (`shared/openapi.ts`, generated by
     `script/generate-openapi.ts`), starting with the ones v1 uses.
   - Include the chat SSE event schemas and both error envelopes in use, `{code, message,
     details}` and `{error, code}` (CODEBASE_ANALYSIS_2026-08-31 A6). Unify them if that turns out
     cheaper than documenting both.
   - CI already fails when `docs/openapi.json` is stale (`.github/workflows/build.yml:47`). Add a
     test in the style of `test/docs/docsSync.test.ts` that fails when a route has no OpenAPI
     entry.
   - Add an `oasdiff` breaking-change check against `main`, so a server change that would break
     shipped apps fails CI.
4. **Device push tokens.**
   - Add a `device_push_tokens` table (`id`, `user_id` → `users` on delete cascade, `platform`,
     unique `token`, `app_version`, `created_at`, `last_seen_at`) beside `push_subscriptions`
     (`shared/schema/tables.ts:1633`), and add it to the GDPR export.
   - Add `POST` and `DELETE /api/v1/push/devices` in `server/routes/push.ts`.
   - `sendPushToUser` (`server/pushNotifications.ts:140`) is the single funnel for every push. It
     also sends through FCM HTTP v1 and prunes tokens on `UNREGISTERED` / `INVALID_ARGUMENT`. FCM
     also delivers to iOS once an APNs key is uploaded, so one sender covers both platforms.
   - Add a server-only `FCM_SERVICE_ACCOUNT_JSON` to `server/env.ts` and
     `docs/env-reference.md`.
5. **Strava connect for the app.** `handleStravaAuth` (`server/strava.ts:366`) binds the OAuth
   state to a `__Host-` cookie that the app's Custom Tab won't have. That binding is what stops an
   attacker's link from attaching a victim's Strava account to the attacker's account, so the
   native flow replaces it with an equivalent check rather than dropping it:
   1. The app sends `sha256(verifier)` with its bearer token, and the signed state carries it.
   2. For a native state, the callback holds the pending link (encrypted) under a single-use,
      short-TTL code, then redirects to an App Link.
   3. The app redeems the code with its token and the verifier. The server links the account only
      if the token's user matches the state's user and the verifier matches.

   Tests: mismatched user, wrong verifier, reused code, expired code.
6. **`/.well-known/assetlinks.json`.** Serve it ahead of auth, listing the Play App Signing and
   upload-key SHA-256 fingerprints.

*Done when:* an integration test drives create/update/delete with only a bearer token, and the
OpenAPI document covers every endpoint v1 calls.

### Phase 2: contract and shared logic

1. **Generated models.** Generate Kotlin models (kotlinx.serialization) from
   `docs/openapi.json` into `core`, with a thin hand-written Ktor layer on top for auth, retries
   and SSE. CI regenerates the models and fails on drift.
2. **Inventory of client-side logic.** The web client imports 37 `@shared/*` modules. Put each in
   one of three buckets: rendering only; needed in the app (port it to `core/commonMain`); or
   better served by an API field (add the field instead).
   - Likely ports: unit conversion and formatting (`shared/unitConversion`, `shared/units`), date
     utils.
   - Likely API fields: fuelling and nutrition targets, MAF, planned-session estimates.
3. **Golden fixtures.** `script/mobile-fixtures.ts` runs the TypeScript implementations over a
   fixed input set and writes JSON into `mobile/core/src/commonTest/resources/`. Kotlin tests
   assert identical output, and CI regenerates the fixtures and fails on diff. A math change on
   one side without the other then goes red, instead of shipping the kind of bug the unit
   normalizer once had (`80-90kg` became `80-198 lbs`).

### Phase 3: app foundation

1. **Project.** Create the `mobile/` Gradle build in the layout above, with a version catalog,
   ktlint and detekt. A `mobile.yml` workflow builds a debug APK, runs tests and lint, and
   compiles the iOS targets on macOS.
2. **Design system.**
   - Port the tokens (light/dark colours, type scale, radii, spacing, motion) from the brand kit.
   - Build the core components: buttons, cards, inputs, sheets, dialogs, chips, toasts, and
     loading / empty / error states.
   - Screenshot-test them in light and dark, at font scales 1.0, 1.5 and 2.0.
3. **Auth plumbing.**
   - Initialize the Clerk SDK in `androidApp`.
   - Define a common `AuthTokenProvider` interface: the Clerk SDK implements it on Android, a
     Swift bridge on iOS later.
   - A Ktor plugin attaches the bearer token and the version headers. A 401 sends the user to
     sign-in; a 426 triggers a Play In-App Updates prompt.
4. **Sign-in and sign-up.** Email code plus native Google sign-in, using Clerk's native flows.
5. **First-run privacy notice.** Consent is recorded through the existing consent API.
6. **Navigation shell.** A bottom bar matching the web: Training, Log Workout, Nutrition,
   Analytics, Settings (`client/src/lib/navItems.ts`). The coach opens as a panel, as
   `CoachPanel.tsx` does on the web.
7. **Sync engine.**
   - Room is the source of truth; repositories expose Flows and refresh from the network.
   - An ordered outbox replays mutations made offline.
   - The database file is per user and is deleted at sign-out. That rules out the cross-account
     replay bug the web's offline queue once had (`.jules/sentinel.md`).
   - Exercise-set PATCHes carry `version` and handle 409, as `client/src/lib/exerciseSetVersionLock.ts`
     does.
   - Add idempotency keys to any create endpoint where a replay could duplicate.

### Phase 4: v1 features

Built in order of daily use.

| Area | v1 | After launch | Stays on the web |
| --- | --- | --- | --- |
| Training timeline (`/`) | Timeline, workout detail, mark done / missed, plan view | Timeline annotations, drag to reschedule | |
| Log workout (`/log`) | Composer, exercise sets, RPE, photo-to-workout, voice input | | Bulk CSV import |
| Coach | Streaming chat, photo in chat, plan-change proposals | | RAG debug badge |
| Nutrition (`/nutrition`) | Food log, search, daily and per-meal targets | | |
| Analytics (`/analytics`) | Overview, personal records, exercise progression | Race predictor, session grades, fuelling, MAF, category breakdown, coach insights | |
| Weekly review (`/review`) | | Full review | |
| Onboarding | Wizard, including first plan generation | | |
| Settings | Profile and units, notifications, integrations, privacy, account deletion, sign-out | Preferences parity | Coaching materials upload, data tools |

### Phase 5: native integrations (Android)

- **Push.**
  - FCM with channels for Training reminders, Coach and Nutrition.
  - Ask for the notification permission from Settings, never at launch.
  - When a notification is tapped, deep-link only to app routes, with the same check
    `client/public/sw-push.js` applies (`toSameOriginUrl`).
- **Health Connect.**
  - Read exercise sessions, heart rate, distance and active calories through the Changes API.
  - Sync in the background with WorkManager. This is possible natively because the Clerk SDK can
    supply a token outside the UI.
  - Upload to a new ingest endpoint that reuses the Strava import and reconcile path
    (`server/services/stravaMapper.ts`, `stravaReconciler.ts`). Deduplicate against Strava and
    Garmin imports by time overlap and source priority.
  - Play Console needs the Health Connect permissions declaration, and the app needs a
    permissions-rationale activity.
- **Strava connect.** A Custom Tab plus an App Link, using the Phase 1 flow.
- **App Links.** Email links (reminders, weekly review) open the matching screen.
- **Voice input.** Android `SpeechRecognizer`.
- **Camera and photos.** The system Photo Picker and camera, with the image downscaled before
  upload, as `client/src/lib/image.ts` does on the web.
- **Small native touches.** Haptics; the share sheet for data export (`GET /api/v1/export` with
  the bearer token); Custom Tabs for external links.
- **Widget.** A Glance "Today's session" widget that reads from Room, so it needs no network and
  holds no credentials.

### Phase 6: quality and release

- **Tests.**
  - commonTest for repositories, the sync engine and the outbox (against a fake server), plus the
    fixture parity tests.
  - Compose UI tests and Roborazzi screenshots in CI.
  - Maestro flows against staging with a test Clerk account.
- **Performance.** Baseline Profiles and R8; startup and jank budgets tracked with Macrobenchmark.
- **Accessibility.** TalkBack labels, 48 dp touch targets, font scaling to 200%, contrast checks
  in the screenshot tests.
- **Release.**
  - Play App Signing; AABs built by CI on tags and uploaded to the internal track (Gradle Play
    Publisher); staged production rollouts.
  - New personal developer accounts must run a closed test with at least 12 testers for 14 days
    before production access. Recruit testers during Phase 4.
- **Play Console.**
  - Data safety form: health and fitness data, personal info, photos, audio, crash data, AI
    processors.
  - Privacy policy.
  - A web link for account-deletion requests, in addition to in-app deletion.
  - Health Connect declaration, content rating, a reviewer login, and the current target-API
    requirement.

### Phase 7: iOS (later)

- An `iosApp` Xcode host reusing `composeApp` and `core`.
- Clerk's iOS SDK is Swift-only, so it implements `AuthTokenProvider` in a Swift bridge that the
  Kotlin code calls.
- APNs through the same FCM sender (upload the APNs key). The server is unchanged.
- HealthKit implements `HealthDataSource`; the widget is WidgetKit (SwiftUI).
- Sign in with Apple, which App Store guideline 4.8 requires alongside Google sign-in.

## Milestones

| Milestone | Contents |
| --- | --- |
| M1: internal alpha | Phases 0–3; sign-in, timeline, workout detail, log workout, coach chat |
| M2: closed test | Rest of v1: nutrition, onboarding, analytics overview, push, Strava, Health Connect |
| M3: production | Phase 6 complete; 14-day closed test passed |
| M4: iOS | Phase 7 |

## Working agreement: keeping two clients in step

- Every web feature PR states its mobile impact: none, a follow-up issue (label
  `mobile-parity`), or included.
- `/api/v1` changes stay additive. The oasdiff gate enforces that, and the version gate retires
  old builds.
- New domain math goes on the server, or ships with fixture parity tests if the app needs it
  locally.

## Open decisions for the owner

| Decision | Default in this plan |
| --- | --- |
| Application ID (permanent once published) | `com.fitai.coach` |
| Google sign-in | Yes, native Credential Manager |
| v1 analytics depth | Overview, personal records, exercise progression |
| Health Connect scope | Read only; write-back later |
| Garmin | Unchanged; it runs server-side. Revisit once Health Connect lands |
| Where the app lives | `mobile/` in this repository |
| When iOS starts | After the Android production launch |
