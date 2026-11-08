# fitai mobile

The native app: Kotlin and Compose Multiplatform, Android first, iOS later.
The plan, phase by phase, is [docs/mobile-app-plan.md](../docs/mobile-app-plan.md).

Three modules, in the Android Gradle Plugin 9 layout:

- `androidApp`: the Android entry point only (application `com.fitai.coach`).
- `composeApp`: the shared Compose Multiplatform UI.
- `core`: the API models and client, the data layer (database, outbox,
  repositories) and the ported logic. It also has a JVM target, so its tests run
  on any machine without an Android SDK.

iOS targets join in Phase 7.

## Build and test

Needs JDK 21, and an Android SDK for the Android modules (`ANDROID_HOME`, or
`sdk.dir` in `local.properties`). From this directory:

```sh
./gradlew :core:jvmTest                 # core's tests, JVM only
./gradlew :composeApp:jvmTest           # UI logic, contrast, and the app end to end on the desktop JVM
./gradlew :composeApp:verifyRoborazziAndroidHostTest   # screenshots against the references
./gradlew :androidApp:assembleDebug     # debug APK
./gradlew ktlintCheck detekt            # lint (ktlintFormat fixes formatting)
```

CI runs these in `.github/workflows/mobile.yml`.

The Compose UI tests (`composeApp/src/jvmTest/.../ui/AppUiTest.kt`) render the
whole app on the desktop JVM, no emulator, over a real session and database and
a fake server (`AppHarness.kt`); `AccessibilityUiTest` fails on a control
without a label or under a 48 dp touch target, and `ContrastTest` on a token
pair under WCAG AA. The design system's screenshots (light and dark, font
scales up to 200%) are in `composeApp/src/androidHostTest/snapshots`; after an
intended change, `./gradlew :composeApp:recordRoborazziAndroidHostTest`
rewrites them for the commit.

detekt's findings in code written before it was added (the Phase 2 ports, which
mirror their TypeScript originals) are recorded in `core/detekt-baseline.xml`;
new code is held to the rules. ktlint follows `.editorconfig`.

Gradle checks every dependency and plugin it downloads against the SHA-256
sums in `gradle/verification-metadata.xml`, and fails the build on an artifact
that is missing from the file or does not match. After adding or upgrading a
dependency, plugin or target, regenerate it and review the diff:

```sh
./gradlew --write-verification-metadata sha256 :core:jvmTest
```

## Push notifications

Push uses Firebase Cloud Messaging, configured from the build rather than a
`google-services.json`: set `fitai.firebase.appId`, `fitai.firebase.apiKey`,
`fitai.firebase.projectId` and `fitai.firebase.senderId` (Gradle properties,
or `FIREBASE_APP_ID`, `FIREBASE_API_KEY`, `FIREBASE_PROJECT_ID` and
`FIREBASE_SENDER_ID`) from the Firebase console. A build without them has push
off, and Settings says so. The athlete turns push on in Settings, which is
where the notification permission is asked for; no token exists until then.
The server needs its FCM service account too (`server/fcmServiceAccount.ts`).

## Health Connect

Settings → Integrations connects Health Connect: the athlete grants the read
permissions (exercise sessions, heart rate, distance, active calories, and
background reads where Health Connect supports them), and the app reads what
changed since its last Changes API token and posts it to
`POST /api/v1/health-connect/sync`, which imports it like a device sync and
deduplicates it against Strava and Garmin (server/services/healthConnectImport.ts).
A WorkManager job syncs every few hours and when the app opens. The read is in
`core/.../health/HealthConnectSource.kt` (androidMain); the token handling and
upload in `HealthSync` (commonMain), with tests against a fake source.

Before release, Play Console needs the Health Connect permissions declaration;
the permissions rationale Health Connect shows is `HealthPermissionsRationaleActivity`.

## Releasing

Play App Signing holds the app signing key; CI signs bundles with the upload
key. Tagging a commit `mobile-v<major>.<minor>.<patch>` runs
`.github/workflows/mobile-release.yml`: it tests, builds the release bundle
(version name from the tag, version code `major·1,000,000 + minor·1,000 + patch`)
and uploads it to Play's internal track with Gradle Play Publisher, keeping the
bundle and its R8 mapping as a workflow artifact.

```sh
git tag mobile-v1.0.0 && git push origin mobile-v1.0.0
```

`.github/workflows/mobile-promote.yml` (run by hand) moves a release on:
internal → alpha (the closed test) → production as a staged rollout (e.g. 0.1,
then 0.5, then 1.0). Both workflows use the `play-store` environment's secrets
and variables, listed at the top of mobile-release.yml. Without the upload key a
release build is unsigned, which is all a local or PR build needs.

Play Console's questionnaires (Data safety, Health Connect, content rating,
app access) are answered in [docs/mobile-play-console.md](../docs/mobile-play-console.md).

## End-to-end flows (Maestro)

`maestro/` holds flows against staging: sign-in, every tab, logging a workout,
sign-out. `.github/workflows/mobile-e2e.yml` (run by hand) builds the debug app
with the staging Clerk key and server, boots an emulator and runs them,
uploading the JUnit report and screenshots. They sign in with a Clerk
development instance's test account (a `+clerk_test` address, code 424242)
whose account has finished setup and has a plan; the repository variables are
listed at the top of the workflow. Against a local emulator or phone:

```sh
maestro test maestro -e TEST_EMAIL=you+clerk_test@example.com -e TEST_CODE=424242
```

## Performance

Release builds are shrunk and optimised by R8 and ship a Baseline Profile
(`androidApp/src/release/generated/baselineProfiles`), which compiles the code
startup and the main screens run ahead of time. `baselineprofile/` generates it
and benchmarks cold startup and scrolling with Macrobenchmark, on a Gradle
Managed Device; both need a machine that can run an emulator, so CI runs them on
demand (`.github/workflows/mobile-performance.yml`), checks the results against
`baselineprofile/budgets.json`, and uploads the profile to commit. Locally:

```sh
./gradlew :androidApp:generateBaselineProfile
./gradlew :baselineprofile:pixel6Api34BenchmarkReleaseAndroidTest \
  -Pandroid.testInstrumentationRunnerArguments.androidx.benchmark.suppressErrors=EMULATOR
```

Past the sign-in screen, both sign in with a Clerk development instance's test
account (`-Pandroid.testInstrumentationRunnerArguments.fitaiTestEmail=you+clerk_test@example.com`,
code 424242) against a build made with that instance's key.

## API models

`core/src/commonMain/kotlin/com/fitai/coach/core/api/generated/` is generated
from [`docs/openapi.json`](../docs/openapi.json) by `script/kotlin-models/`.
Never edit it by hand. After an API change, from the repository root:

```sh
pnpm docs:openapi    # server Zod schemas → docs/openapi.json
pnpm mobile:models   # docs/openapi.json → Kotlin models + contract-test samples
```

The unit suite fails while the committed models differ from what the document
generates (`script/kotlin-models/generate.test.ts`).

What is generated:

- `model/`: one file per component schema: a data class, an enum or a typealias.
- `operation/`: one file per operation that has inline types: its request body
  (`…Request`), success response (`…Response`) and query parameters (`…Query`,
  with `toQueryParameters()`).
- `ApiEndpoints.kt`: an `ApiEndpoint<Request, Response>` object per operation,
  named by method and path (`GET /api/v1/workouts/{id}` → `GetWorkoutsById`), with
  its serializers, success status and a typed `path(...)` builder. The HTTP
  client is written against these.

Mapping rules worth knowing:

| Schema | Kotlin |
| --- | --- |
| Optional and nullable request field | `Patch<T> = Patch.Absent`: absent is omitted, `Patch.clear()` sends null |
| Other optional field | `T? = null` |
| Nullable response field | `T? = null`, even when required, so a missing one still decodes |
| String enum | an enum with an `Unknown` entry; unknown values decode as `Unknown` and `Unknown` is never sent |
| `integer` with int32 bounds | `Int`; without bounds, `Long` |
| Numeric enum of whole numbers | `Int` |
| `oneOf` / `anyOf` | `JsonElement` (error unions, "any JSON") |
| `allOf [ref, {nullable}]` | the referenced type, nullable |
| `allOf [ref, {properties}]` | one class with both sets of properties |
| Dates (`date-time`, `date`) | `String` (ISO 8601); the app layer parses them |

Encode and decode with `ApiJson` (`core/.../api/ApiJson.kt`): it ignores unknown
response fields, and omits request fields left at their defaults.

## Data and sync

`core/.../data/` is the offline layer. The database (Room, on the bundled
SQLite driver) is the source of truth: screens read Flows from repositories,
which serve the cache offline and refresh it from the API.

- **One database per user.** `SessionManager` opens the signed-in user's file
  (`fitai-<userId>.db`) at sign-in, after deleting any other user's file left
  on the device, so one athlete's queued writes can never be sent under
  another's account (the web's version of that bug is in `.jules/sentinel.md`).
  Signing out from Settings deletes the file; a session the server ends (a 401)
  keeps it for the same user's next sign-in.
- **The outbox.** A write changes the database and queues an outbox entry in
  one transaction. `SyncEngine` sends entries one at a time, oldest first,
  each with its own `X-Idempotency-Key` on every attempt. Its retry rules match
  the web's offline queue (`client/src/lib/offlineQueue.ts`); the class comment
  lists them. It runs when a write is queued, when the network comes back, when
  the app returns to the foreground, and after a failure with a backoff from
  5 s to 5 minutes.
- **Exercise-set edits** carry the optimistic lock
  (`client/src/lib/exerciseSetVersionLock.ts`): each PATCH sends the version the
  server last reported as `expectedVersion`. A 409 drops the edits queued for
  that set and refetches the workout, so the other device's change shows and is
  never overwritten. A refresh leaves a set with an unsent edit alone.

Rows store the server's JSON, decoded through the generated models, so a new
response field needs no migration. A change to the tables bumps the database
version and adds a migration; Room exports each version's schema to
`core/schemas/`, which is committed.

## Icons

The app uses the web's icon set, Lucide (brand kit §8). `pnpm mobile:icons`
generates the icons listed in `script/mobile-icons/generate.ts` from
lucide-react into `composeApp/.../ui/icons/generated/LucideIcons.kt`, and copies
Lucide's ISC licence into the app's resources. The unit suite fails while the
committed file differs from what lucide-react generates.

## Contract test

`ApiContractTest` decodes sample JSON for every endpoint
(`core/src/commonTest/resources/api-samples/`, generated with the models):
a minimal and a maximal response, and a "future" one with a field and enum
values the schema does not have, as a newer server could send. Every request
sample must also encode back to the same JSON.

## Ported logic and golden fixtures

Logic the app needs on-device (unit conversion while typing, plan-week dates,
nutrition totals, …) is ported from `shared/` TypeScript to Kotlin; which
modules, and why, is [docs/mobile-shared-logic.md](../docs/mobile-shared-logic.md).
A port is pinned to its original by golden fixtures:

- `script/mobile-fixtures/suites/*.ts` run the TypeScript functions over fixed
  inputs; `pnpm mobile:fixtures` writes `core/src/commonTest/resources/fixtures/<suite>.json`.
- A Kotlin test calls `assertFixtureSuite("<suite>") { input -> port(input) }`,
  which fails listing every case whose output differs.
- The unit suite fails while a committed fixture differs from what its suite
  produces now (`script/mobile-fixtures/fixtures.test.ts`), so changing the
  TypeScript forces regenerating the fixtures, and the Kotlin test then shows
  whether the port still matches.

JavaScript semantics Kotlin's defaults do not reproduce are in `core/.../js/`:
`jsRound` (`Math.round`: halves towards +∞, -0 kept), `jsToFixed` (`toFixed`
over the exact binary value, so `1.005` → `"1.00"`), `jsNumberToString`
(`String(n)`: `1`, not `1.0`) and `jsTrim` (JS's whitespace set). Use them,
never `kotlin.math.round`, `String.format`, `toString()` or `trim()`, in ported code.

Ported so far (packages under `com.fitai.coach.core`): `units`, `dates`, `plans`,
`notifications`, `nutrition`, `exercises` (with the generated exercise catalogue,
`pnpm mobile:catalogue`) and `structure`. The table in the inventory lists each
with its suites.
