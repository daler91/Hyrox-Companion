[Back to docs index](README.md)

# Android App Plan

**Status:** decided 2026-11-07. Android first; iOS later on the same foundation.
This replaces the generic packaging phases in [native-mobile.md](native-mobile.md) for Android.

## Decision

Build a **Capacitor** app with the **web build bundled into the APK**, **Clerk token auth**
(no cookies), **native FCM push**, **Health Connect**, and **App Links**. Write native Kotlin
where plugins fall short (Health Connect sync, the home-screen widget).

Why not the alternatives:

- **Trusted Web Activity (TWA).** Least work, since it is the website running in Chrome, but it
  caps what the app can be: no Health Connect, no widget, web push only, and none of it carries
  over to iOS. The auth work below is needed for iOS anyway.
- **Kotlin / Jetpack Compose rewrite.** The best possible native feel, but it means a second copy
  of a very large UI (timeline, analytics, coach chat, nutrition, plan builder, onboarding, ~15
  settings sections) that would lag the web app forever. Everything native we actually want is
  reachable from Capacitor through plugins and small Kotlin modules.

## Target architecture

```text
APK
 ├─ WebView at https://localhost  ← dist/public, bundled at build time
 │    └─ React app → fetch(VITE_API_BASE_URL + path, Authorization: Bearer <Clerk session JWT>)
 ├─ Capacitor plugins: push (FCM), haptics, filesystem + share, speech, browser, app (back / deep links)
 └─ Kotlin: Health Connect plugin, Glance widget
          │ HTTPS
          ▼
https://fitai.coach (Express)
   clerkMiddleware reads the Authorization header · CORS allows https://localhost and exposes the
   custom headers · CSRF check skipped for header-only auth · FCM sender beside web push
```

The web app keeps cookie auth, CSRF, its service worker and web push exactly as they are today.

## Phases

Phases 1–2 ship to the web first and change nothing for web users. That way the riskiest work
(auth) is proven in production before any APK exists.

### Phase 1: token auth on the server

1. **CORS** (`server/index.ts:148`). Add `https://localhost` (Capacitor's Android origin) through
   the existing `ALLOWED_ORIGINS` env var. Add
   `exposedHeaders: ["X-Next-Cursor", "X-Next-Cursor-Id", "X-AI-Budget-Warning", "Retry-After", "Content-Disposition"]`.
   The client reads all five (`lib/api/coaching.ts:116`, `lib/api/analytics.ts:155`,
   `hooks/chat/useBudgetWarning.ts:16`, `lib/queryClient.ts:154`, `pages/Analytics.tsx:98`), and
   cross-origin responses hide them unless they are exposed. Pagination and the AI budget warning
   would break silently.
2. **Clerk.** Pass `authorizedParties` (built from the same origin allowlist) to
   `clerkMiddleware()` (`server/clerkAuth.ts:71`) so session tokens minted for any other origin are
   rejected. Add `https://localhost` to the Clerk instance's `allowedOrigins` (Backend API
   instance update).
3. **CSRF** (`server/middleware/csrf.ts`). Skip the double-submit check when a request
   authenticated with an `Authorization: Bearer` header and carries no Clerk session cookie. A
   cross-site page cannot attach that header without a CORS preflight, which the allowlist refuses,
   so the header already proves what the CSRF token proves. Any request carrying a session cookie
   keeps the check. Tests: header-only mutation passes; cookie-only without a token gets 403;
   cookie plus header without a token gets 403.
4. **App version gate.** The app sends `X-App-Version`. The server logs it and answers
   `426 Upgrade Required` below a configured minimum, so old APKs can be retired (see Phase 8).

*Done when:* an integration test runs create/update/delete with only a bearer token and no
cookies, and the existing web test suites pass unchanged.

### Phase 2: client platform layer

1. **`client/src/lib/platform.ts`**: `isNativeApp()` (`Capacitor.isNativePlatform()`) and
   `apiUrl(path)` (prefix from `VITE_API_BASE_URL`, empty on the web).
2. **Route every request through it.** All traffic already funnels through three functions in
   `client/src/lib/queryClient.ts` (`getCsrfToken`, `apiRequest`, `getQueryFn`; `rawRequest` and
   the chat stream call `apiRequest`). The only other requests are the stray fetches in
   `hooks/usePushNotifications.ts:59` and `components/workout-detail/MigrationReviewCallout.tsx:47`.
   Add a lint rule banning a bare `fetch("/api` so new code cannot regress.
3. **Native auth.** On native, render `<ClerkProvider standardBrowser={false}>` (`App.tsx:253`).
   Clerk documents this as the cookie-less mode for Capacitor. Attach `await getToken()` as
   `Authorization` in the three queryClient functions, and skip the CSRF token fetch. Register
   the token getter from a small component inside `ClerkProvider`, because `queryClient` lives
   outside React.
4. **Session persistence (spike).** Keep the Clerk client token in Keystore-backed storage so
   users stay signed in. Follow Clerk's current Capacitor guidance. *Acceptance:* still signed in
   after force-stop and after reboot.
5. **Sign-in screen for native.** The Clerk modal's Google button does a browser redirect, and
   Google blocks OAuth inside WebViews. On native, build the screen with Clerk's `useSignIn` (email
   code / password) plus a native "Continue with Google" button. That button uses Android
   Credential Manager through a plugin such as `@capgo/capacitor-social-login`, then calls
   `clerk.authenticateWithGoogleOneTap({ token })`. This needs Clerk's Google connection on custom
   credentials sharing one web client ID, and an Android OAuth client registered with the Play
   App Signing SHA-1. The web keeps `SignInButton mode="modal"` (`pages/landing/Hero.tsx`,
   `CtaFooter.tsx`).
6. **Sign-out.** Also unregister the device push token, clear the stored Clerk token, and run
   `clearUserLocalData` (`lib/userLocalData.ts:111`), so a second user on the same phone never sees
   the first user's cached data or queued writes.

*Done when:* a web build with `VITE_API_BASE_URL` pointing at another origin works end-to-end in a
desktop browser. This is a cheap test of everything above before Android is involved.

### Phase 3: Android shell

1. **Scaffold.** Install `@capacitor/core`, `@capacitor/android`, `@capacitor/app`,
   `@capacitor/haptics`, `@capacitor/splash-screen`, `@capacitor/keyboard`, `@capacitor/browser`,
   `@capacitor/filesystem`, `@capacitor/share` and `@capacitor/cli` (dev), then run
   `cap init fitai com.fitai.coach --web-dir dist/public` and `cap add android`. Commit
   `android/`: it becomes source once Kotlin is added.
2. **`capacitor.config.ts`.** Set `SystemBars.insetsHandling: "native"` and
   `initialViewportFitValueHint: "cover"`, and call `EdgeToEdge.enable(this)` in
   `MainActivity.onCreate`. `native` mode keeps the existing `env(safe-area-inset-*)` padding
   correct on both old (< Chromium 140) and new WebViews, so no CSS changes are needed. Status-bar
   icon style follows the theme.
3. **Build script.** `build:android` builds the web app with
   `VITE_API_BASE_URL=https://fitai.coach`, then runs `cap sync android`.
4. **Content Security Policy.** The server's nonce CSP (`server/middleware/csp.ts`) never reaches
   a bundled `index.html`. Inject a `<meta>` CSP for native builds from a Vite `transformIndexHtml`
   hook; `connect-src` covers the API, Clerk's Frontend API and Sentry.
5. **Service worker.** Don't register it on native (`main.tsx`, `shouldRegisterServiceWorkers`).
   The assets are local; a worker would only add staleness.
6. **Back button.** Listen for `App.addListener("backButton")`. Close the top Radix overlay first
   (dispatch Escape), otherwise `history.back()`, and at the root `App.minimizeApp()`.
7. **Keyboard.** Check that the chat composer and workout editor stay above the keyboard; add
   `@capacitor/keyboard` config if they don't.
8. **Icons and splash.** Generate with `@capacitor/assets` from the brand mark: an adaptive icon
   (mark on `#C4F37E`, matching `icon-maskable-512.png`), a monochrome themed icon, a white
   notification icon, and an Android 12+ splash.
9. **External links.** Open them in Custom Tabs via `@capacitor/browser`.

*Done when:* a debug APK on a physical phone can sign in, log a workout, stream a coach reply,
show analytics, and sign out and back in as a different user with no data bleed.

### Phase 4: features the WebView breaks

| Feature | Where | Problem | Fix |
| --- | --- | --- | --- |
| Data export | `settings/data-tools/ExportDataCard.tsx:21,31` | WebViews ignore `Content-Disposition` downloads | `rawRequest` → `@capacitor/filesystem` (cache dir) → `@capacitor/share` |
| Voice input | `hooks/voice/speechRecognition.ts` | Android WebView has no `SpeechRecognition`, so the button hides | Native recogniser behind the same interface (`@capacitor-community/speech-recognition`), `RECORD_AUDIO` prompt |
| Haptics | `lib/haptics.ts` | `navigator.vibrate` only gives a crude buzz | `@capacitor/haptics` impact styles on native; one file |
| Photo inputs | `ImageCaptureButton.tsx`, timeline / coaching file inputs | Capacitor's file chooser handles `capture`, but needs a camera permission | Verify on device; consider `@capacitor/camera` for the system photo picker |
| Offline reads | service worker `api-cache` (`vite.config.ts`) | Gone on native | Persist TanStack Query to IndexedDB, keyed per user and wiped by `clearUserLocalData`. The offline write queue (`lib/offlineQueue.ts`) works unchanged |

### Phase 5: native push (FCM)

1. **Firebase.** Create the project. Inject `google-services.json` into CI builds from a secret.
2. **Schema.** Add a `device_push_tokens` table (`id`, `user_id` → `users` on delete cascade,
   `platform`, unique `token`, `app_version`, `created_at`, `last_seen_at`) beside
   `push_subscriptions` (`shared/schema/tables.ts:1633`). Generate the migration with
   `pnpm db:generate`. Account erasure is covered by the cascade; add the table to the GDPR export
   map.
3. **Routes** (`server/routes/push.ts`). `POST /api/v1/push/devices` (upsert; Zod-validated,
   rate-limited) and `DELETE /api/v1/push/devices` (token in the body).
4. **Sender.** `sendPushToUser` (`server/pushNotifications.ts:140`) is the single funnel for
   nutrition reminders, the email scheduler and the test push. It also sends to device tokens
   through FCM HTTP v1, and prunes tokens on `UNREGISTERED` / `INVALID_ARGUMENT`. Add a server-only
   `FCM_SERVICE_ACCOUNT_JSON` to `server/env.ts` and `docs/env-reference.md`. The payload carries
   `title` / `body` and `data.url`.
5. **Client.** Add a native branch in `usePushNotifications.ts` via
   `@capacitor/push-notifications`. Ask for the Android 13+ notification permission from the
   existing Settings toggle, never at launch. Create channels: Training reminders, Coach,
   Nutrition. When a notification is tapped, navigate with wouter after the same path check
   `client/public/sw-push.js` applies (`toSameOriginUrl`).

*Done when:* a nutrition reminder and a missed-workout push arrive on a locked phone and open the
right screen, and a token from an uninstalled app is pruned on the next send.

### Phase 6: App Links and Strava

1. **`/.well-known/assetlinks.json`.** Serve it from Express ahead of auth, as
   `application/json`, listing the Play App Signing and upload-key SHA-256 fingerprints.
2. **Intent filter.** Add `android:autoVerify="true"` for `https://fitai.coach` app paths (not
   `/api/*`), so links in emails (reminders, weekly review) open the app. Route them with
   `App.addListener("appUrlOpen")` → wouter.
3. **Strava connect.** `handleStravaAuth` (`server/strava.ts:366`) binds the OAuth state to a
   `__Host-` cookie, and the callback requires it. In the app, the flow runs in a Custom Tab whose
   cookies are not the WebView's, so the binding cannot work. It must not simply be dropped,
   though: it is what stops an attacker's link from attaching a victim's Strava account to the
   attacker's fitai account. The native flow keeps an equivalent check:
   1. The app generates a random verifier and calls
      `GET /api/v1/strava/auth?client=android&challenge=<sha256(verifier)>` with its bearer token.
      The signed state carries the user id, the client and the challenge.
   2. Custom Tab → Strava → `/api/v1/strava/callback`. For an Android state, the server holds the
      pending link (encrypted) under a single-use, short-TTL completion code. It then redirects to
      the App Link `https://fitai.coach/strava/return?c=<code>`. That page also shows an
      "Open fitai" button in case the hand-off from the Custom Tab doesn't fire.
   3. The app calls `POST /api/v1/strava/complete { code, verifier }` with its bearer token. The
      server links the account only if the token's user matches the state's user and the verifier
      hashes to the challenge.

   Tests: mismatched user, wrong verifier, reused code, expired code.
4. **Garmin** works unchanged, since its credentials live on the server.

### Phase 7: Health Connect

This is the main reason to be native.

1. **What to read.** Exercise sessions, plus heart rate, distance and active calories. They go
   through a new batch endpoint into the same import and reconcile path Strava uses
   (`server/services/stravaMapper.ts`, `stravaReconciler.ts`). Deduplicate against Strava and
   Garmin imports by overlapping time window and source priority, so a session that reaches the
   server several ways lands once.
2. **Plugin.** Write a thin custom Kotlin Capacitor plugin (Health Connect client plus the Changes
   API for incremental reads) rather than a general-purpose community plugin. We need only a few
   record types, and we want full control of permissions.
3. **Sync timing.** v1 syncs when the app opens or resumes; the Changes API makes that cheap. A
   true background upload would need a credential usable from native code, outside Clerk's
   60-second JS tokens. That is a separate decision.
4. **Play requirements.** Fill in the Health Connect permissions declaration in Play Console. The
   privacy policy must cover health data. The app needs the permissions-rationale activity and an
   availability check (Health Connect is built into Android 14+; on Android 9–13 it is a separate
   app).
5. **Optional.** Write completed fitai workouts back to Health Connect.

### Phase 8: quality and release

- **Crash reporting.** `@sentry/capacitor` wrapping `@sentry/react`, still gated by the consent
  flow in `lib/errorReporting.ts`.
- **Tests.** Vitest for every server and client change above. Maestro flows on an emulator in CI
  (sign-in, log workout, push permission, back button). A manual device matrix: oldest supported
  WebView, current Android versions, a small screen, a Samsung phone.
- **CI.** Build the web app with `VITE_API_BASE_URL`, run `cap sync android`, then
  `./gradlew bundleRelease` with the upload key from secrets. Upload the AAB to the Play internal
  track. Take `versionCode` from the run number.
- **Play Console.**
  - Developer account, Play App Signing, and the current target-API requirement.
  - Data safety form: health and fitness data, personal info, photos, audio (voice input), crash
    data, AI processors.
  - Privacy policy URL.
  - A web link for account-deletion requests. Play requires one in addition to the in-app
    `AccountDangerZone`.
  - Content rating and a reviewer login.
- **Closed testing.** New personal developer accounts must run a closed test with at least 12
  testers for 14 days before production access. Start recruiting during Phase 3.
- **Compatibility.** Web deploys reach old APKs immediately, so `/api/v1` changes must stay
  additive. The Phase 1 version gate, plus a Play In-App Updates prompt, retires old builds.

### After launch

- Glance home-screen widget, "Today's session". The web app writes a small summary to native
  storage when the timeline loads, and the widget reads that, so the widget holds no credentials.
- App shortcuts: Log workout, Ask coach.
- A Wear OS tile.

## Open decisions for the owner

| Decision | Default in this plan |
| --- | --- |
| Application ID (permanent once published) | `com.fitai.coach` |
| Google sign-in in v1 | Yes, through native Credential Manager (Phase 2.5); otherwise email code only |
| Health Connect scope | Read only; write-back later |
| Garmin in the Play build | Keep. It uses an unofficial library with the user's Garmin password; revisit once Health Connect lands |
| Over-the-air web-bundle updates | Not in v1. Play allows JS updates to WebView content, but it is another signed delivery channel to run |
