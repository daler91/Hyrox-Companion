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
./gradlew :androidApp:assembleDebug     # debug APK
./gradlew ktlintCheck detekt            # lint (ktlintFormat fixes formatting)
```

CI runs these in `.github/workflows/mobile.yml`.

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
