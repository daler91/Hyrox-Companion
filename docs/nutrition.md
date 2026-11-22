[Back to README](../README.md)

# Nutrition & Fuelling Guide

This document describes the **Nutrition tracking module** end to end: what it does
for the athlete, how the code is organised across the client, server, and shared
layers, the design invariants that keep the numbers trustworthy, and a prioritised
list of improvements worth making next.

**Status:** complete and on by default. `VITE_NUTRITION_ENABLED` (client, build time)
and `NUTRITION_ENABLED` (server) both default to `true`, and `.env.example` carries
only commented-out `=false` lines for them, so a fresh environment has the module on;
set both to `false` to turn it off in an environment.
The feature was shipped in five phases; the phase labels survive in the code
comments and are used below as a feature map.

---

## Table of Contents

- [1. Overview](#1-overview)
- [2. Design principles & invariants](#2-design-principles--invariants)
- [3. Data model](#3-data-model)
- [4. Feature catalogue](#4-feature-catalogue)
  - [Phase 1 — Core logging](#phase-1--core-logging)
  - [Phase 2 — Coverage: barcode, custom foods, recipes, servings](#phase-2--coverage-barcode-custom-foods-recipes-servings)
  - [Phase 3 — Training integration](#phase-3--training-integration)
  - [Phase 4 — Natural-language & photo logging](#phase-4--natural-language--photo-logging)
  - [Phase 5 — Insights & coaching](#phase-5--insights--coaching)
- [5. API surface](#5-api-surface)
- [6. Client UI map](#6-client-ui-map)
- [7. AI usage & safety](#7-ai-usage--safety)
- [8. External data sources](#8-external-data-sources-usda--open-food-facts)
- [9. Configuration & feature flags](#9-configuration--feature-flags)
- [10. Testing](#10-testing)
- [11. Improvements & roadmap](#11-improvements--roadmap)
- [Appendix: file map](#appendix-file-map)

---

## 1. Overview

The nutrition module lets an athlete **log what they eat, see it against their
training, and get coached on it**. It is built around a shared, reusable food
reference cache sourced from public nutrition databases, never from AI — the LLM
estimates *portions* and *narrates insights*, but every calorie and gram traces
back to USDA FoodData Central, Edamam, Open Food Facts, or a user-entered custom food.

At a glance, the athlete can:

- **Search** a food database and log it to a meal with a quantity in grams.
- **Scan a barcode** to pull a packaged product from Edamam or Open Food Facts.
- **Describe a meal in plain English** ("2 eggs and a slice of toast") or **snap a
  photo** and let the AI turn it into reviewable line items.
- Build **custom foods** and **recipes** that log and roll up like any other food;
  a photo of a **nutrition label** can prefill a custom food.
- Set **calorie & macro targets** and track daily totals against them.
- See **micronutrients** for the day against reference daily intakes.
- See **fuelling around each training session** (pre/post windows) and a **block
  view** of daily intake vs. training load.
- Get an **AI nutrition analysis** of the last two weeks of fuelling vs. training.

The whole surface lives under `/api/v1/nutrition` on the server and the
`/nutrition` route on the client.

---

## 2. Design principles & invariants

These are the rules the code is built to protect. They are worth understanding
before changing anything in this module.

| Invariant | Why it exists | Where enforced |
|-----------|---------------|----------------|
| **All nutrition is stored per-100g** and scaled by logged grams at read time. | USDA values are immutable per `fdcId`; storing scaled snapshots would invite a wrong-basis bug and drift. Column names literally say `*_per_100g`. | `foods` table; `scaleNutrition` in `shared/nutritionScaling.ts`, the one scaling rule, applied by the server (re-exported from `server/services/nutrition/rollup.ts`) and by the client. A food whose source published no energy figure keeps `null` in the cache, and `scaleNutrition` derives its calories from its macros (4 / 4 / 9 kcal per g) at read time. |
| **Numbers never come from AI.** | Trust. The model estimates portion size and writes prose; it never originates a calorie or macro. | `BRD §7`, enforced by routing all macros through `foods` rows |
| **`logDate` is the user's *local* calendar day**, derived server-side from `users.user_timezone`. | A meal logged at 11pm in UTC+10 must land on the right day's totals. The client sends an instant (`loggedAt`); the server computes the date. The page dates entries in the device's timezone as of page load (an open tab keeps it across an OS timezone change), so before a log write the client brings a stale stored timezone up to that zone (`pageTimezone`); if that save fails, the write waits behind a "Log anyway" toast naming the timezone in force (CL65). | `server/routes/nutrition/nutritionLogs.routes.ts` (every log write, via `getUserTimezone` in `shared.ts`); `shared/schema/nutrition.ts`; `useLogTimezoneSync` (client) |
| **The food cache is shared and non-per-user.** A USDA food is cached once and reused by everyone. | Avoids N copies of "banana"; keeps the DB small and search fast. | Every row whose `source` is not `custom` is shared; visibility predicate `visibleTo(userId)` in `server/storage/nutritionShared.ts` (the athlete's own row, a non-custom source, or `is_public`). A NULL `createdByUserId` grants nothing: the owner FK is set null on account deletion. |
| **Custom foods are private by default**; the owner can share one with everyone (`foods.is_public`, set through `PATCH /foods/:id`). Visibility is checked on every food resolution. | No cross-user leakage of a user's own foods/recipes. | `NutritionStorage.getVisibleFoodById` etc.; `redactFoodOwner` (`server/routes/nutrition/shared.ts`) nulls `createdByUserId` for everyone but the owner in every response that carries a whole food row: search, recent, food detail, favourites, and the matched `food` on `/parse/text` and `/parse/photo` items |
| **Logged history is immutable-by-reference.** A food referenced by a log entry can't be deleted (`onDelete: restrict`). | Historical entries must never lose their nutrition source. | FK constraints on `food_log_entries.foodId`, `recipe_ingredients.foodId`, `recipes.foodId` |
| **External APIs degrade gracefully.** A provider that is down or unkeyed simply drops out of the merge; only when none of Edamam, USDA and Open Food Facts reaches its API does search return cached-only results with `apiDegraded: true`. One 9 s deadline (`PROVIDER_DEADLINE_MS`) covers a request's provider calls, retries included, and search's semantic fallback after them: a provider still running at it counts as down, search answers with its keyword results, and food detail opens with what is cached. | The app stays usable offline of third parties, and a hanging provider can't outlast the client's 15 s timeout. | `foodSearch.ts`, `foodDetail.ts`, `startProviderDeadline` in `utils.ts`; surfaced in `FoodSearch.tsx` |
| **AI endpoints are gated** by consent + per-user 24h budget + the app-wide spend ceiling. | Cost control and the GDPR opt-in consent model. | `aiConsentCheck` + `aiBudgetCheck` middleware; soft-gated routes check consent inline |

---

## 3. Data model

Eight tables, all defined in `shared/schema/tables.ts`. Nutrition values are
`real` columns on a **per-100g** basis; micronutrients live in a JSONB map.

```
foods ─────────────┬──< food_servings        (named portions: "1 cup" → grams)
   ▲   ▲            ├──< food_log_entries     (a logged food on a day/meal)
   │   │            ├──< food_favorites       (per-user favourites)
   │   │            └──< recipe_ingredients   (one line of a recipe)
   │   └─────────────── recipes               (backing food + ingredient list)
   └───────────────────  (foods.createdByUserId → users, "set null")

nutrition_targets        (versioned calorie/macro goals, by effective_from)
meal_targets             (versioned per-meal overrides, by meal_type + effective_from)
```

| Table | Purpose | Notable columns / rules |
|-------|---------|-------------------------|
| `foods` | Shared reference cache + private custom foods. | `source` ∈ {`usda`,`off`,`edamam`,`custom`} in practice (the CHECK also still allows the retired `fatsecret` / `spoonacular`, rendered from `FOOD_SOURCES`); `*_per_100g` macros; `micros` JSONB; `serving_size_g`; `last_fetched_at` (when an external row was last pulled from its source; NULL on custom foods); partial-unique on `(source, source_id)`. `created_by_user_id` is the owner of a custom or recipe-backing food (`set null` when the account is deleted). `is_public` (default `false`, migration 0080) is the sharing flag for a custom food: visibility rests on it and on `source`, never on a NULL owner. |
| `food_servings` | Named portions for a food. | `label`, `grams`; lazily filled from USDA portions on first food-detail view. `created_by_user_id` NULL is a shared portion (a USDA portion, or a serving created with a custom food); a non-null owner is a personal portion only that athlete sees (cascade on account deletion). Shared rows (NULL owner) are unique on `(food_id, label, grams)` (`uq_food_servings_shared`, migration 0122), so two first opens at once cache each portion once. |
| `food_log_entries` | A single logged food. | `loggedAt` (instant), `logDate` (local day), `quantityG`, `mealType`, `entryMethod` ∈ {`manual`,`barcode`,`nl`,`photo`}; `rawInput` + `parseConfidence` + `pendingReview` for AI provenance (`pendingReview` is always written `false`: the athlete reviews every parsed item before it is logged). |
| `nutrition_targets` | Versioned macro/calorie goals. | `calories`, `proteinG`, `carbG`, `fatG`, `effectiveFrom`; one row per `(user, effectiveFrom)` (`uq_nutrition_targets_user_effective`, migration 0091): a new date adds a version, a same-day save replaces that day's. Periodisation rides on the version: `periodization_enabled` (default `false` ⇒ a flat target), `reference_utss` (the UTSS at which the day's carbs equal the baseline `carbG`) and `carb_grams_per_utss` (the slope), plus the window-aware columns listed under [Phase 5](#phase-5--insights--coaching). **No fibre target column.** |
| `meal_targets` | Versioned **per-meal** macro/calorie goals. | `mealType` ∈ `MEAL_TYPES` (CHECK rendered from the constant), `calories`, `proteinG`, `carbG`, `fatG`, `effectiveFrom`; unique on `(user, mealType, effectiveFrom)` to match `upsertMealTarget`'s delete-then-insert. Surfaced as `DailySummaryResponse.mealTargets` on `GET /summary`. |
| `food_favorites` | Per-user favourites over the cache. | Unique `(userId, foodId)`; also indexed on `foodId` for the cascade when a food is deleted. |
| `recipes` | A custom food + an ingredient breakdown. | `foodId` is the backing `source='custom'` food; macros computed from ingredients so a recipe logs like any food. |
| `recipe_ingredients` | One ingredient line. | `foodId` (`restrict`), `quantityG`, `position`. |

`MEAL_TYPES` (`shared/schema/enums.ts`) = `breakfast, lunch, dinner, snack, snack_pm,
pre_workout, post_workout`. The last two exist so the Phase 3 training views can
bucket fuelling around sessions; `snack_pm` is the second snack of a five-meal day
(`users.meal_schedule`, see [Phase 3](#phase-3--training-integration)).

---

## 4. Feature catalogue

### Phase 1 — Core logging

The everyday loop: find a food, log it, see your day.

- **Food search** (`GET /foods/search`, FR-1.1) — merges the local cache with live
  results from Edamam, USDA, and Open Food Facts (queried concurrently),
  de-duplicates by identity (`source` + `source_id`, and brand + name for branded
  items), caches external hits, and caps at 30 results. When the local cache
  already returns 10 or more hits (`PROVIDER_FANOUT_FLOOR`) the providers are not
  called at all, and that search is not flagged degraded. Live
  provider hits pass a shared **relevance gate** (every query token must match the
  food's name/brand; if the gate would leave nothing, the ungated hits are shown);
  results are then **ranked by match quality** (exact → name
  prefix → token match) with provider priority only as a tiebreaker. The local
  cache matches **name and brand** with case-insensitive substring plus a **pg_trgm
  trigram fuzzy fallback** (typos / mid-word, e.g. "yoghrt" → "Yogurt"; migration
  0074, gated by `NUTRITION_FUZZY_ENABLED`); fuzzy hits rank just below real matches
  as "did you mean". Matching is **diacritic-insensitive** ("café" → "cafe") and
  **synonym-aware** — the local query is expanded so "courgette" also _retrieves_ a
  local/custom "Zucchini" row (`synonyms.ts`; provider-side expansion is deferred).
  OFF needs no API key,
  so a working OFF call keeps search live even when neither keyed provider is
  configured; search falls back to cached-only with an `apiDegraded` flag only when
  no provider reaches its API.
- **Log a food** (`POST /logs`, FR-1.2) — pick a food + quantity in grams + meal;
  the server derives `logDate` from the instant and the user's timezone.
- **Daily summary** (`GET /summary`, FR-1.3) — the day's entries grouped by meal
  with whole-day macro totals, scaled from per-100g and rounded once after
  summing (`buildDailySummary`). Each entry carries its food's per-100g values, and
  the client totals a meal from them with the same shared function
  (`totalNutrition` in `MealSection`), so the meals add up to the day.
- **Recent foods** (`GET /foods/recent`, FR-1.4) and **favourites**
  (`GET/POST/DELETE /favorites`, FR-1.5) — one-tap re-logging of things you eat
  often. Recents are the 20 foods logged most often in the last 30 days, ties and
  older foods ordered by when they were last logged.
- **Repeat a day / meal** (`POST /logs/repeat`, FR-1.5) — copy a previous day (or
  one of its meals) onto a target day (local today unless the request names one),
  re-stamped to the target instant: now when the target is today, otherwise noon on the target date in the athlete's own timezone (`localTimeOnDate`, `server/timezone.ts`), so the instant always falls on its `logDate`. The page's "Repeat previous day" and each empty
  meal's "Copy yesterday's" copy from the day before the one on screen.
- **Edit / delete entries** (`PATCH`/`DELETE /logs/:id`, FR-1.6) — moving an
  entry's instant recomputes its local `logDate`.

### Phase 2 — Coverage: barcode, custom foods, recipes, servings

Everything the food database doesn't already have.

- **Barcode lookup** (`POST /foods/barcode`, FR-2.1) — cache-first (cached `off`
  rows are keyed by the barcode), then Edamam (when configured), then Open Food
  Facts; the resolved product is cached under its source. An Edamam hit is keyed by
  its Edamam `foodId`, not the barcode, so a repeat scan re-resolves it (the upsert
  still dedupes). The client uses the browser `BarcodeDetector` API with a
  manual-entry fallback.
- **Custom foods** (`POST/PATCH/DELETE /foods`, `GET /foods/custom`, FR-2.2) —
  user-entered per-100g macros + optional named servings, created transactionally.
  Deleting a food that's referenced by a log or a recipe returns `409` (history is
  protected), and so does deleting a recipe's backing food here: the recipe delete
  decides its fate (C39). A new custom food is private; the edit form's **Share
  publicly** switch (`isPublic` on `PATCH /foods/:id`) makes it visible to every
  athlete's search. Once another athlete has logged it or put it in a recipe, its
  name, brand and macros are frozen (`409`; serving size and sharing can still
  change), and that holds after sharing is switched back off (D18,
  `assertLoggedHistoryKept`). A recipe's backing food is not editable or shareable
  through this route. On account deletion the athlete's private custom foods are
  erased (one another athlete still references is handed to them as a private copy
  named "Custom food (removed by its creator)"), while shared ones stay, ownerless
  (`deleteUserAndPrivateCustomFoods`).
- **Named servings** (`POST/DELETE /foods/:id/servings`, FR-2.4) — portions like
  "1 cup" → grams. A portion added here is personal: it can go on any food the
  athlete can see, only they see it, and a repeat of the same label returns the
  existing row. The delete removes a personal portion, or a serving on a food the
  athlete owns; a shared USDA portion can't be deleted. For USDA foods these are **lazily enriched** from the USDA
  food-detail *portions* endpoint on first view and cached (`gramWeight` carries
  the conversion, so volume portions like cups work here even though the
  search-result default serving size skips volume units).
- **Recipes** (`POST/PATCH/DELETE/GET /recipes`, FR-2.3) — compose ingredients;
  the recipe's per-100g macros and micros are **computed from the ingredient list** and
  stored on a hidden backing custom food, so a recipe logs and rolls up through
  the unchanged Phase 1 path. Editing replaces the whole ingredient list (a recipe
  can't list itself, `400`; an edit that would change the name or macros of a
  backing food another athlete has logged is refused with `409`); deleting
  removes the backing food only if no log or other recipe still references it, and
  returns `409` while another of the athlete's recipes uses it as an ingredient
  (C39). Correcting an ingredient's macros, or editing a recipe used inside another,
  recomputes the backing food of each of the athlete's recipes that uses it (nested
  recipes too, each after the recipes it uses), so logging a recipe records what
  its view shows; the athlete's own past logs of the recipe move with it, as their
  logs of the food itself do, while a backing food another athlete has logged is
  left as it was (C40).

### Phase 3 — Training integration

Where fuelling meets the rest of the app.

- **Session fuelling** (`GET /session-fuelling/:workoutId`, FR-3.1/3.2/3.4) —
  splits the foods around a workout into **pre** (the 4h before its start) and
  **post** (the 6h from its start) windows with separate totals. When the workout
  has a real start time (a Strava, Garmin or Health Connect import), same-day
  `pre_workout`/`post_workout` tags are
  attributed first and the clock windows fill in the rest (a back-logged entry's
  tag outranks its synthetic local-noon timestamp); with no start time it falls
  back to the explicit `pre_workout` / `post_workout` meal tags alone. Surfaced
  in the workout detail sheet via `FuellingAroundSessionPanel`. The response also
  carries the session's recommended `target` (`computeSessionFuellingTarget`,
  `shared/sessionFuellingTargets.ts`) and the `gap` left against it. The target
  anchors to bodyweight: 0.4 g/kg carbs before, 0.7 g/kg carbs and 0.3 g/kg
  protein (held to 20–40 g) after, with the carbs scaled by the RPE band (×0.6 up
  to RPE 4, ×1 up to 7, ×1.35 above; no RPE counts as moderate) and by duration
  (no duration counts as 60 minutes). An easy session under 45 minutes gets no
  pre-session carbs, and with no bodyweight on file the target is a flat
  30 g / 60 g / 25 g. Its window and
  targets read the workout's date, device start time, duration and RPE and the
  athlete's bodyweight. The reads built from a workout and the profile are
  refreshed as one list (`WORKOUT_DERIVED_NUTRITION_QUERY_KEYS` in
  `client/src/lib/workoutInvalidation.ts`: every session's fuelling, each day's
  summary, the Timeline fuel chips and the Analytics → Fuelling block, which
  read the day's workouts and training load). Workout writes that go through
  `invalidateWorkoutWriteQueries` (the workout form, the ad-hoc log sheet, set
  edits, offline replay) get the list from there. Writes that invalidate
  their own keys spread it in: the Timeline's logging of a planned session,
  workout delete and bulk delete, skipping or reopening a planned day, moving a
  logged workout, the inline RPE, a Strava or Garmin sync, a device link or
  unlink, a recycle-bin restore, and a profile save in Settings or onboarding.
  Seeding a workout from its plan, re-parsing its text or parsing a photo
  replaces the sets its training load is computed from, so those refresh the
  day summaries, the chips and the block (not session fuelling, which reads no
  sets). Writes that only the day summary reads refresh only the day
  summaries: moving or deleting a planned day, saving its expected duration,
  RPE or start time (`FuellingPlanPanel`), a missed-session recovery and an
  applied coach plan proposal, since a day with no log takes its meal targets
  from the planned session, and a manual log's session time, which sets the
  day's meal timing (session fuelling windows only by a device start time). A new
  write path that changes a workout should do the same. A food-log write
  refreshes session fuelling too.
- **Per-meal fuel targets** (on `GET /summary`, `DailySummaryResponse.mealTargets`)
  — the headline nutrition×training integration. The day's effective target is
  distributed **across the day's meals** so the athlete sees the fuel required for
  _each_ meal, with the primary session's pre/post anchors placed first: carbs are
  front-loaded into a `pre_workout` slot and **breakfast as the post-workout
  recovery meal**, protein spread evenly (with a recovery-meal floor), and fat kept
  off the `pre_workout` slot and low on the recovery meal. The carbs left after
  the anchors, and the fat, are split by weight: breakfast 25 / lunch 30 /
  dinner 30 / snack 15 (`MEAL_SPLIT_WEIGHTS`, renormalised over the meals in
  play). The last snack (dinner on a three-meal day) absorbs the rounding so the
  meals sum to the day. The athlete's
  **Meals per day** preference (`users.meal_schedule`, 3 / 4 / 5, default 4;
  Settings → `NutritionPreferencesCard`) sets the eating meals: three drops the
  snack, five adds `snack_pm`. Each meal carries a `role` + one-line `rationale`.
  The engine is the pure, DB-free `shared/mealFuelling.ts` (`computeMealFuelTargets`),
  reusing `computeSessionFuellingTarget` for the anchors so the numbers match the
  session-fuelling panel exactly. The route resolves the day's primary session (most
  significant **logged** workout, else the most significant **planned** day so
  targets show before the morning session is logged) via `resolveDayTrainingContext`;
  the lookups are gated on an effective target existing, so no-target users pay
  nothing. Targets are computed on the fly (no new table) and surfaced per meal in
  `MealSection` (target header + progress bars + rationale, shown even before
  anything is logged). With a calorie goal and only some macro goals, the
  calories the set macros don't account for are split across the meals by the
  same weights, so the meals still add up to the calorie goal.
  - **Per-meal overrides:** `mergeMealOverride` (applied by
    `applyMealTargetOverrides`) gives a meal's figures under the athlete's
    override; a blank field keeps the split's figure. The meal keeps its share
    of the calorie goal while a macro the day leaves unset is still at 0 g:
    pinning lunch's protein adds the extra protein's energy rather than
    rebuilding lunch from its macros alone (2,500 kcal + 150 g protein: lunch
    goes from 720 to 770 kcal at 50 g protein), and pinning a macro the day
    leaves unset draws on the share first. Once every macro has a figure the
    share has no macro left to stand for, so the meal's energy is its macros:
    lunch pinned to 50 g protein, 80 g carbs and 20 g fat reads 700 kcal, not
    770. The dropped share is not moved to other meals (overrides never
    re-reconcile); the day is still judged against its calorie goal.
  - **Calorie precedence**, first match wins:
    1. All three macros are pinned, one differs from the split, and the meal no
       longer keeps a share of the calorie goal (it had none, or every macro the
       split left at 0 g is now pinned above it): the calories are the macros'
       energy and a pinned calorie figure is ignored. Rows saved by the old
       editor, which echoed every shown value, hold a calorie echo beside each
       macro edit.
    2. Pinned calories win and are kept as set, beside partly pinned macros,
       macros that match the split or 0 g echoes, so a calorie edit on a
       calorie-only day, sent with 0 g macros, is kept.
    3. A changed macro recomputes the meal's calories; otherwise the split
       stands.

    A 0 g pin on a macro the split leaves at 0 g counts as the old editor's echo
    of the split, not a figure, only while the meal holds a share of a calorie
    goal (its split calories exceed its macros' energy): on 2,500 kcal + 150 g
    protein, {900 kcal, 50 g protein, 0 g carbs, 0 g fat} keeps its 900 kcal.
    With no share to keep (for instance no calorie goal, set macros that
    already reach it, or a slot the calorie split skips, like the fasted
    `pre_workout` snack) the split's calories are its macros' energy and a 0 g
    pin is a figure like any other: on a 160 g protein day with no calorie goal
    the same pin reads 200 kcal, and the dialog locks the calories at 200.
  - **Meal target dialog:** the merged meal carries the stored `override` and
    the split it replaced (`suggested`), so `MealTargetDialog` fills in only the
    pinned fields (less a calorie figure the pinned macros overrule) and runs
    the same `mergeMealOverride` over what is typed: each placeholder shows
    what the meal will read with that field blank. When the pinned macros set
    the calories, the calorie field shows their figure read-only, described by
    a note (announced with the field) to clear a macro to set calories, and a
    polite live region announces the lock as the third macro is typed. A save
    sends what the athlete pinned (a blank field follows the suggestion,
    clearing a field unpins it, and a locked calorie field pins nothing), not
    every shown value. A meal-override save applies from local today on, while
    a reset deletes every version of the meal's override, so it changes past
    days too; either refreshes every cached day summary.
  - **Session timing:** the workout's local time-of-day selects which meals are the
    pre/recovery meals (`workoutTiming` = `am_pre_breakfast` | `midday` | `evening`,
    or `none` on a day with no session, which gets the weighted split with no anchors):
    morning (before 11:00) → a `pre_workout` slot + breakfast recovery; midday
    (11:00–14:59) → breakfast carb-loads, lunch recovers; evening (15:00 on) → lunch
    carb-loads, dinner recovers. The time comes from the
    plan day's `plannedTimeOfDayMin`, a manual log's `timeOfDayMin`, or a device import's
    `startedAt` (`resolveDayTrainingContext` → `timingFromLocalHour`); unset falls back to
    the morning assumption.
- **Block view** (`GET /block`, FR-3.3) — a daily series joining intake macros to
  training **UTSS** (unified training stress) over a date range, zero-filled so
  every day has a point. Each point also carries the day's load-scaled
  `carbTargetG`, mean session RPE and plan compliance, and the response a
  `correlation` (`analyzeFuellingCorrelation`, `shared/fuellingCorrelation.ts`):
  RPE and compliance on days the athlete reached at least 90% of the carb target
  against days they didn't, counting only days with food logged and reported only
  with 3 or more days in each group. Rendered in **Analytics → Fuelling**
  (`FuellingTab` → `IntakeVsTrainingChart` + `FuellingCorrelationCard`, which runs
  the same shared calculator over the points). The tab's "All time" looks back 365
  days (`MAX_BLOCK_DAYS`); the server refuses a range longer than 731 days
  (`NUTRITION_RANGE_MAX_DAYS`).

### Phase 4 — Natural-language & photo logging

The fastest way to log without searching.

- **Describe a meal** (`POST /parse/text`, FR-4.1) — free text → Gemini fast model
  → a structured list of `{name, quantityG, displayAmount, mealType, confidence}`
  items. The server resolves each name against the **local cache only** and
  attaches a scaled nutrition preview; unresolved names come back with
  `foodId: null` for the user to match.
- **Snap a meal** (`POST /parse/photo`, FR-4.1) — a meal/menu/label photo → Gemini
  vision model → the same item contract (10 MB body limit).
- **Review & confirm** — `ParsedMealReviewSheet` lets the athlete adjust quantity,
  meal, and food match per item before committing. **Confirmation** posts to
  `POST /logs/batch`, which inserts all rows atomically with `entryMethod` and the
  original `rawInput` recorded as provenance.
- **Scan a label** (`POST /parse/label`) — a photo of a nutrition facts panel →
  Gemini vision model, asked to transcribe what is printed and return `null` for
  anything that isn't. `labelParser.ts` then does the arithmetic in code: kJ →
  kcal, and per-serving → per-100g when the label states the serving's weight in
  grams (without one the macros are left blank rather than assumed). A printed
  servings-per-container count above 1, beside a gram serving size, adds a
  "Whole package" serving. The result
  prefills `CustomFoodDialog`; nothing is saved until the athlete saves the food.
  An image with no readable panel returns `200` with `label: null`.

The parser is **suggestions-only**: nothing is logged until the user confirms, and
the AI never supplies the nutrition numbers — only the portion estimate and a name
to resolve against real food data.

### Phase 5 — Insights & coaching

- **Targets** (`GET/POST /targets`, FR-5.2) — set calorie/protein/carb/fat goals;
  versioned by `effectiveFrom` so history is preserved (delete-then-insert per
  date). The daily header shows progress bars against the day's effective target
  (below).
  - **Training-aware effective target** (`shared/nutritionTargets.ts` →
    `effectiveTargetWindowed`; server `fetchTrainingLoadWindow` →
    `buildEffectiveTargetSummary`). With periodisation on, the day's carbs/calories
    (and protein, on recovery days) flex with a *window* of training rather than
    just today's load, broken into transparent components on `EffectiveTargetSummary`
    (`baseLoadDeltaG` / `recoveryDeltaG` / `preloadDeltaG` / `proteinDeltaG` +
    `reasonCodes` + `explanation`):
    - **base load** — today's UTSS vs the reference (the original behaviour):
      (UTSS − `reference_utss`) × `carb_grams_per_utss`;
    - **recovery (PAST)** — after hard recent days (high acute load / negative TSB),
      keep carbs up for glycogen resynthesis and bump protein for repair, so a light
      day inside a hard block doesn't snap to baseline. The carbs are half the gap
      between the trailing 7-day mean UTSS (rest days included) and today's, times
      the slope; the protein bump is up to `recovery_protein_bump_frac` of the
      baseline protein (15% by default), scaled by that gap and by a negative TSB;
    - **pre-load (FUTURE)** — bring carbs forward ahead of a big upcoming planned
      session (estimated via `estimatePlannedDayUtss` over `getUpcomingPlannedDays`;
      sessions up to `preload_days_ahead` days out count, weighted by 1/days-ahead,
      and the server looks at most 2 days ahead) and carb-load through **race week**
      (+25% of the baseline carbs, and a light race-week day is not cut). In
      **taper** the load-driven change is damped instead: a rise to 85%, a cut to
      half. The phase comes from the active plan (`computePlanPhase`).
    Each adjustment is opt-in via versioned columns on `nutrition_targets`
    (`recovery_enabled`, `preload_carb_grams_per_utss`, `preload_days_ahead`,
    `phase_aware`, `recovery_protein_bump_frac`, `max_carb_delta_g`); a flat or
    load-only target is byte-for-byte unchanged, and the analytics block view stays
    pure load-correlation (single-day window). The Timeline's `/summary-range`
    resolves each day exactly as `/summary` does — the same window, built by
    `fetchTrainingLoadWindows` from a load history that starts on a fixed 28-day
    grid at least the EWMA warmup before the day — so a chip and the Nutrition page
    show the same target, whatever range was asked for (C31). The total carb delta
    is capped (`max_carb_delta_g`) so recovery + pre-load + phase can't compound,
    and carbs never go below 0 g. The calorie floor (1,200 kcal,
    `ABSOLUTE_CALORIE_FLOOR`) only
    stops load scaling from cutting a day below it: a baseline already under the
    floor (a manual 1,000 kcal target) keeps its own number (C47). Surfaced in
    `DailyTotalsHeader` (carb + protein notes, full breakdown on hover) and toggled
    in `TargetsDialog`, which has two switches: "Scale carbs by training load"
    (`periodization_enabled`) and, under it, "Adapt to recent & upcoming training",
    which turns recovery, pre-load and phase-awareness on or off together. A first
    periodised save takes its numbers from `defaultPeriodizationConfig`: the
    reference is the athlete's 28-day chronic load from the training overview
    (never under 25 UTSS; 50 UTSS, with a note in the dialog, when there is no
    history), the slope is half the baseline carbs over the reference, the
    pre-load rate half the slope one day ahead, and the cap 75% of the baseline
    carbs.
- **Micronutrients** (`GET /micros`, FR-5.1) — the day's totals for a curated set
  of **14 micros** (sodium, potassium, calcium, iron, magnesium, zinc, vitamins C,
  A, D, E, K, B6, B12, folate) against FDA reference daily intakes, shown as
  `%RDI`. Only micros the day's foods actually carry data for are shown — *absent
  ≠ zero*.
- **AI nutrition insights** (`GET`/`POST /insights`, FR-5.3) — a single-shot Gemini
  *reasoning*-model analysis of the last **14 days**: average macros and logging
  consistency, intake vs. training load (flagging under-fuelled high-UTSS days),
  comparison to targets, watch-outs, and a focus for the next 1–2 weeks. The `GET`
  returns the last stored analysis instantly (no AI spend) with a `stale` flag if a
  food-log entry has been added or deleted since (the latest log date or the entry
  count moved; an edit in place doesn't count); the `POST` regenerates it. A stale
  stored analysis is also regenerated at the athlete's local midnight by the
  analytics recompute scheduler (`analyticsRecomputeScheduler.ts`), which skips
  the AI call without consent or budget (`generateNutritionInsightsIfAllowed`).
- **Push reminders** (`server/services/nutrition/reminders.ts`) — two opt-in,
  push-only nudges, off by default (`users.push_refuel_reminder`,
  `users.push_logging_reminder`; toggled in Settings → Notifications), sent by
  the hourly `nutritionReminders` cron over whichever push channels are
  configured (see [Integrations → Web Push Notifications](integrations.md#web-push-notifications)):
  - **Refuel** — when the athlete's latest device-timed session ended between
    45 minutes and 3 hours ago and its post-session target still has at least
    20 g of carbs or 15 g of protein outstanding. A session with no logged
    duration is taken as an hour long. Deep-links to `/nutrition` with the
    post-workout meal selected. At most one per session.
  - **Evening log** — at 20:00 in the athlete's timezone, when nothing is
    logged for today and they have logged within the last 14 days, so a
    lapsed or never-started athlete is not nagged. One per local day.

  Both claim the send before sending: a failed push forgoes the nudge rather
  than risk a duplicate.

---

## 5. API surface

All routes are under `/api/v1/nutrition`, require Clerk auth, validate with Zod,
and are rate-limited per user and per limiter (window = 60 s, `server/constants.ts`).
The whole tree returns **404** when `NUTRITION_ENABLED !== "true"` (server-side, so
a forced client flag can't reach it). Every `YYYY-MM-DD` date, in a query or a body,
must be a real calendar day with a four-digit year from 0100 on: `2026-02-30` or
`0050-01-01` gets a **400** rather than a rolled-forward date or a database 500
(`isoDate` in `shared/schema/nutrition.ts`, over the shared `isIsoCalendarDate()`; C49).
The `from` / `to` of `/block` and `/summary-range` must also fall between
1900-01-01 and 2100-12-31 and run forwards. `/block` answers a span over 731 days
(`NUTRITION_RANGE_MAX_DAYS`) with a **400**; `/summary-range` narrows a wider one
to 731 days around the athlete's today (`clampNutritionRange`) and reports the
`from` / `to` it served.

| Method | Path | Purpose | Rate bucket (max/window) |
|--------|------|---------|--------------------------|
| GET | `/foods/search` | Search local cache + Edamam + USDA + Open Food Facts | `nutritionSearch` (30) |
| GET | `/foods/recent` | Recently logged foods | `nutritionRead` (60) |
| GET | `/foods/custom` | User's custom foods | `nutritionRead` (60) |
| POST | `/foods/barcode` | Barcode → food (cache → Edamam → OFF) | `nutritionBarcode` (30) |
| POST | `/foods` | Create custom food (+servings) | `nutritionWrite` (30) |
| GET | `/foods/:id` | Food + named servings | `nutritionRead` (60) |
| PATCH | `/foods/:id` | Edit custom food, or share it (`isPublic`); 409 once another athlete's history depends on its name or macros | `nutritionWrite` (30) |
| DELETE | `/foods/:id` | Delete custom food (409 if referenced) | `nutritionWrite` (30) |
| POST | `/foods/:id/servings` | Add a personal named serving to any visible food | `nutritionWrite` (30) |
| DELETE | `/foods/:id/servings/:servingId` | Delete a personal serving, or one on the athlete's own food | `nutritionWrite` (30) |
| GET | `/favorites` | List favourites | `nutritionRead` (60) |
| POST | `/favorites` | Add favourite | `nutritionFav` (30) |
| DELETE | `/favorites/:foodId` | Remove favourite | `nutritionFav` (30) |
| POST | `/logs` | Log a food | `nutritionLog` (60) |
| GET | `/summary` | Daily totals + meals, with the effective target, per-meal fuel targets and energy balance | `nutritionRead` (60) |
| GET | `/session-fuelling/:workoutId` | Pre/post-session fuelling | `nutritionRead` (60) |
| GET | `/planned-session-estimate/:planDayId` | A planned session's estimated duration/RPE to prefill the fuelling panel (deterministic + run-pace personalised; optional AI nudge soft-gated inline, see §7) | `nutritionRead` (60) |
| GET | `/block` | Intake macros vs. training UTSS, with each day's carb target, RPE and compliance and the carb-hit correlation | `nutritionRead` (60) |
| GET | `/summary-range` | Per-day intake totals, load-adjusted effective target and post-workout-fuel flag over a range (Timeline fuelling chips) | `nutritionRead` (60) |
| PATCH | `/logs/:id` | Edit a log entry | `nutritionLog` (60) |
| DELETE | `/logs/:id` | Delete a log entry | `nutritionLog` (60) |
| POST | `/logs/repeat` | Repeat a day/meal | `nutritionLog` (20) |
| POST | `/parse/text` | NL meal → items **(AI)** | `parse` (5) + consent + budget |
| POST | `/parse/photo` | Photo → items **(AI)** | `parse` (5) + consent + budget |
| POST | `/parse/label` | Nutrition-label photo → per-100g macros to prefill a custom food **(AI)** | `parse` (5) + consent + budget |
| POST | `/logs/batch` | Confirm reviewed items | `nutritionLog` (60) |
| GET | `/targets` | Current target + history | `nutritionRead` (60) |
| POST | `/targets` | Set/replace target version | `nutritionWrite` (30) |
| POST | `/meal-targets` | Upsert a per-meal target override (`effectiveFrom` defaults to local today) | `nutritionWrite` (30) |
| DELETE | `/meal-targets/:mealType` | Clear a meal's override (404 for an unknown meal) | `nutritionWrite` (30) |
| GET | `/micros` | Day's micros vs. RDI | `nutritionRead` (60) |
| GET | `/insights` | Last stored AI analysis | `nutritionRead` (60) |
| POST | `/insights` | Regenerate analysis **(AI)** | `suggestions` (3) + consent + budget |
| POST | `/recipes` | Create recipe | `nutritionWrite` (30) |
| GET | `/recipes` | List recipes | `nutritionRead` (60) |
| GET | `/recipes/:id` | Recipe + ingredients + per-serving | `nutritionRead` (60) |
| PATCH | `/recipes/:id` | Edit recipe | `nutritionWrite` (30) |
| DELETE | `/recipes/:id` | Delete recipe | `nutritionWrite` (30) |

> **Note:** the nutrition routes are registered with the OpenAPI registry in
> `shared/openapiRoutes/nutrition.ts`, so they are in `docs/openapi.json` and
> Swagger UI with their request and response schemas, the `NUTRITION_ENABLED` 404
> and the AI routes' consent, budget and provider errors.

---

## 6. Client UI map

The page is `client/src/pages/Nutrition.tsx`; data access is centralised in
`client/src/hooks/useNutrition.ts` (TanStack Query) over the typed client in
`client/src/lib/api/nutrition.ts`.

**Page layout (top → bottom):** date navigator → `DailyTotalsHeader` (calories +
macros with target progress bars) → `EnergyBalanceCard` (the day's energy in vs. out,
when the profile supports a BMR) → `FoodSearch` + `QuickAddBar` (recent/favourite
chips) → one **Log food** action (`LogFoodActions`, a sheet with Describe / Snap /
Scan / Label capture rows plus a Custom food / Recipe / Targets row) →
one `MealSection` for each meal that has a target or an entry →
`MicronutrientPanel` (once the day has an entry) → `MyFoodsSection` (manage custom
foods & recipes) → `NutritionInsightsPanel`. A day with no entries and no meal
targets shows a "Repeat previous day" prompt instead of the meal sections, or
`FirstRunStarter` for an athlete with no recent foods and no favourites. The page
opens on `?date=YYYY-MM-DD` when the URL carries one (the Timeline fuel chip
links that way), and `?meal=` seeds the meal picker of every log started that
visit (the workout sheet's "Log recovery meal" passes `post_workout`).

| Component | Role |
|-----------|------|
| `DailyTotalsHeader` | Running calorie/macro totals + progress vs. targets. |
| `EnergyBalanceCard` | The day's energy in vs. out from the summary's `energy`; renders nothing when the profile can't support a BMR. |
| `FoodSearch` | Debounced (300 ms, 2+ char) search with a degraded-API banner; opens `LogFoodDialog`. Enter picks the top hit only from results for the text as typed: mid-debounce it runs the search at once and picks when that answer lands. |
| `QuickAddBar` | Horizontally scrollable favourite and recent chips. A favourite logs in one tap at the portion and meal it was last logged in, with an Undo toast (`useQuickLog`); a recent chip, or a favourite never logged, opens `LogFoodDialog`. |
| `LogFoodDialog` | Create or edit an entry: quantity + unit (named servings, with add/remove of a personal portion) + meal, with a live nutrition preview. When editing, the "effect on today's goals" swaps the entry's saved serving for the new one, and an untouched amount is not re-sent, so the stored grams survive a meal-only edit. |
| `MealSection` | One meal's target header (logged / target kcal, per-macro bars, rationale) and its entries with favourite, "log again today", edit and delete. An empty meal offers "Copy yesterday's"; a meal with two or more entries offers "Save as recipe", which opens `RecipeBuilderDialog` prefilled with them. |
| `MealTargetDialog` | Pin or reset one meal's target (see [Phase 3](#phase-3--training-integration)). |
| `FirstRunStarter` | Empty-day prompt for an athlete who has never logged: describe a meal, scan a barcode, set targets. |
| `BarcodeScanner` | `BarcodeDetector` camera scan (rear camera) + manual fallback. |
| `CustomFoodDialog` | Create/edit a custom food (per-100g macros; named servings on create; a "Share publicly" switch on edit). Opens prefilled from a label scan, where "Save & log" chains into `LogFoodDialog`. |
| `RecipeBuilderDialog` | Search & add ingredients; live per-serving preview. |
| `LogFoodActions` | Single "Log food" button opening a sheet with the capture/create entry points below. Owns the photo and label parses, so a parse still opens its review after the sheet is dismissed; the button shows a spinner meanwhile. |
| `DescribeMealDialog` | Free-text meal entry → parse → review sheet. |
| `SnapMealButton` | Photo capture (OS camera / file picker), handed to `LogFoodActions` for the vision parse → review sheet. |
| `ScanLabelButton` | Label photo capture, handed to `LogFoodActions` for the label parse → `CustomFoodDialog`. |
| `ParsedMealReviewSheet` | Adjust/match/remove parsed items before batch logging. |
| `MicronutrientPanel` | Day's micros vs. RDI, with an empty state when no micro data exists. |
| `MyFoodsSection` | Manage custom foods + recipes. |
| `TargetsDialog` | Set calorie/macro goals (partial goals allowed). |
| `NutritionInsightsPanel` | Show last AI analysis + regenerate. |

The three AI capture entries (describe, snap, label) go through `useAiConsentGate`:
with AI consent off, the consent dialog opens in place and the action resumes once
the athlete accepts.

**Cross-feature surfaces:** `FuellingAroundSessionPanel` (workout detail sheet)
and `FuellingTab` (Analytics) consume `useSessionFuelling` and `useBlockView`.
`FuellingPlanPanel` (a planned workout's sheet) shows the fuelling target for
the session's expected duration and RPE, seeded from its exercise table and
`GET /planned-session-estimate/:planDayId`, and the Timeline's day chips
(`FuellingDayChip`) read `useFuellingRange`.

**Hooks** — 14 query hooks (`useNutritionDay`, `useSearchFoods`, `useRecentFoods`,
`useFavorites`, `useFoodWithServings`, `useCustomFoods`, `useRecipes`, `useRecipe`,
`useNutritionTargets`, `useMicros`, `useNutritionInsights`, `useSessionFuelling`,
`useBlockView`, `useFuellingRange`), two derived selectors over those caches
(`useFavoriteIds`, `usePortionMemory`), and ~22 mutation hooks covering
log/edit/delete, favourites, repeat-day, barcode, custom foods and servings,
recipes, parse text/photo/label, batch log, targets and per-meal overrides,
and insights regeneration — each invalidating the relevant query keys. A target
save (here or in onboarding) refreshes every read that carries the target
(`NUTRITION_TARGET_QUERY_KEYS`: the targets, each day's summary, the Timeline
fuel chips and the Analytics → Fuelling block). A food-log write (log, edit,
delete, repeat-day, batch log) refreshes the day, its micros, the fuel chips,
the Fuelling block and every workout's pre/post intake (`useSessionFuelling`);
editing a custom food or recipe refreshes every day's summary and micros too,
since its logged entries read it live. The offline replay refreshes the same
reads for every day, as it doesn't know which days it touched. The online
hooks and the replay share one list (`client/src/lib/nutritionInvalidation.ts`).
Entry deletes use pending UI. The favourite toggle shows its flip locally in
`FavoriteStarButton` rather than writing the favourites cache: a star can be
tapped from a meal row, which knows only a food's id and name — not enough to
synthesise the `Food` that list holds.

`GET /foods/recent` and `GET /favorites` both return `FoodWithPortionMemory` —
each food plus the `lastQuantityG` / `lastMealType` it was last logged in (null
for a favourite starred but never logged). That powers one-tap logging from the
favourites chips and pre-fills `LogFoodDialog` with the portion the athlete
actually uses. The hint is seeded in grams rather than mapped onto a named
serving: it runs in a `useState` initializer, before `useFoodWithServings` has
resolved.

Editing an existing entry does map back. `LogFoodDialog` runs the same count +
unit control in both modes, and `matchPortionForGrams` re-expresses the entry's
stored grams in the friendliest named portion available — 190 g of a food with a
95 g "1 slice" portion reopens as "2 slices". A portion qualifies when it divides
the quantity into a whole or half count within a 2% tolerance; the largest
qualifying portion wins, and grams are the fallback. Because the servings arrive
after first render, the count and unit are **derived** state (null until the
athlete touches them) rather than `useState` initializers or a reset effect —
`useAddServing` invalidates the very query the seed reads from, so an effect
would stomp typed input the moment a portion was added. The stored value is
unaffected: `food_log_entries` holds grams only, and the dialog still submits
grams.

---

## 7. AI usage & safety

Six AI touchpoints, all on Gemini by default (`AI_TEXT_PROVIDER` can move the
`fast` / `reasoning` text roles to another provider), all opt-in and budgeted:

| Touchpoint | Model role | Default model | Output |
|------------|-----------|---------------|--------|
| Describe a meal (`/parse/text`) | `fast` | `gemini-2.5-flash-lite` | JSON items (portion estimate only) |
| Snap a meal (`/parse/photo`) | vision | `gemini-2.5-flash` | JSON items from the image |
| Scan a label (`/parse/label`) | vision | `gemini-2.5-flash` | JSON transcription of the printed panel; unit and per-serving → per-100g conversion happen in code, and the result only prefills the custom-food form |
| Nutrition insights (`/insights`) | `reasoning` | `gemini-3.1-pro-preview` | Markdown analysis |
| Semantic food search (`/foods/search`, off by default) | embedding | `gemini-embedding-001` | Extra related foods, appended when keyword/fuzzy is sparse |
| Planned-session estimate (`/planned-session-estimate/:planDayId`, soft-gated) | `fast` | `gemini-2.5-flash-lite` | JSON duration/RPE nudge, clamped to ±20% / ±2 RPE of the deterministic + pace-personalised estimate |

Safety properties:

- **Consent + budget gating.** `aiConsentCheck` blocks unless the user has the AI
  coach enabled (403); `aiBudgetCheck` blocks at a rolling 24h spend of **$2.00**
  per user (429) and warns past **$1.50** via an `X-AI-Budget-Warning` header, and
  also enforces the application-wide ceiling (`AI_GLOBAL_DAILY_LIMIT_CENTS`, 503
  `AI_GLOBAL_BUDGET_EXCEEDED`) when one is configured. An
  `AI_FEATURES_ENABLED=false` kill switch 503s all AI routes. See
  [AI → Cost controls](ai-and-rag.md#cost-controls).
- **Semantic search is soft-gated, not a hard AI route.** `/foods/search` keeps
  keyword/fuzzy search working for everyone (no `aiConsentCheck`/`aiBudgetCheck`
  middleware — those would 403/429 plain search). The embedding step
  (`semanticSearch.ts`) instead checks the flag, consent, and budget *inline* and
  only fires when the keyword/fuzzy set is thin (< 5 hits), so it stays off the hot
  path; any failure (no key/consent/budget, vector error) degrades silently to the
  keyword results. Query embeddings are LRU-cached, and foods are embedded by a
  bounded background cron, so repeated searches don't re-bill. The cron runs every
  30 minutes, embeds up to 200 foods a run (`embedMissingFoods`) and takes only
  shared rows, public custom foods and the custom foods of athletes who have AI
  consent on; ids it returns are resolved back through `getVisibleFoodsByIds`.
  Its spend is recorded in `ai_usage_logs` with no athlete (`food_embedding`), so
  it counts toward `AI_GLOBAL_DAILY_LIMIT_CENTS`, and a run is skipped once that
  ceiling is reached.
- **The planned-session estimate is soft-gated the same way.**
  `/planned-session-estimate/:planDayId` must serve every athlete, because its
  deterministic and pace-personalized layers are not AI, so it carries no consent
  middleware. The optional AI refinement on top checks `aiCoachEnabled` inline
  before any data leaves the server, and the consent flag is part of the result's
  cache key so opting out immediately stops a previously refined value being
  replayed. Plan-day focus text and exercise names are escaped and fenced in
  `<user_input>` like every other prompt input.
- **Numbers are never AI-sourced.** The parser returns a name + grams; nutrition
  is resolved from real `foods` rows. Insights are instructed to use *only* the
  supplied aggregates and not to invent foods or numbers.
- **Prompt hardening.** The meal-parse, label and insights prompts carry an
  anti-exfiltration instruction; user input is sanitised and never logged raw.
- **Lenient parsing.** Malformed AI items are coerced or dropped without failing
  the whole request, so one bad line doesn't lose the meal.

The insights context builder (`nutritionInsightsService.ts`) compacts 14 days of
intake, training load, targets, and low micros (<50% RDI) into a short prompt and
mirrors the existing `coachInsightsService` pattern. Micros are judged on the
latest *complete* logged day (`microDate` on the shared summary), never the
part-eaten local today, and the prompt notes that only foods carrying micro data
count (Edamam foods carry none): low figures carry `MICRO_COVERAGE_CAVEAT` (a
low figure may be a data gap), and an all-clear carries `MICRO_ALL_CLEAR_CAVEAT`
(a micro no counted food reports is never judged, so an all-clear can miss a
gap). The AI coach's fuelling section (`server/prompts/nutritionContext.ts`)
names the same day and carries the same low-figure caveat.

---

## 8. External data sources (USDA & Open Food Facts)

Three external sources feed search/barcode (Edamam, USDA, Open Food Facts); the
two flagship ones are compared below. Edamam (curated branded/generic, per-100g)
is the preferred search tier when configured (`EDAMAM_APP_ID`/`EDAMAM_APP_KEY`),
and barcode lookup tries it ahead of Open Food Facts.

| | USDA FoodData Central | Open Food Facts |
|---|---|---|
| Used for | Food **search** + named portions and micros (backfilled on food-detail open) | Food **search** + **barcode** lookup |
| Endpoint | `/fdc/v1/foods/search`, `/food/{id}` | `/cgi/search.pl` (search), `/api/v2/product/{code}.json` (barcode) |
| Auth | `USDA_API_KEY` (free) — **missing key ⇒ USDA is skipped** (no call; search carries on with the other providers, and food detail and refresh leave the row as cached) | none; custom `User-Agent` required by policy |
| Caching | Upserted into `foods` keyed by `(usda, fdcId)`; portions cached in `food_servings` | Upserted into `foods` keyed by `(off, barcode)` |
| Timeout / retries | 8 s/attempt; retry 429/5xx with jitter (2 search, 1 detail) | 8 s; 2 retries (barcode), 1 retry (search — tighter ~10 req/min/IP limit); cache-first |
| Result quality | Lab-verified; the search request sets `requireAllWords` | Crowd-sourced; a product with no energy value and a completeness score under 0.5 is rejected (`isAcceptableOffProduct`) |
| Unit handling | Per-100g already; energy nutrient IDs `1008/2047/2048`; micros read unit-filtered (mg/µg). A Branded food missing a per-100g macro falls back to its per-serving label value scaled by the serving's grams | Micros: `*_100g` reported in **grams** → multiplied by `1000`/`1e6` to mg/mcg (the one guard against the classic 1000× error). Energy: `energy-kcal_100g`, else the kJ field × 0.239 |

Search hits from every provider, Edamam included, pass the same **relevance gate**
in `foodSearch.ts` before being surfaced (`isRelevantMatch` in `relevance.ts`:
every query token must prefix a word of the name or brand, or equal one up to a
plural or a registered synonym). The local cache is not gated.

The cache is refreshed lazily rather than expired (`refresh.ts`). Every upsert
replaces the row's name, brand, serving size and macros but merges `micros` key by
key (`upsertFoods`), so a sparse search hit doesn't wipe the micros a USDA detail
read filled in. Every upsert
stamps `lastFetchedAt`; a shared external row older than 60 days (or never stamped)
is re-fetched from its source in the background when a search result or a barcode
cache hit serves it, at most 3 per request. The athlete gets the cached row
instantly, a failed refresh leaves it in place, and custom foods (no upstream) are
never refreshed. A refetch that fails or finds nothing is not tried again by that
instance for 6 hours, and one food is never refreshed twice at once, so a row its
source no longer has doesn't cost an upstream call on every response (PF13).

---

## 9. Configuration & feature flags

| Variable | Layer | Effect |
|----------|-------|--------|
| `NUTRITION_ENABLED` | server | `default "true"`. `!= "true"` ⇒ the whole `/api/v1/nutrition` tree 404s. |
| `VITE_NUTRITION_ENABLED` | client (build) | Gates the page route + sidebar nav (`featureFlags.nutritionEnabled`, default `true`). |
| `USDA_API_KEY` | server | Enables the USDA provider (search, the food-detail portions and micros backfill, stale-row refresh); absent ⇒ USDA is skipped and search runs on Open Food Facts, plus Edamam when configured. |
| `EDAMAM_APP_ID` / `EDAMAM_APP_KEY` | server | Optional; enable Edamam for search and barcode lookup. Env validation rejects one without the other; unset ⇒ USDA + Open Food Facts only. |
| `NUTRITION_FUZZY_ENABLED` | server | `default "true"`. Gates the pg_trgm trigram (typo) arm of local search; `"false"` falls back to exact substring (kill switch / pre-migration). Synonyms + diacritics are unaffected. |
| `NUTRITION_SEMANTIC_ENABLED` | server | `default "false"`. Gates **semantic (embeddings) search** — both the query-time vector lookup and the background embedding-backfill cron. Requires `AI_FEATURES_ENABLED != "false"` + `GEMINI_API_KEY`; reuses the pgvector pool (`VECTOR_DATABASE_URL`, falls back to the main DB). Safe to leave off — keyword/fuzzy search is unaffected. |
| `GEMINI_API_KEY` / `GEMINI_MODEL` / `GEMINI_VISION_MODEL` / `GEMINI_SUGGESTIONS_MODEL` | server | The six AI touchpoints (incl. `gemini-embedding-001` for semantic search). |
| `AI_FEATURES_ENABLED` | server | Global AI kill switch. |

Gate `VITE_NUTRITION_ENABLED` and `NUTRITION_ENABLED` together per tier (`.env.example` notes this).

---

## 10. Testing

The module is heavily unit-tested, with the pure-math core (`rollup.ts`,
`recipe.ts`, `blockView.ts`, `sessionFuelling.ts`, `micros.ts`) deliberately
DB-free for fast, exhaustive coverage. There are co-located tests for the external
clients (`usdaClient.test.ts`, `offClient.test.ts`, `edamamClient.test.ts`), the meal parser, the route
layer (`nutrition.routes.test.ts` drives the router composed by
`registerNutritionRoutes`; `server/routes/__tests__/nutrition.partition.test.ts`
pins the index export and the full 38-endpoint table across the sub-modules), and
most client components (e.g.
`LogFoodDialog.test.tsx`, `ParsedMealReviewSheet.test.tsx`, `MicronutrientPanel.test.tsx`).

---

## 11. Improvements & roadmap

Grouped by theme and roughly prioritised. **P1** = correctness / trust / compliance,
**P2** = athlete value, **P3** = polish.

### Correctness, trust & compliance

- **[DONE] Include nutrition in the GDPR data export.** The JSON export now carries a
  `nutrition` section (food log with food names, nutrition and meal targets,
  favourites, recipes with ingredients, the athlete's custom foods and servings),
  read by `server/storage/dataExport.ts`. A closed-world sweep in
  `exportService.test.ts` fails when a new user-owned table is neither exported nor
  excluded with a reason (P7, CODEBASE_ANALYSIS_2026-10-03).
- **[DONE] Register the routes with the OpenAPI registry.** All 38 nutrition
  operations are in `shared/openapiRoutes/nutrition.ts`, so the contract is
  CI-gated like the rest of the API (`test/docs/openapiCoverage.test.ts`,
  `openapi-breaking.yml`).
- **[DONE] Sanity-filter per-100g values at import.** A NaN/negative/absurd macro
  from a source used to be cached as-is, silently poisoning every future log of
  that food. `sanitizeMappedFood` (`sanitize.ts`) now runs at the single cache
  boundary (`upsertFoods`) for every provider: a non-finite, negative or
  over-ceiling field becomes `null` (absent) rather than a rewritten number, and a
  food with no name or no usable macro is dropped.
- **[DONE] Cache freshness / TTL.** The `foods` cache used to never expire, so a
  reformulated product or corrected USDA entry stayed wrong forever. Every upsert
  now stamps `lastFetchedAt`, and rows older than 60 days (or never stamped) are
  re-fetched in the background when served (`refresh.ts`; see
  [§8](#8-external-data-sources-usda--open-food-facts)).

### Athlete value — Hyrox-specific opportunities

This is a *Hyrox companion*, and the nutrition module is currently sport-agnostic.
The biggest unrealised value is connecting fuelling to the race itself:

- **[P2] Race-day & race-week fuelling plan.** Phase-aware targets now carb-load
  through race week (+25% of baseline carbs) and damp load-driven carb changes
  during taper (see [Phase 5](#phase-5--insights--coaching)), but there's no
  race-morning fuelling timeline and no during-race fuelling plan despite the app
  knowing the user's goal race date. A "Race Fuelling" view (carb-load taper
  week → race-morning timing → in-race gels/hydration) would be a flagship feature.
- **[P2] Carb-per-kg and protein-per-kg targets.** Endurance/strength athletes
  think in g/kg bodyweight, not absolute grams. Targets are absolute-only today;
  add bodyweight-relative targets and surface "you hit 4.2 g/kg carbs on a
  high-load day".
- **[P2] Hydration & sodium logging.** Hyrox is sweat-heavy and the micro panel
  already tracks sodium/potassium, but there's no water logging at all. Add water
  + electrolyte tracking, especially around sessions.
- **[DONE] Periodised / training-day-aware targets.** One target used to apply to
  every day. Shipped as the auto-scaling option: with periodisation on, the daily
  view's effective target flexes with training via `effectiveTargetWindowed`
  (today's UTSS, recent actual load, upcoming planned load and plan phase — see
  [Phase 5](#phase-5--insights--coaching)), and block-view points carry the day's
  load-adjusted `carbTargetG`, which the Analytics Fuelling tab's
  `FuellingCorrelationCard` scores intake against. _Remaining:_ separate
  training-day vs. rest-day target templates.

### Athlete value — general

- **[DONE] Calculated targets from the profile.** Targets used to be 100% manual.
  `TargetsDialog` now has a **Calculate from profile** button (enabled once
  bodyweight, height, age, activity level and weight-goal direction are set) that
  fills the form from `calculateNutritionTarget` (`shared/nutritionTargets.ts`):
  Mifflin–St Jeor BMR × activity multiplier, adjusted for the weight goal, with
  protein and fat anchored to bodyweight (1.8 / 1.0 g/kg by default) and carbs
  filling the remainder. A lose or gain goal with no weekly rate set calculates at
  onboarding's 0.25 kg/week rather than at maintenance. The athlete can tweak it
  before saving; the onboarding `FuellingStep` suggests the same target, previewed
  with the goal rate the save uses. A save from either place carries the current version's periodisation
  forward (`nextPeriodizationSettings` / `carryPeriodizationForward`), re-basing
  the slope, pre-load rate and cap onto a changed carb baseline. On a re-run with
  targets on file and an untouched profile, the step's "Replace my daily
  targets" switch starts off; whatever it shows is what Continue does.
- **[DONE] Offline logging.** Logging often happens at the gym/kitchen with poor
  signal. `useLogFood` now routes `POST /logs` through the app's offline mutation
  queue (`runWithOfflineFallback`, idempotency-keyed; see
  [State Management § Offline Queue](state-management.md#offline-queue)), and a
  replayed entry still lands on the right day because `loggedAt` travels in the
  body. _Remaining:_ entry edits/deletes, the reviewed-items batch
  (`POST /logs/batch`), repeat-day and the other nutrition writes still need a
  connection.
- **[DONE] Meal templates / "save this meal".** Building a recipe by hand used to
  be the only way to keep "my usual breakfast". A meal with two or more entries now
  has a **Save as recipe** action (`MealSection` → `onSaveAsRecipe` in
  `Nutrition.tsx`) that opens `RecipeBuilderDialog` prefilled with the meal's
  entries, repeats of a food merged, under the meal's name. An empty meal offers
  **Copy yesterday's** (`POST /logs/repeat` with a `mealType`), and each entry has
  **Log again today** (`useQuickLog`). _Remaining:_ the saved meal is a recipe,
  logged as one food, not a group of entries re-logged as they were.
- **[P3] Weekly & trend views.** Intake is only visible per-day (Nutrition) and as a
  block series (Analytics). A 7-day average, adherence streak, and macro-trend view
  would aid behaviour change — and the push-notification infra already exists to nudge
  logging streaks (an evening logging reminder already ships, see
  [Phase 5](#phase-5--insights--coaching)).
- **[DONE] Remember last-used quantity per food.** Quick-add used to re-open at a
  default quantity. `GET /foods/recent` and `GET /favorites` now return each food's
  last-logged `lastQuantityG` / `lastMealType` (`FoodWithPortionMemory`), which
  powers one-tap favourite logging and pre-fills `LogFoodDialog` via
  `usePortionMemory` (see [§6](#6-client-ui-map)).
- **[P3] Fibre target.** Fibre is tracked and shown in daily totals but
  `nutrition_targets` has no fibre column, so it can't be targeted. Add it for
  parity.

### Search & data quality

- **[DONE] Fuzzy search + synonyms + accents.** Local search now uses a pg_trgm
  trigram fallback (migration 0074, gated by `NUTRITION_FUZZY_ENABLED`) for typos /
  mid-string matches, searches **brand** as well as name, strips **diacritics**, and
  is **synonym-aware** (`synonyms.ts`) — the local query is expanded to synonym forms
  so it retrieves rows stored under an alias; fuzzy hits rank just below real matches.
- **[DONE] Semantic (embeddings) search.** Flag-gated (`NUTRITION_SEMANTIC_ENABLED`,
  default off) and off the hot path: when keyword/fuzzy returns few hits, the query is
  embedded (`gemini-embedding-001`, LRU-cached) and matched by cosine similarity
  against a `food_embeddings` vector table (populated by a bounded background cron
  that pages through `foods` in id order, each run carrying on where the last stopped),
  so a conceptual query ("post-workout protein") can surface foods sharing no tokens.
  Consent + budget are checked inline so plain search is never blocked
  (`semanticSearch.ts` / `foodEmbeddings.ts`). _Remaining:_ provider-side synonym
  query-expansion (deferred); on-upsert incremental embedding (currently cron-only).
- **[DONE] Backfill micronutrients.** Most cached foods carried no micros, so the
  micro panel was often sparse. Opening a USDA food's detail now backfills its
  micronutrients from the USDA detail endpoint alongside the named servings, in
  one read (`enrichFromUsda` in `foodDetail.ts`). What a read comes back without
  (no portions, no micros) is remembered in `server_runtime_cache` for 30 days,
  and a later open skips the read only when USDA lacks everything that open is
  missing, so a Branded food is not re-read on every open (PF11). _Remaining:_ foods from other sources,
  and a proactive backfill of popular foods.
- **[P3] Auto-resolve parsed items against USDA.** The meal parser resolves names
  against the **local cache only**, so common foods not yet cached come back
  unmatched and force a manual pick. Firing a USDA search for unresolved names
  (within budget) would make NL logging close to one-tap.

### AI

- **[P3] User-configurable insights window.** The 14-day window is hardcoded; let
  the athlete (or the race calendar) choose 7/14/28 days.
- **[DONE] Dedicated nutrition-label OCR path.** Photo parsing used only the general
  vision prompt. `POST /parse/label` (`labelParser.ts`, `PARSE_LABEL_PROMPT`) now
  asks the vision model to transcribe the printed nutrition panel; unit conversion
  and per-serving → per-100g math happen in code, and the result prefills the
  custom-food form for review (the **Scan label** entry in the Log food sheet,
  `ScanLabelButton`). Nothing is persisted until the athlete saves the food.

### Observability

- **[P3] Track search/parse misses.** Log which queries return nothing and which
  parsed names fail to resolve, to prioritise cache backfill and prompt tuning.

### Depth & energy balance — inspired by Cronometer

[Cronometer](https://cronometer.com/features/index.html) is the benchmark for
nutrition *depth* and *energy balance*. We already match or beat it on a few axes —
**nutrient timing** (our `loggedAt` + pre/post-session windows are richer than a
plain diary), **AI photo logging**, **AI coaching insights**, and **training
integration** — so the ideas below are the genuinely net-new ones, framed for a
Hyrox athlete.

| Cronometer capability | Our status today | Opportunity |
|-----------------------|------------------|-------------|
| Energy balance: TDEE = BMR + activity/exercise − intake, with a daily calorie budget | Daily in-vs-out balance on the Nutrition page (`EnergyBalanceCard`); the block view is still intake vs. load | Chart the **energy balance** across the block |
| 84 nutrients incl. amino acids, fatty acids, omega-3:6 | **14 micros**; no amino acids / fat breakdown | **Expand the nutrient panel** |
| Nutrition *completeness scores* (grouped) | Per-micro `%RDI` only | Add an aggregate **day score** |
| **Oracle** — suggest foods to fill unmet targets | None | AI-driven **gap-filling suggestions** |
| Net carbs (carbs − fibre) | Fibre tracked, net carbs not surfaced | Trivial display add |
| Macro targets by % of calories, presets, per-weekday templates | Absolute targets only | Extends the training-day-target idea |
| Biometric logging (weight, body-fat, resting HR, HRV, sleep, glucose) + correlations | Not logged in-app | Mostly available from Garmin/Strava |
| Long-term per-nutrient trends & chart overlays | Daily view + intake-vs-load block view | Extends the trend-view idea |
| Recipe importer (from a URL) | Manual ingredient entry | Convenience |
| Fasting timer | None | Niche for this audience |

Concrete additions worth putting on the roadmap:

- **[DONE] Energy balance / calorie budget.** Cronometer's headline number, and once
  our biggest miss: we tracked intake and training *load* (UTSS) but never *energy
  expenditure*. `GET /summary` now returns the day's `energy`
  (`computeEnergyBalance`, `shared/energyBalance.ts`), shown by `EnergyBalanceCard`
  on the Nutrition page. Energy out is **BMR (Mifflin–St Jeor from the profile) ×
  the sedentary multiplier + the day's measured workout calories** (`workout_logs.calories`:
  a Strava, Garmin or Health Connect import, or a manual figure); without them it falls back to a typical-day TDEE estimate, or to daily
  living alone when no session was logged. Intake − out is the balance, and the
  block is omitted when the profile lacks bodyweight, height or age. _Remaining:_
  the Analytics block view is still "intake vs. load" rather than an energy-balance
  chart, and the balance carries no weight-goal adjustment.
- **[P2] AI "fill my gaps" food suggestions (our take on Oracle).** Given the day's
  remaining macro/micro targets, suggest a few foods that close the gaps without
  blowing macros, with diet/allergen filters (veg/vegan, exclude dairy/nuts/seafood).
  We're well-placed to do this better than a static ranker because we already have an
  AI layer and a resolvable food database — the suggestions would name real `foods`
  rows so the numbers stay non-AI.
- **[P2] Percentage-based & templated targets.** Let targets be set as **% of
  calories** (e.g. 50/30/20) and saved as **presets**, including **per-weekday /
  training-day vs. rest-day templates** (folds together with the periodised-targets
  item above). Athletes reason in g/kg and ratios, not just absolute grams.
- **[P3] Expand the nutrient panel.** Add **amino-acid** (protein-quality:
  leucine/EAAs — relevant to recovery) and **fatty-acid / omega-3:6** breakdowns,
  plus the remaining vitamins/minerals. USDA Foundation & SR Legacy foods already
  carry these profiles and our `foods.micros` column is a generic JSONB map, so this
  is largely an **importer + display** change, not a schema one (the curated set
  is `MICRO_DEFS` in `server/services/nutrition/micros.ts`, mirrored for display by
  `MICRO_DISPLAY_DEFS` in `shared/schema/micros.ts`).
- **[P3] Daily nutrition completeness score.** Roll the per-micro `%RDI` into one or
  two grouped scores (e.g. "vitamins" / "minerals" completeness) so the athlete gets
  an at-a-glance "how complete was today" signal instead of scanning rows.
- **[P3] Net carbs.** Surface `carbs − fibre` in the daily header and food preview;
  zero new data, just a derived field some athletes track.
- **[P3] Lightweight biometric logging + correlation.** A place to log/﻿import
  bodyweight, body-fat, resting HR, HRV, and sleep (most already available via
  Garmin/Strava) and overlay them on the nutrition trend — the substrate for the
  energy-balance and trend features above, and for "did under-fuelling track with
  poor HRV?".
- **[P3] Recipe import from a URL.** Parse a recipe page into ingredients (reusing
  the AI parse path) to remove the friction of building recipes by hand.
- **[P3] Per-nutrient long-term trends.** Beyond the daily view, chart a nutrient (or
  macro) over weeks with a target band — extends the weekly/trend-view item to the
  nutrient level.

Deliberately **lower priority for this audience:** a fasting timer and continuous
glucose-monitor (CGM) integration are signature Cronometer features but a weaker fit
for Hyrox training; note them as exploratory rather than roadmap.

---

## Appendix: file map

```
shared/schema/
  tables.ts                     foods, food_servings, food_log_entries,
                                nutrition_targets, meal_targets, food_favorites,
                                recipes, recipe_ingredients
  nutrition.ts                  Zod request schemas + response contracts
  enums.ts                      MEAL_TYPES
  micros.ts                     MICRO_DISPLAY_DEFS (the 14 micros' labels, units, RDIs)

shared/
  nutritionScaling.ts           scaleNutrition (THE scaling rule), totals, Atwater factors
  nutritionTargets.ts           profile → target calculator; training-aware effective target
  mealFuelling.ts               per-meal fuel targets and overrides
  sessionFuellingTargets.ts     a session's pre/post fuelling target
  energyBalance.ts              the day's energy in vs. out
  fuellingCorrelation.ts        carb-target hit days vs. missed days (RPE, compliance)
  nutritionRange.ts             NUTRITION_RANGE_MAX_DAYS, clampNutritionRange
  plannedSessionEstimate.ts     a planned session's duration / RPE / UTSS estimate

server/services/nutrition/
  types.ts                      MappedFood (source → per-100g shape)
  usdaClient.ts                 USDA FoodData Central client + portions
  offClient.ts                  Open Food Facts client (search + barcode)
  edamamClient.ts               Edamam Food Database client (search + barcode)
  foodSearch.ts                 Edamam + USDA + OFF + local merge, degradation flag
  relevance.ts                  relevance gate + ranking, query tokenising, synonym expansion
  synonyms.ts                   curated single-word food synonyms
  semanticSearch.ts             flag-, consent- and budget-gated vector fallback for thin results
  foodEmbeddings.ts             food_embeddings backfill, prune and vector lookup
  utils.ts                      provider helpers + the per-request provider deadline
  foodDetail.ts                 food + lazily-enriched named servings (and USDA micros)
  barcode.ts                    cache-first barcode resolution
  refresh.ts                    lazy background re-fetch of stale cache rows
  sanitize.ts                   import sanity clamp at the cache boundary
  mealParser.ts                 NL/photo → items (Gemini)
  labelParser.ts                nutrition-label photo → per-100g macros (Gemini vision)
  visionParsing.ts              the Gemini vision call every photo parser shares
  energy.ts                     the day's energy balance for /summary
  rollup.ts                     daily summary math over joined entries (re-exports the
                                shared scaling rule)
  recipe.ts                     ingredient list → per-100g macros and micros
  micros.ts                     14-micro definitions, RDIs, unit conversion
  blockView.ts                  intake macros ⋈ training UTSS
  dailyLoad.ts                  per-day training load (UTSS) for the summary, block and range routes
  fuellingRange.ts              the target version in effect on each date of a range
  sessionFuelling.ts            pre/post-session windowing
  nutritionSummary.ts           the 14-day summary the insights and the AI coach share
  nutritionInsightsService.ts   14-day context → reasoning model
  reminders.ts                  push-only refuel and evening-log reminders (hourly cron)

server/services/sessionEstimate/
  plannedSessionEstimate.ts     /planned-session-estimate: deterministic + run-pace + AI nudge
  runPace.ts                    the athlete's run-pace ratio from logged runs

server/routes/nutrition/
  index.ts                      feature-flag gate (404 when disabled), then
                                registerNutritionRoutes on the same router
  nutrition.routes.ts           composer: registers the sub-modules below in order
  shared.ts                     not-found messages + getUserTimezone (multi-module)
  nutritionFoods.routes.ts      search / recent / custom / barcode / food CRUD / servings
  nutritionFavorites.routes.ts  favorites
  nutritionLogs.routes.ts       POST /logs, PATCH+DELETE /logs/:id, /logs/repeat, /logs/batch
  nutritionSummary.routes.ts    /summary (+ effective and per-meal targets), /summary-range,
                                /block, /session-fuelling/:workoutId,
                                /planned-session-estimate/:planDayId
  nutritionParse.routes.ts      /parse/text, /parse/photo, /parse/label (AI-gated)
  nutritionTargets.routes.ts    /targets, /meal-targets, /micros
  nutritionInsights.routes.ts   /insights (GET stored, POST regenerate; AI-gated)
  nutritionRecipes.routes.ts    recipes CRUD

server/storage/nutrition.ts     NutritionStorage: the facade, binding each method below
  nutritionShared.ts            visibility predicate, LIKE/trigram fragments, portion memory,
                                the unique-violation retry
  nutritionFoods.ts             shared cache, custom foods, named servings
  nutritionLogs.ts              log entries, date/window reads, repeat-day
  nutritionFavorites.ts         favourites
  nutritionRecipes.ts           recipes + their backing custom food
  nutritionTargets.ts           daily targets and per-meal overrides
server/prompts.ts               PARSE_MEAL_PROMPT, MEAL_IMAGE_PREAMBLE,
                                PARSE_LABEL_PROMPT, NUTRITION_INSIGHTS_PROMPT
server/prompts/nutritionContext.ts  the AI coach's fuelling section + the micro caveats

client/src/pages/Nutrition.tsx  the page
client/src/pages/nutrition/*    28 components + useQuickLog / useAiConsentGate / useLogTimezoneSync
                                (§6 names the top-level surfaces)
client/src/hooks/useNutrition.ts  query + mutation hooks
client/src/lib/api/nutrition.ts   typed API client
client/src/lib/nutritionInvalidation.ts  the query keys a food-log write refreshes
client/src/components/workout-detail/FuellingAroundSessionPanel.tsx
client/src/components/workout-detail/FuellingPlanPanel.tsx
client/src/components/analytics/FuellingTab.tsx
client/src/components/analytics/IntakeVsTrainingChart.tsx
client/src/components/analytics/FuellingCorrelationCard.tsx
client/src/components/timeline/FuellingDayChip.tsx
```
