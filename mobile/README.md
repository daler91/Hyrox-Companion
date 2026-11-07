# fitai mobile

The native app: Kotlin and Compose Multiplatform, Android first, iOS later.
The plan, phase by phase, is [docs/mobile-app-plan.md](../docs/mobile-app-plan.md).

Phase 2 has one module, `core`, holding the API models and their tests. Phase 3
adds `composeApp` (shared UI) and `androidApp`, and the Android and iOS targets.

## Build and test

Needs JDK 21. From this directory:

```sh
./gradlew :core:jvmTest
```

CI runs the same in `.github/workflows/mobile.yml`.

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
