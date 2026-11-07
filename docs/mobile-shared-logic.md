[Back to docs index](README.md)

# Mobile App: Shared Logic Inventory

**Status:** inventory for Phase 2, step 2 of [mobile-app-plan.md](mobile-app-plan.md), taken
2026-11-07 against the web client as it stands.

## What this is

The web client imports 37 distinct `@shared/*` modules:

```sh
grep -rhoE 'from "@shared/[^"]+"' client/src --include=*.ts --include=*.tsx | sort | uniq -c | sort -rn
```

Rule 1 of the plan is that the server computes and the app renders. This document puts each module
in one of three buckets, based on how the client actually calls it, not on the fact that it is
imported:

- **render.** The app only formats, labels or types what it gets. It reimplements this in Compose,
  or gets it from the generated models. Nothing is ported.
- **port.** The app needs the logic on the device: offline against Room, while the athlete types,
  or because the result has to match the server's number exactly. Only the named functions are
  ported, to `core/commonMain`, and each is pinned by golden fixtures (Phase 2, step 3).
- **api.** The client computes something the server could return. Add the field, and the app
  renders it.

`@shared/schema` and its subpaths count as one entry, which leaves 33 entries:

| Bucket | Entries (33) | Modules counted separately (37) |
| --- | --- | --- |
| port | 10 | 12 (`schema/exercises`, `schema/structureLint` and `schema/micros` count individually) |
| api | 11 | 11 |
| render | 12 | 14 (the `schema` barrel and `schema/enums` count individually) |

How this feeds the rest of Phase 2:

- The **Port list** below is the input to `script/mobile-fixtures.ts`. Each ported module lists the
  exact functions, what they pull in from `shared/`, and the fixture inputs.
- **API fields to add** is server work in the style of Phase 1. Each field has to ship before the
  app screen that reads it.
- **render** modules need nothing beyond step 1 (generated models). Their limits and enums are
  already in `docs/openapi.json`, as noted in each entry.

How it was checked:

- Each importing client file was read. Re-exports count: `suggestNextTarget` reaches the client
  through `client/src/components/workout-detail/exercise-table/nextTarget.ts`, so the import grep
  shows only `type NextTarget`.
- Server use was found by grepping non-test files in `server/`. Some modules reach the server only
  through the `@shared/schema` barrel, and those count too.
- Client paths below are relative to `client/src/`.

## Summary table

| Module | Lines | Bucket | Exports needed (port) / endpoint (api) | Reason |
| --- | --- | --- | --- | --- |
| `unitConversion` | 1046 | port | `standardizeWeightUnit`, `standardizeDistanceUnit`, `standardizeParsedDistanceUnit`, `getStoredDistanceUnit`, `convertWeight`, `kgToUserWeight`, `userWeightToKg`, `metersToUserDistance`, `userDistanceToMeters`, `cmToFtIn`, `ftInToCm`, `roundStoredWeight`, `roundStoredDistance`, `stampForPreferences`, `storedWeightToDisplay`, `storedDistanceToDisplay`, `restampSetPatch`, `getWorkoutDistanceDisplay`, `displayDistanceToStored` | Each set row carries its own unit stamp. Room rows have to be converted for display offline, and a weight, distance or height the athlete types has to be converted before save, exactly as the server does it |
| `dateUtils` | 179 | port | `dayDiff`, `planSpanWeeks`, `computePlanWeeks`, `MIN_PLAN_WEEKS`, `MAX_PLAN_WEEKS`, `planWeekOneMonday`, `weekdayIndex`, `weekdayName`, `PLAN_WEEKDAYS`, `nextPlanStartDate`, `weekOneDaysBeforeStart`, `isIsoCalendarDate`, `addDaysToISODate` | The plan form checks the week count while the athlete picks dates, using the rule the Zod schema applies on the server. An optimistic move stamps the weekday the server will |
| `nutritionScaling` | 170 | port | `scaleNutrition`, `roundMacros`, `totalNutrition`, `emptyTotals`, `addInto`, `KCAL_PER_G*` | The food log works offline from Room. The quantity-edit preview must equal what the server stores (audit M22) |
| `mealFuelling` | 757 | port | `mergeMealOverride` only | The meal-target editor previews the merged figures as the athlete types. The server's `applyMealTargetOverrides` uses the same function |
| `sessionFuellingTargets` | 126 | port | `computeSessionFuellingTarget` | The fuelling panel recomputes on every duration or RPE stepper tap. The server returns the same calculation from `/session-fuelling/{workoutId}` |
| `progression` | 304 | port | `suggestNextTarget`, `unmetPrescription`, `epley` | The "Next" chip appears while logging, often offline at the gym. It must equal the target the workout engine writes into the plan |
| `exerciseEquipment` | 172 | port (dependency) | `implementFor`, `loadIncrement` | The client imports it only in a test, but `progression` needs it at runtime |
| `planPhase` | 141 | port | `computeCurrentWeek`, `computePlanPhase`, `PLAN_PHASE_ORDER` | "Week 6 of 12 · Build" depends on the device's today, so it must work offline. The coach's prompts use the same function |
| `notifyHours` | 75 | port | `resolveNotifyHour`, `fallbackNotifyHour`, `isValidNotifyHour`, `DEFAULT_NOTIFY_HOUR`, `BRIEF_TOMORROW_FROM_HOUR`, `NOTIFY_HOUR_FIELD` | Settings copy changes as the athlete picks an hour, and it must agree with the email scheduler |
| `schema*` | ~10.5k (dir) | port (mixed) | `schema/exercises`: `EXERCISE_DEFINITIONS`, `EXERCISE_NAME_ALIASES`, `normalizeExerciseName`, `isRunningExerciseName`, `knownExerciseLabel`. `schema/structureLint`: `lintWorkoutStructure`. `schema/micros`: `MICRO_DISPLAY_DEFS` (data, deferred). The barrel and `schema/enums`: render | The composer needs the exercise catalogue offline, and the outbox must not queue a structure the server will reject with a 400. The barrel is type-only in client code |
| `plannedSessionEstimate` | 519 | api | `GET /api/v1/timeline`: `sessionEstimate` on planned entries | The server already computes it per day, personalised by run pace. A port would also need the exercise catalogue and the athlete's run history |
| `nutritionTargets` | 756 | api | New `POST /api/v1/nutrition/targets/suggest`. `POST /api/v1/nutrition/targets` takes the periodisation choice | These functions run only in the browser today. The server stores whatever numbers it is sent |
| `maf` | 224 | api | `PATCH /api/v1/preferences` derives `mafHr`. `mafCompliance` on timeline and workout entries | The server already runs `calculateMafHr` on every preferences save, but stores the client's number |
| `fuellingCorrelation` | 152 | api | `GET /api/v1/nutrition/block`: `correlation` | Pure analytics over the response's own points. No server file imports it |
| `bodySystemLoad` | 163 | api | `GET /api/v1/training-overview`: `bodySystemLoad.divergence` | The server already builds the sentence for the AI analysis. Labels are render |
| `coachNotes` | 149 | api | `GET /api/v1/timeline`: parsed `coachNotes` | It parses a format the server writes, and its regexes depend on JS `\s` semantics |
| `deviceSportTypes` | 178 | api | `GET /api/v1/timeline`, `GET /api/v1/workouts/{id}`: `avgCadenceUnit` | The server owns the provider sport list, which Health Connect will extend |
| `planDayKind` | 46 | api | `GET /api/v1/timeline`: `dayKind` | The server already runs `isRestLikePlanDay` |
| `raceDay` | 10 | api | The same `dayKind` field | The server writes the race-day marker and already tests for it |
| `ratio` | 76 | api | `GET /api/v1/training-overview/summary`: `completionRate` | The Coach panel's rate is computed on the client, and the server computes a different one for the coach |
| `nutritionRange` | 13 | api | `GET /api/v1/nutrition/summary-range` clamps the range instead of rejecting it | The constant exists only so the client can narrow its own request. The response already echoes `from` and `to` |
| `units` | 107 | render | none | Unit brands are no-ops at runtime. `formatMinutes` is display, and `METRES_PER_MILE` ships with the `unitConversion` port |
| `formatClock` | 18 | render | none | `formatSecondsToClock` is display |
| `chat` | 41 | render | none | `docs/openapi.json` carries the limits and the status enum. The default photo prompt is UI copy |
| `weeklyReview` | 19 | render | none | `maxLength` 280 is in the contract. The Sunday 17:00 constant is for an after-launch prompt |
| `preferenceBounds` | 30 | render | none | The bounds are in the `UpdateUserPreferences` schema of the contract |
| `athleteFacts` | 151 | render | none | `maxLength` 140 is in the contract. `isAthleteFactDue` is `reviewOn <= today` |
| `missedRecovery` | 26 | render | none | `formatSessionLength` is copy |
| `sessionIntent` | 204 | render | none | A label switch plus types. Grading happens on the server |
| `stationCoverage` | 219 | render | none | `stationLabel` is a catalogue label. The server computes coverage |
| `inSequence` | 34 | render (n/a) | none | JS promise sequencing for the web offline queue. Kotlin uses coroutines |
| `bodySystemLoadTestFixtures` | 102 | render (n/a) | none | Test-only |
| `nutritionTestFixtures` | 33 | render (n/a) | none | Test-only |

## Port list

### Rules for every fixture

None of the ported functions call `Intl`, `toLocale*` or the local-time `Date` getters, and none
use a regex. Every output is reproducible, as long as the Kotlin side copies JS numeric behaviour:

- **`Math.round`.** JS rounds ties toward +∞ (`Math.round(-2.5)` is `-2`). Use `roundToLong()` /
  `roundToInt()`, which do the same. Never use `kotlin.math.round`, which rounds ties to even.
- **`toFixed(d)`.** JS rounds the exact binary value, ties away from zero, so `(1.005).toFixed(2)`
  is `"1.00"`. Use `BigDecimal(x).setScale(d, RoundingMode.HALF_UP)`, with the exact `double`
  constructor. `BigDecimal.valueOf` and `String.format` both give `"1.01"`.
- **Number to string** (`String(n)` and template literals). JS prints `1` and `10000000`, and
  switches to an exponent only at 1e21 (`"1e+21"`). Kotlin prints `1.0` and `1.0E7`. The port needs
  a `jsNumberToString` helper. Affected:
  - `unitConversion`'s `text` fields and formatters.
  - `units.formatMinutes`.
  - The `explanation` strings of `sessionFuellingTargets`.
- **Negative zero.** JS produces `-0` in several places:
  - `roundMacros(-0.05)`
  - `cmToFtIn(-1.27)`
  - `roundStoredWeight(-0.5, "lbs")`
  - `planSpanWeeks` when the end date is before the start

  JSON writes `-0` as `0`, so the Kotlin assertions should treat `-0.0` and `0.0` as equal.
- **Operation order.** Copy each expression exactly. For example, `KM_TO_MILES = 1000 / 1609.344` and
  `userDistanceToMeters` computes `(value / KM_TO_MILES) * 1000`. Writing it as `value * 1609.344`
  does not round the same way.
- **Negatives.** JS `%` takes the sign of the dividend, like Kotlin `rem`. Use `floor` on doubles
  where JS uses `Math.floor`. Kotlin integer division truncates (`-1 / 12` is `0`, where
  `Math.floor(-1 / 12)` is `-1`).

### `shared/unitConversion.ts`

Only 19 functions and the alias tables are needed. The text normaliser is not:
`normalizeWorkoutTextUnits`, its scanner (lines ~627–1046) and `shared/unitTextRanges.ts` (327
lines) run only on the server, over AI and plan text. No client file imports them. That is the code
where the plan's `80-90kg` → `80-198 lbs` bug lived, so the app does not need it.

**Functions:**

- Normalising units: `standardizeWeightUnit`, `standardizeDistanceUnit`,
  `standardizeParsedDistanceUnit`, `getStoredDistanceUnit`, with `WEIGHT_UNIT_ALIASES`,
  `DISTANCE_UNIT_ALIASES` and the private `PARSED_DISTANCE_UNIT_ALIASES`.
- Converting values the athlete types:
  - `convertWeight`: onboarding unit switch.
  - `kgToUserWeight` / `userWeightToKg`: bodyweight and goal rate, which are stored in kg.
  - `metersToUserDistance` / `userDistanceToMeters`: manual distance and MAF test form, stored in
    `distance_meters`.
  - `cmToFtIn` / `ftInToCm`: height.
- Rounding: `roundStoredWeight`, `roundStoredDistance`.
- Per-row unit stamps (audit L4): `stampForPreferences`, `storedWeightToDisplay`,
  `storedDistanceToDisplay`, `restampSetPatch`, with the private `parsedDistanceToMeters` and
  `metersToStoredDistance`. The web wraps them in `lib/setDisplay.ts` (`toPreferenceScale`) and in
  the optimistic patch in `hooks/useExerciseSetsForOwner.ts:187`. The app needs both for Room rows
  and outbox replays.
- Set-editor distance: `getWorkoutDistanceDisplay` and `displayDistanceToStored`, with the private
  `cleanWholeKilometerTarget` and `formatCompactNumber`.
- Constants: `KG_TO_LBS = 2.20462`, `M_TO_FT = 3.28084`, `FEET_PER_MILE = 5280`,
  `CLEAN_KILOMETER_TOLERANCE_METERS = 0.5`, `CM_PER_INCH`, `INCHES_PER_FOOT`.

**Depends on:** `shared/units.ts` (`METRES_PER_MILE = 1609.344`).

**Left as render:** `formatPace`, `formatSpeed`, `formatDistance`, `formatDistanceFromMeters`,
`paceSecondsPerUnit` and `formatNumberWithUnit`. These are display strings. If the web and the app
must print byte-identical text, they are cheap to add to the fixtures.

**Fixture inputs:**

- `standardize*`: `null`, `""`, `"KG"`, `" lbs "`, `"Pound"`, `"stone"`, `"mi"`, `"Miles"`,
  `"kilometre"`, `"m"`, `"ft"`, `"feet"`. `"kilometre"` is in the parsed table but not in
  `DISTANCE_UNIT_ALIASES`.
- `getStoredDistanceUnit`: `"miles"`, `"mi"`, `"km"`, `null`, `"ft"`. `"ft"` returns `"m"`, because
  it is not a preference alias.
- `convertWeight`: `(100,"kg","lbs")`, `(220.462,"lbs","kg")`, `(0,"kg","lbs")`, `(-5,"kg","lbs")`,
  `(100,"kg","stone")`, `(100,"KG","Pounds")`.
- `kgToUserWeight` / `userWeightToKg`: 70, 154.3, 0.1 and 500, in both units.
- `metersToUserDistance`: `(5000,"km")`, `(1609.344,"miles")`, `(42195,"miles")`, `(0,"km")`,
  `(-100,"km")`.
- `userDistanceToMeters`: `(1,"miles")`, `(26.2,"miles")`, `(5,"km")`, `(0.1,"km")`.
- `cmToFtIn`:
  - 180, 182.88, 152.4, 0.
  - 1.27: a half-inch tie, gives 1 in.
  - 3.81.
  - -2.54: gives `{feet:-1, inches:-1}`, from `Math.floor` and JS `%`.
  - -1.27: gives `-0`.
- `ftInToCm`: `(5,11)`, `(6,0)`, `(0,0)`, `(5,12)`, `(5,11.5)`.
- `roundStoredWeight`: `(102.25,"kg")` gives 102.5, `(102.24,"kg")`, `(-2.25,"kg")` gives -2,
  `(221.5,"lbs")`, `(-0.5,"lbs")`, `NaN`, `Infinity`.
- `roundStoredDistance`: 0.5, 1.5, -0.5, 999.5, `NaN`.
- `stampForPreferences`: `{}`, `{weightUnit:"lb", distanceUnit:"mi"}`,
  `{weightUnit:null, distanceUnit:"km"}`.
- `storedWeightToDisplay`:
  - 100, stamp kg, preference lbs: gives 220.
  - 100, stamp kg, preference kg.
  - 100, no stamp, preference lbs: a legacy row, passes through.
  - 225, stamp lbs, preference kg: gives 102.
  - 45, stamp lbs, preference kg: gives 20.5.
  - 100, stamp `"pounds"`, preference lbs.
- `storedDistanceToDisplay`:
  - 1000, stamp `"m"`, preference miles: gives 3281.
  - 5280, stamp `"ft"`, preference km: gives 1609.
  - 1, stamp `"km"`, preference km: gives 1000.
  - 500, stamp `"xyz"`, preference miles: an unknown stamp, gives the identity.
  - 100, no stamp, preference miles.
- `restampSetPatch`:
  - Existing `{weight:100, plannedWeight:100, weightUnit:"kg"}`, patch `{weight:225}`, preference
    lbs. `plannedWeight` is converted to 220.
  - Patch `{weight:null}`: an explicit null counts as touching the axis.
  - Patch `{plannedDistance:1000}` on an `"m"` row, preference miles, with `distance` untouched.
  - A legacy row with no stamps.
  - An empty patch.
- `getWorkoutDistanceDisplay`:
  - `(1000,"km")`, `(1000.4,"km")`.
  - `(1e7,"km")`: gives `"10000000 m"`.
  - `(3280.84,"miles")` and `(3281,"miles")`: both give `"1000 m"`, the clean-kilometre snap within
    0.5 m.
  - `(5280,"miles")`: gives `"1 mi"`.
  - `(7920,"miles")`: gives `"1.5 mi"`.
  - `(5306.4,"miles")`: gives `"1 mi"`. This is `toFixed(2)` of 1.005. Java's `String.format`
    gives `"1.01"`.
  - `(5279.9,"miles")`: gives `"5280 ft"`, not miles.
  - `(1640.42,"miles")`, `(100,"miles")`, `(0,"miles")`.
  - `(-3280.84,"miles")`: gives `"-1000 m"`.
- `displayDistanceToStored`:
  - `(1,"mi","miles")`: gives 5280.
  - `(1,"mi","km")`: gives 1609.
  - `(500,"ft","km")`: gives 152.
  - `(1000,"m","miles")`: gives 3281.
  - `(0.5,"mi","miles")`.

### `shared/dateUtils.ts`

**Functions:** `dayDiff`, `planSpanWeeks`, `computePlanWeeks`, `MIN_PLAN_WEEKS`, `MAX_PLAN_WEEKS`,
`planWeekOneMonday`, `weekdayIndex`, `weekdayName`, `PLAN_WEEKDAYS`, `nextPlanStartDate`,
`weekOneDaysBeforeStart`, `isIsoCalendarDate`, `addDaysToISODate`, plus the private `toUtcEpoch`.
`describeWeekdaySpan` is prose (render). `toIsoDateUtc` and `parseIsoDate` are not used by the
client.

**Depends on:** nothing.

**Notes:**

- All the math is UTC on `YYYY-MM-DD` strings, so it does not depend on the timezone.
  kotlinx-datetime `LocalDate` maps onto it directly.
- JS has two quirks that `LocalDate` does not:
  - `Date.UTC` maps years 0–99 to 1900–1999, so `addDaysToISODate("0050-01-01", 0)` is
    `"1950-01-01"`.
  - `addDaysToISODate` does not zero-pad years under 1000: `"0100-01-01"` plus 0 days gives
    `"100-01-01"`.
- `isIsoCalendarDate` rejects both. Its behaviour is equivalent to `^\d{4}-\d{2}-\d{2}$`, plus a
  year of at least 100, plus a real calendar date. `LocalDate.parse` alone would accept 0050.

**Fixture inputs:**

- `dayDiff`:
  - `("2026-03-28","2026-03-30")`: EU DST change.
  - `("2026-10-31","2026-11-02")`: US DST change.
  - `("2026-01-01","2025-12-31")`: gives -1.
  - `("2024-02-28","2024-03-01")`: gives 2.
  - `("2100-02-28","2100-03-01")`: gives 1.
  - The same day twice: gives 0.
- `planSpanWeeks` and `computePlanWeeks`:
  - A Monday start plus 56, 59 and 60 days: gives 8, 8 and 9 (round, not ceil).
  - An end before the start, `("2026-11-12","2026-11-09")`: gives `-0`, and `computePlanWeeks`
    gives 1.
  - A 30-week span: `computePlanWeeks` gives 24.
  - `endDateIsRaceDate`, Wednesday start `2026-11-11`, Saturday race `2026-11-21`: gives 2.
  - `endDateIsRaceDate`, a Monday start with a Thursday race in week 1.
  - `endDateIsRaceDate`, a race before the start.
- `isIsoCalendarDate`:
  - `"2026-11-15"`, `"2024-02-29"`, `"2025-02-29"`, `"2026-02-30"`.
  - `"0099-12-31"`: false.
  - `"0100-01-01"`: true.
  - `"9999-12-31"`, `"20266-11-15"`, `"2026-1-5"`, `"2026-011-05"`.
  - `" 2026-11-15"`, `"2026-11-15 "`, `"2026-11-15T00:00"`, `""`, `"abcd-ef-gh"`.
- `addDaysToISODate`: `("2026-12-31",1)`, `("2024-02-28",1)`, `("2026-03-29",-1)`, `(d,0)`,
  `(d,3650)`, `(d,-400)`. Keep these inside 1900–2100 (see Open questions).
- `weekdayIndex`, `weekdayName`, `planWeekOneMonday`, `nextPlanStartDate` and
  `weekOneDaysBeforeStart`:
  - Each day of the week starting `2026-11-09`, a Monday.
  - A year boundary: `2026-12-31` is a Thursday, and the next start date is `2027-01-04`.

### `shared/nutritionScaling.ts`

**Functions:** `scaleNutrition` (with the private `derivedCaloriesPer100g`, `scaleValue` and
`MAX_MACRO_MASS_PER_100G = 101`), `roundMacros`, `totalNutrition`, `emptyTotals`, `addInto`,
`KCAL_PER_G_PROTEIN`, `KCAL_PER_G_CARB`, `KCAL_PER_G_FAT` and `KCAL_PER_G`.

**Depends on:** the type `NutritionMacroTotals`, which comes from the generated models.

**Fixture inputs:**

- `scaleNutrition`:
  - A food with every per-100g value `null`.
  - Calories `null` with 50/120/20 g protein/carb/fat: calories are derived, 860 per 100 g.
  - Macros summing to 101: still derived.
  - Macros summing to 101.5: not derived, gives 0 kcal.
  - `caloriesPer100g: 0` with macros: an explicit 0 is kept and not derived.
  - Quantities 0, 33.3 and 250.
  - A fibre-only food.
- `roundMacros`:
  - 157.5 kcal: gives 158.
  - -0.4 kcal: gives `-0`.
  - Protein 0.05: gives 0.1.
  - Protein -0.05: gives `-0`.
  - 1.005: gives 1, because 1.005 × 10 is 10.0499….
  - 2.675: gives 2.7.
- `totalNutrition`:
  - No rows.
  - Two entries of 0.25 kcal: the raw sum rounds to 1, where rounding each entry would give 0.
  - The M22 example: a 157.44 kcal entry at double quantity gives 315.

### `shared/mealFuelling.ts`

**Functions:** `mergeMealOverride` only, with the private `keepsUnsetMacroShare`,
`overriddenMealCalories`, `mealMacroKcal` and `round1`, and the types `MealFuelValues`,
`MealFuelOverride` and `MergedMealOverride`. `computeMealFuelTargets` is about 600 lines. It stays on
the server, which returns the split in the nutrition day summary.

**Depends on:** `KCAL_PER_G` from `shared/nutritionScaling.ts`.

**Fixture inputs:**

- A split whose calories equal its macro energy, `{calories:720, carbG:80, proteinG:40, fatG:20}`,
  with these overrides:
  - `{}`
  - `{calories:900}`
  - `{calories:899.6}`: gives 900.
  - `{proteinG:50}`
  - `{proteinG:50, carbG:80, fatG:20}`
  - `{carbG:80.05}`: a float tie in `round1`.
- A split that holds a share of the day's calorie goal (2,500 kcal plus 150 g protein),
  `{calories:720, carbG:0, proteinG:43, fatG:0}`:
  - `{proteinG:50}`: gives 748, and the share is kept.
  - `{proteinG:50, carbG:80, fatG:20}`: gives 700, with `caloriesFromMacros` true.
  - `{calories:900, proteinG:50, carbG:0, fatG:0}`: gives 900. The 0 g pins are read as an echo of
    the split.
- A split with no calorie goal, `{calories:160, carbG:0, proteinG:40, fatG:0}`, with override
  `{calories:900, proteinG:50, carbG:0, fatG:0}`: gives 200, because a 0 g pin is a real figure
  there.

### `shared/sessionFuellingTargets.ts`

**Functions:** `computeSessionFuellingTarget`, with the private `intensityFactor` and `clamp` and all
the constants.

**Depends on:** nothing.

**Notes:** The inputs come from the athlete's saved `expectedDurationMin` / `expectedRpe`, or from
the `sessionEstimate` API field (see API fields), plus `bodyweightKg` from preferences. If the
fuelling panel is not in v1, a `fuellingTarget` field on planned timeline entries would do instead,
and this port can wait.

**Fixture inputs:**

- `{durationMin:null, rpe:null, bodyweightKg:null}`.
- Bodyweight 0 and -70: the defaults.
- RPE `null`, 0, 4, 4.5, 7, 7.5, 8, 10.
- Duration `null`, 0, -10, 20, 44, 45, 60, 90, 150, 30.5.
- Bodyweight:
  - 60: protein 18 is clamped to 20, with a reason code.
  - 70.
  - 72.5.
  - 150: protein 45 is clamped to 40.
  - 65: 65 × 0.7 = 45.5, a rounding tie, gives 46.
- 44 min at RPE 3 (no pre-session carbs), against 45 min at RPE 3 and 44 min at RPE 5.
- Assert the `explanation` string as well. It interpolates numbers with JS formatting: `"70kg"`,
  `"72.5kg"`, `"30.5-min"`.

### `shared/progression.ts` and `shared/exerciseEquipment.ts`

**Functions:**

- From `progression`: `suggestNextTarget`, `unmetPrescription` and `epley`, with the private
  `weightSteps`, `stepsToTry`, `uniformValue`, `roundWeight`, `deloadFrom`, `progressFrom` and their
  constants.
- From `exerciseEquipment`: `implementFor` and `loadIncrement`, with the data in
  `EXERCISE_EQUIPMENT`, `IMPLEMENT_OVERRIDES`, `INCREMENTS` and `LOADED_IMPLEMENTS`. Only the
  loaded-implement entries matter to `implementFor`.

**Depends on:**

- `progression` imports `exerciseEquipment`.
- `exerciseEquipment` uses types only from `schema/exercises` (`ExerciseName`) and
  `unitConversion` (`WeightUnit`).
- The web feeds these functions sets already converted by `toPreferenceScaleAll`
  (`components/workout-detail/exercise-table/LastTimeRow.tsx:55`), so the app needs the
  `unitConversion` stamp functions first.

**Fixture inputs for `suggestNextTarget`** (category `"strength"` and kg unless noted):

- Progressing:
  - 3×5 @ 100 `back_squat`: +2.5 kg.
  - 3×8 @ 20 `back_squat`: +1 rep.
  - 3×10 @ 20 `back_squat`: 21.25, the half plate.
  - 3×10 @ 25 `back_squat`: 27.5. This is the audit L2 float boundary, where step × (1 + 10/30)
    equals the 10% cap.
  - 3×10 @ 10 `dumbbell_bench_press`: `null`. The 2 kg step breaks the cap, and dumbbells have no
    half step.
  - 3×10 @ 16 `kettlebell_swings`: `null`.
  - 3×8 @ 10 `pull_up`: bodyweight, half steps allowed.
- Units: 3×5 @ 225 `back_squat` with `weightUnit` `"lbs"` and `"lb"`.
- Exercise name:
  - `exerciseName` `"Back Squat"`: a label, not a key, so it falls back to barbell.
  - `exerciseName` omitted.
- Silent cases:
  - Category `"running"`: `null`.
  - Weight 0, reps 1, reps 11.
  - Varying reps `[5,5,4]` with no prescription.
  - `[]`.
- Missed prescriptions:
  - Planned 5 @ 100 ×3, actual `[5,5,4]`: repeat.
  - The same, with `previousSets` also missed at 5 @ 100: deload to 90, amount 10.
  - `previousSets` missed at 5 @ 97.5: repeat.
  - A 20 kg kettlebell missed twice: 16.
  - A 1 kg dumbbell missed twice: no step above 0, so repeat.
  - A prescription that varies set to set: falls through to the uniform check.

**Other fixture inputs:**

- `epley(100,5)`, `epley(0,10)`.
- `implementFor` and `loadIncrement` (kg and lbs):
  - `back_squat`, `dumbbell_bench_press`, `kettlebell_swings`, `leg_press`.
  - `pull_up`: overridden to bodyweight, which uses barbell steps.
  - `walking_lunges`: overridden to dumbbell.
  - `standing_calf_raise`: overridden to machine.
  - `hip_thrust`.
  - `chest_supported_row`: the table lists machine first, but `LOADED_IMPLEMENTS` order makes it
    dumbbell.
  - `sled_push`: no loaded implement, so barbell.
  - `"Back Squat"` and `""`: unknown, so barbell.

### `shared/planPhase.ts`

**Functions:** `computeCurrentWeek`, `computePlanPhase` and `PLAN_PHASE_ORDER`. `formatPhaseName`
and `planWeekForDisplay` are render.

**Depends on:**

- `dayDiff` from `shared/dateUtils.ts`.
- The `TrainingPhase` union from `shared/nutritionTargets.ts`, a type only.

**Notes:** The web passes the browser's local date as `today`
(`components/timeline/TimelineSummaryCard.tsx:99`, via `lib/dateUtils.ts` `getTodayString`). The app
should pass `Clock.System.todayIn(TimeZone.currentSystemDefault())`. The server uses the athlete's
stored timezone (see Open questions).

**Fixture inputs:**

- `computeCurrentWeek`:
  - No start date: gives 1.
  - Start date today: gives 1.
  - Today is start + 6: gives 1.
  - Today is start + 7: gives 2.
  - Start 10 days in the future: gives 1.
  - Start 100 days ago on a 12-week plan: gives 15, not clamped.
  - A span across a DST change.
- `computePlanPhase`:
  - `totalWeeks` 1, 2, 3, 4, 8, 10, 12 and 24, each with every week.
  - Week 0, week -1 and week `totalWeeks + 1`: give `undefined`.
  - `totalWeeks` 0.
  - These include week 1 of 4, where `progressPct` is 12.5, a tie that gives 13.

### `shared/notifyHours.ts`

**Functions:** `resolveNotifyHour`, `fallbackNotifyHour`, `isValidNotifyHour`, `DEFAULT_NOTIFY_HOUR`,
`BRIEF_TOMORROW_FROM_HOUR`, `NOTIFY_HOUR_FIELD` and `EMAIL_NOTIFY_KINDS`.

**Depends on:** `WEEKLY_REVIEW_SUNDAY_EVENING_HOUR` from `shared/weeklyReview.ts`.

**Fixture inputs:**

- Each of the five kinds against:
  - `{}`
  - `{notifyHour:6}`
  - `{notifyHour:24}`
  - `{notifyHour:6.5}`
  - `{notifyHour:null}`
  - `{notifyHourTodaySession:0}`: 0 is a valid hour.
  - `{notifyHourTodaySession:null, notifyHour:13}`
  - `{notifyHourWeeklyReviewReminder:9}`
- `isValidNotifyHour` on `"7"`, -1, 23, 23.5 and `NaN`.
- "Briefs tomorrow" (`resolveNotifyHour(…, "todaySession") >= BRIEF_TOMORROW_FROM_HOUR`) at hours
  11 and 12.

### `shared/schema/exercises.ts` (part of `schema*`)

**Functions and data:**

- `normalizeExerciseName`, with the private `slugifyExerciseName` and `resolveExerciseSlug`. The
  memo cache is optional.
- `isRunningExerciseName` and `knownExerciseLabel`.
- `EXERCISE_DEFINITIONS`: `label`, `category` and `fields`. `muscleGroups` is not needed in v1.
- `EXERCISE_NAME_ALIASES`.

The client uses these in the exercise picker (`components/ExerciseSelector.tsx`), the field
metadata (`components/exercise-row/fieldMeta.ts`), the workout editor hooks, and the pace-or-speed
choice in `components/workout-detail/shared/WorkoutSummaryHeader.tsx:138`.

**Depends on:** nothing.

**Notes:**

- Have the fixture script emit `EXERCISE_DEFINITIONS` and `EXERCISE_NAME_ALIASES` as JSON, and
  generate the Kotlin tables from that JSON instead of copying them by hand.
- `slugifyExerciseName` loops over characters with `trim()` and `toLowerCase()`. Kotlin's `trim()`
  also strips U+001C–U+001F, and JS's also strips U+FEFF. The slug algorithm absorbs both
  differences, but the fixtures cover them anyway.

**Fixture inputs:**

- `normalizeExerciseName`:
  - Every key in `EXERCISE_DEFINITIONS`, every key in `EXERCISE_NAME_ALIASES`, and every `label`.
  - `"back-squat"`, `"BACK  SQUAT"`, `"Farmer's Carry"`, `"farmer’s carry"` (curly apostrophe).
  - `"Ski-Erg"`, `"  SkiErg "`.
  - `" back squat"`, `"﻿back squat"`, `"\u001Fback squat"`.
  - `"Café Run"`, `"İnterval run"`, `"5k run"`, `"custom"`.
  - `""`, `"   "`, `"!!!"`.
- `isRunningExerciseName`: `"Easy Run"`, `"run"`, `"rowing"`, `""`, an unknown name.
- `knownExerciseLabel`:
  - `"back_squat"`.
  - `"Back Squat"`: gives `undefined`, because the map is keyed by canonical name.
  - `"custom"`.

### `shared/schema/structureLint.ts` (part of `schema*`)

**Functions:** `lintWorkoutStructure`, with all its private helpers.

**Depends on:** the types `ParsedExercise` and `StructureBlockInput`, which come from the generated
models (both are registered in `shared/openapiRoutes/entities.ts`).

**Notes:**

- The server rejects any result with `schemaErrors` with a 400
  (`server/services/workoutUseCases.ts:117`, `:177`).
- The web lints before save (`hooks/workout-form/saveWorkoutPayload.ts:357`), so an offline save is
  never queued only to fail on replay. The app outbox needs the same check.

**Fixture inputs:**

- Empty and `null` inputs: score 100.
- AMRAP blocks:
  - With `rounds`: error.
  - With no duration and no cap: error.
  - `formatType "AMRAP"` in upper case. The format rules lowercase it, but `isComplexBlock` compares
    exact lower case, so no link check runs.
- Rounds without `roundCount` or `rounds`: error.
- for_time:
  - With only `durationMinutes`: still an error, because only `durationSeconds` or
    `timeCapMinutes` count.
  - A step with no targets: info.
  - A step with the `targets.targetReps` alias: no info.
- interval with the `workIntervalSec` / `restIntervalSec` aliases.
- `restSeconds` together with a `"Rest"` step: warning.
- EMOM blocks:
  - With no `id` when there are exercises: error.
  - With no `id` and no exercises: no error.
  - Steps linked and unlinked through a set's `blockId` and `stepNumber`.
  - A rest step: needs no link.
- `repMode:"per_side"` with both top-level and per-set reps: warning.
- Four errors: the score clamps to 0.

### `shared/schema/micros.ts` (part of `schema*`, deferred)

`MICRO_DISPLAY_DEFS` is data: key, label, unit and RDI for 14 micronutrients. The web uses it only
for the micronutrient preview in Log Food (`pages/nutrition/utils.ts:103`). That panel is not in
the v1 scope. When it ships, emit the table as a fixture resource, so that the app's %RDI matches the
server's `GET /api/v1/nutrition/micros`.

## API fields to add

| # | Module | Endpoint | Field or change | Does the server already have the value? |
| --- | --- | --- | --- | --- |
| 1 | `plannedSessionEstimate` | `GET /api/v1/timeline`, planned entries | `sessionEstimate: {durationMin, rpe, source, clamped}` | **Yes**, one day at a time: `getPlannedSessionEstimate` (`server/services/sessionEstimate/plannedSessionEstimate.ts:196`) serves `GET /api/v1/nutrition/planned-session-estimate/{planDayId}`. For the batch, call `estimatePlannedSession` with `getRunPaceRatio` and leave out the per-day AI nudge |
| 2a | `nutritionTargets` | New `POST /api/v1/nutrition/targets/suggest` (body: `bodyweightKg`, `heightCm`, `ageYears`, `sex`, `activityLevel`, `goalDirection`, `goalRateKgPerWeek`) | Returns `NutritionTargetResult` | **No.** `calculateNutritionTarget` runs only in `components/onboarding/FuellingStep.tsx:269`, `hooks/useOnboardingWizard.ts:432` and `pages/nutrition/TargetsDialog.tsx:92`. The server never calls it |
| 2b | `nutritionTargets` | `POST /api/v1/nutrition/targets` | Accept `{periodize, recoveryEnabled, phaseAware}`, and let the server fill the nine periodisation columns with `nextPeriodizationSettings` / `carryPeriodizationForward` | **No**, but the server has both inputs: the current version and `trainingLoad.chronicAvg`. The client computes this today (`pages/nutrition/TargetsDialog.tsx:115`, `hooks/useOnboardingWizard.ts:130`) |
| 3a | `maf` | `PATCH /api/v1/preferences` | The server writes `users.mafHr` from `calculateMafHr` and returns it. The app stops sending `mafHr` | **Computed, not stored.** `server/storage/users.ts:336` computes it on every save for the `maf_profile` snapshot, but the column keeps the client's value (`hooks/useOnboardingWizard.ts:334`, `pages/settings/usePreferencesForm.tsx:344`) |
| 3b | `maf` | `GET /api/v1/timeline`, `GET /api/v1/workouts/{id}` | `mafCompliance: {compliancePct, classification, nextAction, avgOverBy}` on completed sessions with an average HR, for MAF-method athletes | **Partly.** `computeMafCompliance` runs in `server/services/mafTestService.ts:71`, but only for tagged MAF tests. The web computes it for every session in `lib/mafFormat.ts:55` |
| 4 | `fuellingCorrelation` | `GET /api/v1/nutrition/block` | `correlation: FuellingCorrelationResult` | **No.** No server file imports the module. Its inputs are the response's own `points` (`components/analytics/FuellingCorrelationCard.tsx:70`) |
| 5 | `bodySystemLoad` | `GET /api/v1/training-overview` | `bodySystemLoad.divergence: string \| null` | **Yes.** `describeBodySystemDivergence` runs in `server/services/overviewAnalysisService.ts:224` for the AI analysis, but not for this response |
| 6 | `coachNotes` | `GET /api/v1/timeline`, and any workout or plan-day response that carries `notes` | `coachNotes: {athleteText, cues: [{label: string \| null, text}]}` | **No.** The server only writes the format, through `appendCoachCue` (`server/services/coachService.ts:80`, `server/services/aiSuggestionService.ts:120`) |
| 7 | `deviceSportTypes` | `GET /api/v1/timeline`, `GET /api/v1/workouts/{id}` | `avgCadenceUnit: "spm" \| "rpm"` | **No.** `cadenceUnitFor` exists in `shared/`, but only the client calls it. `server/services/stravaMapper.ts:86` says the UI labels cadence |
| 8 | `planDayKind`, `raceDay` | `GET /api/v1/timeline` | `dayKind: "session" \| "rest" \| "race"` | **Yes.** `isRestLikePlanDay` runs in `server/storage/plans.ts:1037` and `server/emailScheduler.ts:463`. The race marker is written in `server/storage/raceDayView.ts:44` and tested in `server/storage/timeline.ts:188` |
| 9 | `ratio` | `GET /api/v1/training-overview/summary` | `completionRate: number \| null`: last 28 days, excluding today, excused days and `let_go` misses | **No, a different number.** The coach context rate (`server/services/ai/trainingStats.ts:36`) counts every loaded entry and returns 0 where the web returns `null` (`lib/statsUtils.ts:112`) |
| 10 | `nutritionRange` | `GET /api/v1/nutrition/summary-range` | Clamp a too-wide range to 731 days around the athlete's today, instead of a 400. The response's `from` and `to` already report the window served | **Yes**, the constant and the athlete's today. It rejects today (`shared/schema/nutrition.ts:330`). This makes `pages/timeline/fuellingWindow.ts`'s narrowing unnecessary |
| 11 | Found along the way, `units` / `unitConversion` | `POST /api/v1/workouts` | Generate `mainWorkout` on the server when it is omitted, from `exercises` | **No.** When the free text is empty, the client writes `generateSummary(…)` (`hooks/workout-editor/blockHelpers.ts:87`, used at `hooks/workout-form/saveWorkoutPayload.ts:376`). That summary is built from `getWorkoutDistanceDisplay` and `formatMinutes`, so the app would otherwise have to port it byte for byte |
| 12 | Optional, `athleteFacts` | `GET /api/v1/athlete-facts` | `maxActive` (`MAX_ACTIVE_ATHLETE_FACTS`, 20) | Enforced in `server/storage/athleteFacts.ts:94`, but not in the contract. The fact `maxLength` (140) already is |

## Open questions

1. **v1 scope decides five of the ports.** Each of these is needed only if its screen ships in v1:
   - `structureLint`: does the composer edit EMOM/AMRAP blocks?
   - `sessionFuellingTargets`: the fuelling panel.
   - `mergeMealOverride`: editing per-meal targets.
   - `progression`: the "Next" chip.
   - `notifyHours`: email notification settings.

   `unitConversion`, `dateUtils`, `nutritionScaling`, `planPhase` and `schema/exercises` are needed
   for the v1 timeline, composer and food log whatever the answers.
2. **How should the exercise catalogue reach the app?** No catalogue endpoint exists: there is only
   `/api/v1/exercises/{exerciseName}/history` and `/api/v1/custom-exercises`. The two options:
   - Generate Kotlin from the TS source at build time. The catalogue works offline and is versioned
     with the app.
   - Serve it from an endpoint. New exercises reach the app without a release, but old builds then
     meet unknown keys.
3. **Whose "today"?** These read the device's today on the web:
   - `computeCurrentWeek`
   - `isAthleteFactDue`
   - the completion-rate window
   - `nextPlanStartDate`

   The server uses the athlete's stored timezone. The app should copy the web and use the device
   timezone, but the two will disagree when the device and the stored timezone differ.
4. **Date domain.** Should the Kotlin date port declare years outside 1900–2100 out of domain? That
   is the range the nutrition routes already enforce. Below the year 1000, JS output is unpadded,
   and years 0–99 become the 1900s. `isIsoCalendarDate` fixtures would still cover those edges.
5. **Which completion rate is canonical?** The web Coach panel (`lib/statsUtils.ts`) and the coach's
   prompt context (`server/services/ai/trainingStats.ts`) disagree. Decide before adding API field 9.
6. **The web is already inconsistent here.** `FuellingTargetChip.tsx` uses the local, generic-pace
   estimate. `FuellingPlanPanel.tsx:104` swaps in the server's personalised, possibly AI-refined
   estimate. So the chip and the panel can quote different targets for the same session. API field
   1 would fix the web too.
7. **`mafHr` has two writers.** Should the server ignore a client-sent `mafHr` once field 3a ships?
8. **Notes edited offline.** With field 6, a note edited offline is unparsed until it syncs. Show the
   raw text until then, or port `parseCoachNotes`? A port would need JS-compatible `\s` (JVM `\s` is
   ASCII-only by default).
9. **The summary text is generated on the client** (field 11). Move it to the server, or accept that
   web and app may write different `mainWorkout` text for the same workout?
10. **Should nutrition target suggestions work offline?** The onboarding fuelling step recomputes on
    every keystroke. With field 2a it becomes a debounced call. Onboarding already needs the network
    for plan generation.

## Appendix: per-module record

Paths are relative to `client/src/`. "Server" means non-test files in `server/`.

### port

- **`unitConversion`.** 1046 lines. The server uses it in 56 files.
  - **Client use:** conversions in the set editor, the stamp-aware read path and optimistic patches,
    bodyweight, height and distance inputs, and display formatting.
  - **Importing files (24):** `components/exercise-row/InlineSetEditor.tsx`,
    `components/timeline/timeline-workout-card/{WorkoutStravaStats,TimelineWorkoutCard}.tsx`,
    `components/timeline/timeline-workout-card/types.ts`,
    `components/settings/preferences/BodyCompositionCard.tsx`,
    `components/workout-detail/shared/WorkoutSummaryHeader.tsx`,
    `components/workout-detail/MafTestForm.tsx`,
    `components/workout-detail/exercise-table/metrics.ts`,
    `components/onboarding/FuellingStep.tsx`, `components/analytics/mafTrend.helpers.ts`,
    `components/analytics/training-overview/{OverviewStatsGrid,OverviewTrendCharts}.tsx`,
    `components/analytics/MafTrendTab.tsx`, `hooks/useExerciseSetsForOwner.ts`,
    `hooks/onboardingProfile.ts`, `hooks/useOnboardingWizard.ts`,
    `hooks/workout-editor/blockHelpers.ts`, `lib/setDisplay.ts`, `lib/workoutStructureSummary.ts`,
    `lib/manualMetrics.ts`, `lib/personalRecordFormat.ts`, `lib/exerciseUtils.ts`,
    `pages/log-workout/useDuplicateLastWorkout.ts`, `pages/settings/preferencesValidation.ts`.
  - **Exports used:** the port list above, the six formatters left as render, and types.
- **`dateUtils`.** 179 lines. The server uses it in 36 files, and it also feeds the Zod schemas.
  - **Client use:** plan length and its validation, start-date defaults and notes, the weekday on
    moved entries, and the windows for fuelling and drop targets.
  - **Importing files:** `components/plans/generate-plan/useGeneratePlanForm.ts`,
    `components/workout-detail/shared/WorkoutPlanDayPicker.tsx`,
    `components/onboarding/GoalStep.tsx`, `hooks/useMoveTimelineEntry.ts`, `lib/planStart.ts`,
    `lib/weekDates.ts`, `pages/timeline/dropTargets.ts`, `pages/timeline/fuellingWindow.ts`.
  - **Exports used:** the 13 listed in the port list, plus `describeWeekdaySpan`.
- **`nutritionScaling`.** 170 lines. The server uses it in `server/services/nutrition/rollup.ts`.
  - **Client use:** the Log Food preview, meal totals and macro shares.
  - **Importing files:** `pages/nutrition/{LogFoodDialog.tsx,utils.ts,MealSection.tsx}`.
  - **Exports used:** `scaleNutrition`, `roundMacros`, `totalNutrition`, `emptyTotals`, `KCAL_PER_G`.
- **`mealFuelling`.** 757 lines. The server uses it in
  `server/routes/nutrition/nutritionSummary.routes.ts` (`computeMealFuelTargets`,
  `applyMealTargetOverrides`).
  - **Client use:** the meal-target editor preview.
  - **Importing files:** `pages/nutrition/MealTargetDialog.tsx`, and
    `components/settings/preferences/NutritionPreferencesCard.tsx` (type only).
  - **Exports used:** `mergeMealOverride`, `MealFuelValues`, `MealScheduleCount`.
- **`sessionFuellingTargets`.** 126 lines. The server uses it in
  `server/routes/nutrition/nutritionSummary.routes.ts`, `server/services/ai/nutritionContext.ts` and
  `server/services/nutrition/reminders.ts`.
  - **Client use:** the fuel chip on planned cards and the fuelling panel.
  - **Importing files:** `components/timeline/timeline-workout-card/FuellingTargetChip.tsx`,
    `components/workout-detail/FuellingPlanPanel.tsx`.
  - **Exports used:** `computeSessionFuellingTarget`.
- **`progression`.** 304 lines. The server uses it in
  `server/services/workoutEngine/adaptation.ts` and `server/services/workoutEngine/loadMath.ts`.
  - **Client use:** the "Next" chip.
  - **Importing files:** `components/workout-detail/exercise-table/nextTarget.ts`, which
    re-exports `suggestNextTarget` to `LastTimeRow.tsx:80`.
  - **Exports used:** `suggestNextTarget`, `NextTarget`.
- **`exerciseEquipment`.** 172 lines. The server uses it in 4 files, including
  `server/services/workoutEngine` and `server/services/ai/exerciseSelection.ts`.
  - **Client use:** none at runtime directly. It is a runtime dependency of `progression`.
  - **Importing files:** only `components/workout-detail/exercise-table/__tests__/nextTarget.test.ts`.
  - **Exports used:** `loadIncrement` (in that test).
- **`planPhase`.** 141 lines. The server uses it in 5 files: `server/services/ai/index.ts`,
  `coachingInsights.ts`, `workoutEngine/adaptation.ts`, `sessionGrades/sessionGradeService.ts` and
  `planBlueprint.ts`.
  - **Client use:** "Week N of M · Phase" and the coach note's phase text.
  - **Importing files:** `components/timeline/TimelineSummaryCard.tsx`,
    `components/timeline/timeline-workout-card/CoachNote.tsx`.
  - **Exports used:** `computeCurrentWeek`, `computePlanPhase`, `formatPhaseName`,
    `PLAN_PHASE_ORDER`.
- **`notifyHours`.** 75 lines. The server uses it in `server/routes/preferences.ts` and
  `server/emailScheduler.ts`.
  - **Client use:** the email notification settings.
  - **Importing files:** `components/settings/preferences/EmailNotificationsCard.tsx`,
    `pages/settings/preferencesSnapshot.ts`.
  - **Exports used:** `BRIEF_TOMORROW_FROM_HOUR`, `DEFAULT_NOTIFY_HOUR`, `fallbackNotifyHour`,
    `resolveNotifyHour`, `EmailNotifyKind`.
- **`schema*`.** About 10.5k lines across `shared/schema/*.ts` and `types/`. The server uses it
  everywhere.
  - **The barrel:** 209 production client files import it, all with `import type`.
    `script/bundle-check.ts` enforces that no client file value-imports the barrel. Bucket: render,
    via generated models.
  - **`schema/enums`** (183 lines):
    - Client use: `MEAL_TYPES`, `athleteFactCategoryEnum` and `chatFactProposalStatusEnum`, plus
      types. These are display order and type guards, and they are OpenAPI enums.
    - Importing files: `pages/Nutrition.tsx`,
      `pages/nutrition/{ParsedMealReviewSheet,LogFoodDialog}.tsx`,
      `pages/nutrition/utils.ts`, `pages/nutrition/useQuickLog.tsx`,
      `components/settings/athlete-card/{CategorySelect,athleteCardModel,AddAthleteFactForm}`,
      `hooks/chat/chatSessionModel.ts`.
    - Bucket: render.
  - **`schema/exercises`** (851 lines):
    - Client use: `EXERCISE_DEFINITIONS` in 12 files, `normalizeExerciseName` in 4, and
      `EXERCISE_NAME_ALIASES`, `isRunningExerciseName`, `knownExerciseLabel` and `ExerciseName`.
    - Importing files (17): `components/ExerciseSelector.tsx`,
      `components/exercise-row/{fieldMeta.ts,InlineSetEditor.tsx}`,
      `components/workout-detail/{ExerciseTable.tsx,exercise-table/ExerciseRows.tsx,shared/WorkoutSummaryHeader.tsx}`,
      `components/workout-structure/StructureBlocksEditor.tsx`,
      `components/timeline/timeline-workout-card/{MafCeilingChip,CoachNote}.tsx`,
      `hooks/useExerciseHistory.ts`,
      `hooks/workout-editor/{parseMerging,structureRows,blockHelpers}.ts`,
      `hooks/useWorkoutEditor.ts`, `lib/{exerciseWarnings,exerciseUtils,structuredExercise}.ts`.
    - Server: 13 files. Bucket: port.
  - **`schema/structureLint`** (222 lines):
    - Client use: `lintWorkoutStructure` in `hooks/workout-form/saveWorkoutPayload.ts`.
    - Server: through the barrel, in `server/services/workoutUseCases.ts`. Bucket: port.
  - **`schema/micros`** (41 lines):
    - Client use: `MICRO_DISPLAY_DEFS` in `pages/nutrition/utils.ts`.
    - Server: has its own `MICRO_DEFS`. Bucket: port as data, deferred.

### api

- **`plannedSessionEstimate`.** 519 lines. The server uses it in 6 files, including
  `server/services/sessionEstimate/plannedSessionEstimate.ts` and
  `server/services/missedRecovery/index.ts`.
  - **Client use:** the instant estimate behind the fuel chip and the panel's seed value.
  - **Importing files:** `components/timeline/timeline-workout-card/FuellingTargetChip.tsx`,
    `components/workout-detail/FuellingPlanPanel.tsx`.
  - **Exports used:** `estimatePlannedSession`.
  - **Dependencies a port would need:** `schema/exercises` and
    `unitConversion.storedDistanceToMetersStamped`.
- **`nutritionTargets`.** 756 lines. The server uses it in 12 files, for `effectiveTarget*` and
  `defaultPeriodizationConfig`. It never calls the three functions the client uses.
  - **Client use:** the suggested target and the periodisation columns of the save payload.
  - **Importing files:** `components/onboarding/FuellingStep.tsx`, `hooks/onboardingProfile.ts`,
    `hooks/useOnboardingWizard.ts`, `pages/nutrition/TargetsDialog.tsx`.
  - **Exports used:** `calculateNutritionTarget`, `carryPeriodizationForward`,
    `nextPeriodizationSettings`, and types.
- **`maf`.** 224 lines. The server uses it in `server/storage/users.ts`,
  `server/services/mafTestService.ts` and `server/storage/mafTests.ts`.
  - **Client use:** computes `mafHr` before save, the MAF tile on workout detail, and speed in the
    MAF trend.
  - **Importing files:** `hooks/useOnboardingWizard.ts`, `pages/settings/usePreferencesForm.tsx`,
    `lib/mafFormat.ts`, `components/analytics/{MafTrendTab.tsx,mafTrend.helpers.ts}`,
    `components/workout-detail/MafTestTagSection.tsx`.
  - **Exports used:** `calculateMafHr`, `computeMafCompliance`, `metersPerSecond`, and types.
    `metersPerSecond` is a guarded division and counts as render.
- **`fuellingCorrelation`.** 152 lines. No server file uses it.
  - **Client use:** the Analytics Fuelling tab card.
  - **Importing files:** `components/analytics/FuellingCorrelationCard.tsx`.
  - **Exports used:** `analyzeFuellingCorrelation`, `FuellingMetricComparison`.
- **`bodySystemLoad`.** 163 lines. The server uses it in 4 files.
  - **Client use:** the overview card.
  - **Importing files:** `components/analytics/training-overview/BodySystemLoadCard.tsx`.
  - **Exports used:** `describeBodySystemDivergence` (api), and `BODY_SYSTEM_META`,
    `formatLoadChange` and `hasBodySystemLoadData` (render).
- **`coachNotes`.** 149 lines. The server uses it in 3 files, to write cues.
  - **Client use:** splits a day's notes into the athlete's text and coach cues.
  - **Importing files:** `components/timeline/timeline-workout-card/WorkoutNotes.tsx`.
  - **Exports used:** `parseCoachNotes`, `splitCoachCueLabel`.
- **`deviceSportTypes`.** 178 lines. The server uses it in 6 files, for `countsAsTraining`,
  `heartRateReflectsEffort` and `isRunSportType`.
  - **Client use:** the cadence label.
  - **Importing files:** `components/timeline/timeline-workout-card/WorkoutStravaStats.tsx`,
    `components/workout-detail/shared/WorkoutSummaryHeader.tsx`.
  - **Exports used:** `cadenceUnitFor`.
- **`planDayKind`.** 46 lines. The server uses it in 2 files.
  - **Client use:** the rest-day card.
  - **Importing files:** `components/timeline/timeline-workout-card/TimelineWorkoutCard.tsx`.
  - **Exports used:** `isRestLikePlanDay`.
- **`raceDay`.** 10 lines. The server uses it in 2 files.
  - **Client use:** the race-day card.
  - **Importing files:** `components/timeline/timeline-workout-card/utils.tsx`.
  - **Exports used:** `RACE_DAY_FOCUS`.
- **`ratio`.** 76 lines. The server uses it in 3 files.
  - **Client use:** the Coach panel's completion rate.
  - **Importing files:** `lib/statsUtils.ts`, consumed by `components/CoachPanel.tsx:69`.
  - **Exports used:** `pooledPercentage`, `roundOrNull`.
- **`nutritionRange`.** 13 lines. The server uses it through `nutritionRangeSchema`.
  - **Client use:** narrows the Timeline's summary-range request.
  - **Importing files:** `pages/timeline/fuellingWindow.ts`.
  - **Exports used:** `NUTRITION_RANGE_MAX_DAYS`.

### render

- **`units`.** 107 lines. The server uses it in 11 files.
  - **Client use:** unit brands, the minutes-to-seconds conversion for display, and `formatMinutes`.
    `formatMinutes` also feeds the persisted summary (API field 11).
  - **Importing files:** `components/workout-detail/MafTestTagSection.tsx`,
    `hooks/workout-editor/blockHelpers.ts`,
    `lib/{workoutStructureSummary,personalRecordFormat,exerciseUtils}.ts`.
  - **Exports used:** `minutes`, `minutesToSeconds`, `unitless`, `formatMinutes`.
- **`formatClock`.** 18 lines. The server uses it in its email templates and scheduler.
  - **Importing files:** `lib/personalRecordFormat.ts`, and `lib/statsUtils.ts` (re-export).
  - **Exports used:** `formatSecondsToClock`.
- **`chat`.** 41 lines. The server uses it in `server/routes/ai.ts` and
  `server/services/chatTools.ts`, and the request schema and OpenAPI document carry its values.
  - **Importing files:** `components/ChatInput.tsx`,
    `hooks/chat/{chatStream,chatProgress}.ts`.
  - **Exports used:** `CHAT_MESSAGE_MAX_LENGTH`, `CHAT_PHOTO_MAX_BASE64_CHARS`,
    `CHAT_PHOTO_DEFAULT_MESSAGE`, `CHAT_STATUS_STEPS`, `ChatStatusStep`.
- **`weeklyReview`.** 19 lines. The server uses it through the request schema.
  - **Importing files:** `components/review/WeeklyReviewIntent.tsx`, `lib/weeklyReviewPrompt.ts`.
  - **Exports used:** `WEEKLY_REVIEW_INTENT_MAX_LENGTH`, `WEEKLY_REVIEW_SUNDAY_EVENING_HOUR`.
- **`preferenceBounds`.** 30 lines. The server uses it through `updateUserPreferencesSchema`.
  - **Client use:** the pre-save range check.
  - **Importing files:** `pages/settings/preferencesValidation.ts`.
  - **Exports used:** `PREFERENCE_NUMBER_BOUNDS`, `NumberBound`.
- **`athleteFacts`.** 151 lines. The server uses it in 9 files.
  - **Client use:** the athlete card limits and due ordering.
  - **Importing files:**
    `components/settings/athlete-card/{AthleteCardSection,AthleteFactRow,AddAthleteFactForm}.tsx`,
    `components/settings/athlete-card/athleteCardModel.ts`.
  - **Exports used:** `ATHLETE_FACT_MAX_LENGTH`, `MAX_ACTIVE_ATHLETE_FACTS`, `isAthleteFactDue`.
- **`missedRecovery`.** 26 lines. The server uses it in 3 files.
  - **Importing files:** `components/timeline/missed-recovery/recoveryFormat.ts`.
  - **Exports used:** `formatSessionLength`.
- **`sessionIntent`.** 204 lines. The server uses it in 5 files.
  - **Importing files:** `lib/sessionGradeFormat.ts`,
    `components/session-grades/GradeVerdictBadge.tsx`.
  - **Exports used:** `runPurposeLabel`, `RunPurpose`, `SessionGradeIntent`.
- **`stationCoverage`.** 219 lines. The server uses it in 5 files.
  - **Importing files:** `components/timeline/StationRadar.tsx`.
  - **Exports used:** `stationLabel`, `CoverageStation`.
- **`inSequence`.** 34 lines. The server uses it in 16 files.
  - **Importing files:** `lib/offlineQueue.ts`,
    `components/settings/coaching/useCoachingUpload.ts`.
  - **Exports used:** `inSequence`.
- **`bodySystemLoadTestFixtures`.** 102 lines. Test-only.
  - **Importing files:** `components/analytics/training-overview/__tests__/BodySystemLoadCard.test.tsx`.
- **`nutritionTestFixtures`.** 33 lines. Test-only.
  - **Importing files:** `pages/nutrition/LogFoodActions.test.tsx`.
