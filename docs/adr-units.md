# ADR: Units on Stored Numeric Columns

- **Status:** Accepted
- **Date:** 2026-08-22
- **Decision owners:** Backend + client maintainers
- **Supersedes:** nothing. **Implements:** Phase 1 of `docs/CALCULATION_AUDIT_2026-08-20.md`

## Context

The August 2026 calculation audit found eight findings sharing one root cause: **no column
in this schema declares its unit anywhere a compiler or a reviewer can see it.** Units were
documented in prose comments, and prose does not fail a build.

Three separate 60× errors shipped behind a single column, `exercise_sets.time`:

| Where                                | What it believed | Evidence                                                    |
| ------------------------------------ | ---------------- | ----------------------------------------------------------- |
| The athlete-facing set editor         | minutes          | `fieldMeta.ts` — label `"Time (min)"`, hint `"Duration in minutes"`, step 1 |
| `plannedSessionEstimate.ts:265`       | minutes          | reads it into a variable named `explicitMin`                 |
| `workoutStructureSummary.ts`          | minutes          | rendered `` `${set.time}min` ``                              |
| `exerciseSetFormatter.ts:101`         | minutes          | renders `` `${n} min` `` into the coaching prompt            |
| `racePrediction/featureBuilder.ts:283` | minutes          | multiplies by 60 to reach seconds                            |
| The workout **structure** editor      | **seconds**      | field labelled `"Sec"`, `aria-label="duration in seconds"`   |
| `shared/schema/types/workouts.ts`     | **seconds**      | bound `max(86_400)` — seconds in a day                       |
| `shared/openapi.ts`                   | **seconds**      | `{ distance: 1000, time: 210 }` — a 3:30 1 km row            |

The majority reading is minutes, and that is what the athlete's own input produces, so
**minutes is canonical**. Everything in the right-hand group was wrong. A 45-second
transition entered the column as 45 *minutes* (C7); every auto-pulled MAF pace was 60×
too fast, rendering a 10 km hour-long run as `0:06/km` (H1); a 12-minute best rendered as
`"0:12"` in the weekly review (H2).

Two more columns were assumed canonical when they are not. `exercise_sets.weight` and
`exercise_sets.distance` are stored **in the athlete's own display unit at write time** —
the S5 sentinel in `shared/unitConversion.ts` documents this deliberately. Code that
appended a fixed `"m"` or `"kg"` was therefore wrong for every imperial athlete: a 400 m
carry stored as 1312 ft rendered as `"1312m"` (H16), and a pounds athlete's loads reached
the coaching model labelled as kilograms (M8).

## Decision

### 1. A column's unit lives in its name or its type. Never only in a comment.

In order of preference:

1. **Put it in the name.** `durationSeconds`, `distanceMeters`, `timeOfDayMin` already do
   this and none of them were involved in a unit bug.
2. **Put it in the type.** Where the name cannot change without a migration — as with
   `exercise_sets.time` — use the branded types in `shared/units.ts`.
3. **Only then** add a comment, as a supplement rather than the mechanism.

### 2. Canonical units, by column

| Column                          | Unit                       | Canonical? |
| ------------------------------- | -------------------------- | ---------- |
| `exercise_sets.time`            | **minutes**, may be fractional | yes    |
| `exercise_sets.plannedTime`     | minutes                    | yes        |
| `workout_logs.duration`         | minutes                    | yes        |
| `workout_logs.distanceMeters`   | metres                     | yes        |
| `workout_logs.timeOfDayMin`     | minutes from local midnight | yes       |
| `maf_test_results.durationSeconds` | seconds                 | yes        |
| structure block `durationSeconds`, `workSeconds`, `restSeconds` | seconds | yes |
| `exercise_sets.weight`          | the athlete's unit at write time (kg **or** lbs) | **no** |
| `exercise_sets.distance`        | the athlete's stored unit (m **or** ft) | **no** |

The last two rows are the important ones. They have no canonical unit, so any code
touching them must carry the athlete's preference alongside the number. `getStoredDistanceUnit`
is the accessor for distance; `weightUnit` / `weightLabel` for weight.

### 3. Seconds may not be assigned into a minutes field, or vice versa

Convert at the boundary with `secondsToMinutes` / `minutesToSeconds` from `shared/units.ts`.
The branded types make the assignment a compile error:

```ts
const metrics: MafTestMetrics = { durationSeconds: workout.duration };
//                                                 ^ Minutes is not assignable to Seconds
```

**What the brands do not catch:** a branded number is still a `number` to the arithmetic
operators, so `someMinutes + someSeconds` compiles. That gap is covered by rule 1 — an
identifier holding a duration ends in `Seconds` or `Minutes`, so mixed arithmetic is
visible on the line. This is a real limitation and is why the naming rule comes first.

### 4. No hardcoded unit suffix outside a formatter

`"kg"`, `"lbs"`, `"m"`, `"ft"`, `"min"` must not be interpolated next to a stored value.
Route through `formatWeight` / `formatDistance` / `formatMinutes`, or take the athlete's
preference as a **required** parameter.

Required, not defaulted. `serializeWorkoutStructure` now demands the distance preference
and `computeProgressionFlags` the weight unit, because a default is what produced H16 and
M8 — the code did not know the unit, guessed metric, and rendered the guess as fact.

## Consequences

- `exercise_sets.time` now holds fractional values (a 45-second step is `0.75`). Anything
  rendering it must go through `formatMinutes`, which shows sub-minute values as seconds
  rather than `"0.75min"`.
- The set-level zod bound moved from `max(86_400)` to `max(SET_TIME_MAX_MINUTES)` (1440).
  The old bound permitted a 60-day set and so could never catch a seconds value in a
  minutes field.
- The OpenAPI examples were corrected from seconds to minutes. They advertised the wrong
  unit to every API consumer reading the docs.
- `METRES_PER_MILE` is defined once, in `shared/units.ts`. `unitConversion.ts` derives
  `KM_TO_MILES` from it instead of carrying a second, slightly different literal (L6).

## L4 — decided and closed

**Whether to canonicalise stored weights and distances** (audit L4) is no longer open.
`server/services/unitSwitchDetection.ts` detects, per athlete, whether their legacy
`exercise_sets` rows show a unit switch; `script/backfill-legacy-unit-rows.ts` stamps only
the athletes `server/services/legacyUnitAudit.ts` clears as safe, re-checking the detector
immediately before writing (dry-run by default, `--apply` to write). Athletes flagged
`needs_split` or `needs_review` are left unstamped rather than guessed at.

Rule 2 still stands: those two columns are not canonical, and code must carry the
preference.
