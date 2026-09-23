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
- Build **custom foods** and **recipes** that log and roll up like any other food.
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
| **All nutrition is stored per-100g** and scaled by logged grams at read time. | USDA values are immutable per `fdcId`; storing scaled snapshots would invite a wrong-basis bug and drift. Column names literally say `*_per_100g`. | `foods` table; `server/services/nutrition/rollup.ts` (`scaleNutrition`, the single scaling site) |
| **Numbers never come from AI.** | Trust. The model estimates portion size and writes prose; it never originates a calorie or macro. | `BRD §7`, enforced by routing all macros through `foods` rows |
| **`logDate` is the user's *local* calendar day**, derived server-side from `users.user_timezone`. | A meal logged at 11pm in UTC+10 must land on the right day's totals. The client sends an instant (`loggedAt`); the server computes the date. | `server/routes/nutrition/nutritionLogs.routes.ts` (every log write, via `getUserTimezone` in `shared.ts`); `shared/schema/nutrition.ts` |
| **The food cache is shared and non-per-user.** A USDA food is cached once and reused by everyone. | Avoids N copies of "banana"; keeps the DB small and search fast. | `foods.createdByUserId IS NULL` = shared; visibility predicate `visibleTo(userId)` |
| **Custom foods are private**; visibility is checked on every food resolution. | No cross-user leakage of a user's own foods/recipes. | `NutritionStorage.getVisibleFoodById` etc. |
| **Logged history is immutable-by-reference.** A food referenced by a log entry can't be deleted (`onDelete: restrict`). | Historical entries must never lose their nutrition source. | FK constraints on `food_log_entries.foodId`, `recipe_ingredients.foodId` |
| **External APIs degrade gracefully.** A provider that is down or unkeyed simply drops out of the merge; only when none of Edamam, USDA and Open Food Facts reaches its API does search return cached-only results with `apiDegraded: true`. | The app stays usable offline of third parties. | `foodSearch.ts`; surfaced in `FoodSearch.tsx` |
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
```

| Table | Purpose | Notable columns / rules |
|-------|---------|-------------------------|
| `foods` | Shared reference cache + private custom foods. | `source` ∈ {`usda`,`off`,`edamam`,`custom`} in practice (the CHECK also still allows the retired `fatsecret` / `spoonacular`, rendered from `FOOD_SOURCES`); `*_per_100g` macros; `micros` JSONB; `serving_size_g`; partial-unique on `(source, source_id)`; `createdByUserId` NULL = shared. |
| `food_servings` | Named portions for a food. | `label`, `grams`; lazily filled from USDA portions on first food-detail view. |
| `food_log_entries` | A single logged food. | `loggedAt` (instant), `logDate` (local day), `quantityG`, `mealType`, `entryMethod` ∈ {`manual`,`barcode`,`nl`,`photo`}; `rawInput` + `parseConfidence` + `pendingReview` for AI provenance. |
| `nutrition_targets` | Versioned macro/calorie goals. | `calories`, `proteinG`, `carbG`, `fatG`, `effectiveFrom`; insert-only history (one row per `(user, effectiveFrom)`). **No fibre target column.** |
| `meal_targets` | Versioned **per-meal** macro/calorie goals. | `mealType` ∈ `MEAL_TYPES` (CHECK rendered from the constant), `calories`, `proteinG`, `carbG`, `fatG`, `effectiveFrom`; unique on `(user, mealType, effectiveFrom)` to match `upsertMealTarget`'s delete-then-insert. Surfaced as `DailySummaryResponse.mealTargets` on `GET /summary`. |
| `food_favorites` | Per-user favourites over the cache. | Unique `(userId, foodId)`. |
| `recipes` | A custom food + an ingredient breakdown. | `foodId` is the backing `source='custom'` food; macros computed from ingredients so a recipe logs like any food. |
| `recipe_ingredients` | One ingredient line. | `foodId` (`restrict`), `quantityG`, `position`. |

`MEAL_TYPES` = `breakfast, lunch, dinner, snack, pre_workout, post_workout`. The
last two exist so the Phase 3 training views can bucket fuelling around sessions.

---

## 4. Feature catalogue

### Phase 1 — Core logging

The everyday loop: find a food, log it, see your day.

- **Food search** (`GET /foods/search`, FR-1.1) — merges the local cache with live
  results from Edamam, USDA, and Open Food Facts (queried concurrently),
  de-duplicates by identity, caches external hits, and caps at 30 results. Live
  provider hits pass a shared **relevance gate** (every query token must match the
  food's name/brand); results are then **ranked by match quality** (exact → name
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
  with per-meal and whole-day macro totals, all scaled from per-100g and rounded
  once after summing (`buildDailySummary`).
- **Recent foods** (`GET /foods/recent`, FR-1.4) and **favourites**
  (`GET/POST/DELETE /favorites`, FR-1.5) — one-tap re-logging of things you eat
  often.
- **Repeat a day / meal** (`POST /logs/repeat`, FR-1.5) — copy yesterday (or one
  meal) onto today, re-stamped to the target instant.
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
  Deleting a food that's referenced by a log returns `409` (history is protected).
- **Named servings** (`POST/DELETE /foods/:id/servings`, FR-2.4) — portions like
  "1 cup" → grams. For USDA foods these are **lazily enriched** from the USDA
  food-detail *portions* endpoint on first view and cached (`gramWeight` carries
  the conversion, so volume portions like cups work here even though the
  search-result default serving size skips volume units).
- **Recipes** (`POST/PATCH/DELETE/GET /recipes`, FR-2.3) — compose ingredients;
  the recipe's per-100g macros are **computed from the ingredient list** and
  stored on a hidden backing custom food, so a recipe logs and rolls up through
  the unchanged Phase 1 path. Editing replaces the whole ingredient list; deleting
  removes the backing food only if no log still references it.

### Phase 3 — Training integration

Where fuelling meets the rest of the app.

- **Session fuelling** (`GET /session-fuelling/:workoutId`, FR-3.1/3.2/3.4) —
  splits the foods around a workout into **pre** (4h before) and **post** (6h
  after) windows with separate totals. When the workout has a real start time
  (e.g. from Strava/Garmin), same-day `pre_workout`/`post_workout` tags are
  attributed first and the clock windows fill in the rest (a back-logged entry's
  tag outranks its synthetic local-noon timestamp); with no start time it falls
  back to the explicit `pre_workout` / `post_workout` meal tags alone. Surfaced
  in the workout detail sheet via `FuellingAroundSessionPanel`.
- **Per-meal fuel targets** (on `GET /summary`, `DailySummaryResponse.mealTargets`)
  — the headline nutrition×training integration. The day's effective target is
  distributed **across the day's meals** so the athlete sees the fuel required for
  _each_ meal, with the primary session's pre/post anchors placed first: carbs are
  front-loaded into a `pre_workout` slot and **breakfast as the post-workout
  recovery meal**, protein spread evenly (with a recovery-meal floor), and fat kept
  off the workout-adjacent meals. Each meal carries a `role` + one-line `rationale`.
  The engine is the pure, DB-free `shared/mealFuelling.ts` (`computeMealFuelTargets`),
  reusing `computeSessionFuellingTarget` for the anchors so the numbers match the
  session-fuelling panel exactly. The route resolves the day's primary session (most
  significant **logged** workout, else the most significant **planned** day so
  targets show before the morning session is logged) via `resolveDayTrainingContext`;
  the lookups are gated on an effective target existing, so no-target users pay
  nothing. Targets are computed on the fly (no new table) and surfaced per meal in
  `MealSection` (target header + progress bars + rationale, shown even before
  anything is logged).
  - **Session timing:** the workout's local time-of-day selects which meals are the
    pre/recovery meals (`workoutTiming` = `am_pre_breakfast` | `midday` | `evening`):
    morning → a `pre_workout` slot + breakfast recovery; midday → breakfast carb-loads,
    lunch recovers; evening → lunch carb-loads, dinner recovers. The time comes from the
    plan day's `plannedTimeOfDayMin`, a manual log's `timeOfDayMin`, or a device import's
    `startedAt` (`resolveDayTrainingContext` → `timingFromLocalHour`); unset falls back to
    the morning assumption.
- **Block view** (`GET /block`, FR-3.3) — a daily series joining intake macros to
  training **UTSS** (unified training stress) over a date range, zero-filled so
  every day has a point. Rendered in **Analytics → Fuelling** (`FuellingTab` →
  `IntakeVsTrainingChart`), capped to a 365-day window.

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

The parser is **suggestions-only**: nothing is logged until the user confirms, and
the AI never supplies the nutrition numbers — only the portion estimate and a name
to resolve against real food data.

### Phase 5 — Insights & coaching

- **Targets** (`GET/POST /targets`, FR-5.2) — set calorie/protein/carb/fat goals;
  versioned by `effectiveFrom` so history is preserved (delete-then-insert per
  date). The daily header shows progress bars against the current target.
  - **Training-aware effective target** (`shared/nutritionTargets.ts` →
    `effectiveTargetWindowed`; server `fetchTrainingLoadWindow` →
    `buildEffectiveTargetSummary`). With periodisation on, the day's carbs/calories
    (and protein, on recovery days) flex with a *window* of training rather than
    just today's load, broken into transparent components on `EffectiveTargetSummary`
    (`baseLoadDeltaG` / `recoveryDeltaG` / `preloadDeltaG` / `proteinDeltaG` +
    `reasonCodes` + `explanation`):
    - **base load** — today's UTSS vs the reference (the original behaviour);
    - **recovery (PAST)** — after hard recent days (high acute load / negative TSB),
      keep carbs up for glycogen resynthesis and bump protein for repair, so a light
      day inside a hard block doesn't snap to baseline;
    - **pre-load (FUTURE)** — bring carbs forward ahead of a big upcoming planned
      session (estimated via `estimatePlannedDayUtss` over `getUpcomingPlannedDays`)
      and carb-load through **taper** / **race week** (`computePlanPhase`).
    Each adjustment is opt-in via versioned columns on `nutrition_targets`
    (`recovery_enabled`, `preload_carb_grams_per_utss`, `preload_days_ahead`,
    `phase_aware`, `recovery_protein_bump_frac`, `max_carb_delta_g`); a flat or
    load-only target is byte-for-byte unchanged, and the analytics block/range views
    stay pure load-correlation (single-day window). The total carb delta is capped
    so recovery + pre-load + phase can't compound. Surfaced in `DailyTotalsHeader`
    (carb + protein notes, full breakdown on hover) and toggled in `TargetsDialog`.
- **Micronutrients** (`GET /micros`, FR-5.1) — the day's totals for a curated set
  of **13 micros** (sodium, potassium, calcium, iron, magnesium, zinc, vitamins C,
  A, D, E, K, B6, B12, folate) against FDA reference daily intakes, shown as
  `%RDI`. Only micros the day's foods actually carry data for are shown — *absent
  ≠ zero*.
- **AI nutrition insights** (`GET`/`POST /insights`, FR-5.3) — a single-shot Gemini
  *reasoning*-model analysis of the last **14 days**: average macros and logging
  consistency, intake vs. training load (flagging under-fuelled high-UTSS days),
  comparison to targets, watch-outs, and a focus for the next 1–2 weeks. The `GET`
  returns the last stored analysis instantly (no AI spend) with a `stale` flag if a
  meal has been logged since; the `POST` regenerates it.

---

## 5. API surface

All routes are under `/api/v1/nutrition`, require Clerk auth, validate with Zod,
and are rate-limited per-user per-category (window = 60 s, `server/constants.ts`).
The whole tree returns **404** when `NUTRITION_ENABLED !== "true"` (server-side, so
a forced client flag can't reach it).

| Method | Path | Purpose | Rate bucket (max/window) |
|--------|------|---------|--------------------------|
| GET | `/foods/search` | Search local cache + Edamam + USDA + Open Food Facts | `nutritionSearch` (30) |
| GET | `/foods/recent` | Recently logged foods | `nutritionRead` (60) |
| GET | `/foods/custom` | User's custom foods | `nutritionRead` (60) |
| POST | `/foods/barcode` | Barcode → food (cache → Edamam → OFF) | `nutritionBarcode` (30) |
| POST | `/foods` | Create custom food (+servings) | `nutritionWrite` (30) |
| GET | `/foods/:id` | Food + named servings | `nutritionRead` (60) |
| PATCH | `/foods/:id` | Edit custom food | `nutritionWrite` (30) |
| DELETE | `/foods/:id` | Delete custom food (409 if referenced) | `nutritionWrite` (30) |
| POST | `/foods/:id/servings` | Add named serving | `nutritionWrite` (30) |
| DELETE | `/foods/:id/servings/:servingId` | Delete serving | `nutritionWrite` (30) |
| GET | `/favorites` | List favourites | `nutritionRead` (60) |
| POST | `/favorites` | Add favourite | `nutritionFav` (30) |
| DELETE | `/favorites/:foodId` | Remove favourite | `nutritionFav` (30) |
| POST | `/logs` | Log a food | `nutritionLog` (60) |
| GET | `/summary` | Daily totals + meals, with the effective target, per-meal fuel targets and energy balance | `nutritionRead` (60) |
| GET | `/session-fuelling/:workoutId` | Pre/post-session fuelling | `nutritionRead` (60) |
| GET | `/planned-session-estimate/:planDayId` | A planned session's estimated duration/RPE to prefill the fuelling panel (deterministic + run-pace personalised; optional AI nudge soft-gated inline, see §7) | `nutritionRead` (60) |
| GET | `/block` | Intake macros vs. training UTSS | `nutritionRead` (60) |
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

> **Note:** the nutrition routes are **not yet registered with the OpenAPI
> registry** (`shared/openapi.ts`), so they're absent from `docs/openapi.json` and
> Swagger UI; [`docs/api-reference.md`](api-reference.md#nutrition-routes) carries a
> manually-maintained catalog until they are migrated. Closing that gap is listed
> under improvements.

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
one `MealSection` per meal → `MicronutrientPanel` → `MyFoodsSection` (manage custom
foods & recipes) → `NutritionInsightsPanel`.

| Component | Role |
|-----------|------|
| `DailyTotalsHeader` | Running calorie/macro totals + progress vs. targets. |
| `FoodSearch` | Debounced (2+ char) search with a degraded-API banner; opens `LogFoodDialog`. |
| `QuickAddBar` | Horizontally scrollable recent/favourite chips for one-tap logging. |
| `LogFoodDialog` | Create or edit an entry: quantity + unit (named servings) + meal, with a live nutrition preview. |
| `MealSection` | One meal's entries with edit/delete. |
| `BarcodeScanner` | `BarcodeDetector` camera scan (rear camera) + manual fallback. |
| `CustomFoodDialog` | Create/edit a custom food (per-100g macros + servings). |
| `RecipeBuilderDialog` | Search & add ingredients; live per-serving preview. |
| `LogFoodActions` | Single "Log food" button opening a sheet with the capture/create entry points below. |
| `DescribeMealDialog` | Free-text meal entry → parse → review sheet. |
| `SnapMealButton` | Photo capture (OS camera / file picker) → vision parse → review sheet. |
| `ParsedMealReviewSheet` | Adjust/match/remove parsed items before batch logging. |
| `MicronutrientPanel` | Day's micros vs. RDI, with an empty state when no micro data exists. |
| `MyFoodsSection` | Manage custom foods + recipes. |
| `TargetsDialog` | Set calorie/macro goals (partial goals allowed). |
| `NutritionInsightsPanel` | Show last AI analysis + regenerate. |

**Cross-feature surfaces:** `FuellingAroundSessionPanel` (workout detail sheet)
and `FuellingTab` (Analytics) consume `useSessionFuelling` and `useBlockView`.

**Hooks** — 14 query hooks (`useNutritionDay`, `useSearchFoods`, `useRecentFoods`,
`useFavorites`, `useFoodWithServings`, `useCustomFoods`, `useRecipes`, `useRecipe`,
`useNutritionTargets`, `useMicros`, `useNutritionInsights`, `useSessionFuelling`,
`useBlockView`, `useFuellingRange`), two derived selectors over those caches
(`useFavoriteIds`, `usePortionMemory`), and ~22 mutation hooks covering
log/edit/delete, favourites, repeat-day, barcode, custom foods and servings,
recipes, parse text/photo/label, batch log, targets and per-meal overrides,
and insights regeneration — each invalidating the relevant query keys. Entry
deletes use pending UI. The favourite toggle shows its flip locally in
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
  bounded background cron, so repeated searches don't re-bill.
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
mirrors the existing `coachInsightsService` pattern.

---

## 8. External data sources (USDA & Open Food Facts)

Three external sources feed search/barcode (Edamam, USDA, Open Food Facts); the
two flagship ones are compared below. Edamam (curated branded/generic, per-100g)
is the preferred search tier when configured (`EDAMAM_APP_ID`/`EDAMAM_APP_KEY`),
and barcode lookup tries it ahead of Open Food Facts.

| | USDA FoodData Central | Open Food Facts |
|---|---|---|
| Used for | Food **search** + named portions | Food **search** + **barcode** lookup |
| Endpoint | `/fdc/v1/foods/search`, `/food/{id}` | `/cgi/search.pl` (search), `/api/v2/product/{code}.json` (barcode) |
| Auth | `USDA_API_KEY` (free) — **missing key ⇒ degraded, cached-only** | none; custom `User-Agent` required by policy |
| Caching | Upserted into `foods` keyed by `(usda, fdcId)`; portions cached in `food_servings` | Upserted into `foods` keyed by `(off, barcode)` |
| Timeout / retries | 8 s/attempt; retry 429/5xx with jitter (2 search, 1 detail) | 8 s; 2 retries (barcode), 1 retry (search — tighter ~10 req/min/IP limit); cache-first |
| Result quality | Lab-verified; trusted as-is | Crowd-sourced; search hits pass a **relevance gate** (every query token must prefix a word in the name/brand) before being surfaced |
| Unit handling | Per-100g already; energy nutrient IDs `1008/2047/2048`; micros read unit-filtered (mg/µg) | `*_100g` reported in **grams** → multiplied by `1000`/`1e6` to mg/mcg (the one guard against the classic 1000× error) |

The cache is refreshed lazily rather than expired (`refresh.ts`). Every upsert
stamps `lastFetchedAt`; a shared external row older than 60 days (or never stamped)
is re-fetched from its source in the background when a search result or a barcode
cache hit serves it, at most 3 per request. The athlete gets the cached row
instantly, a failed refresh leaves it in place, and custom foods (no upstream) are
never refreshed.

---

## 9. Configuration & feature flags

| Variable | Layer | Effect |
|----------|-------|--------|
| `NUTRITION_ENABLED` | server | `default "true"`. `!= "true"` ⇒ the whole `/api/v1/nutrition` tree 404s. |
| `VITE_NUTRITION_ENABLED` | client (build) | Gates the page route + sidebar nav (`featureFlags.nutritionEnabled`, default `true`). |
| `USDA_API_KEY` | server | Enables live food search; absent ⇒ graceful degradation. |
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
clients (`usdaClient.test.ts`, `offClient.test.ts`), the meal parser, the route
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

- **[P1] Include nutrition in the GDPR data export.** `server/services/exportService.ts`
  exports plans, workouts, exercise sets, and annotations — but **not** food logs,
  custom foods, recipes, or targets. Food intake is health data; it should be in
  the user's data export and is currently missing. (Deletion *is* handled — FK
  cascades cover it — but portability is not.)
- **[P1] Register the routes with the OpenAPI registry.** Nutrition is absent from
  `shared/openapi.ts`, so it's missing from `docs/openapi.json` and the Swagger UI
  (`docs/api-reference.md` carries a manual catalog meanwhile — see the
  [§5 note](#5-api-surface)). Add the schemas so the public contract is
  CI-gated like the rest of the API.
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
  filling the remainder. The athlete can tweak it before saving; the onboarding
  `FuellingStep` suggests the same target.
- **[DONE] Offline logging.** Logging often happens at the gym/kitchen with poor
  signal. `useLogFood` now routes `POST /logs` through the app's offline mutation
  queue (`runWithOfflineFallback`, idempotency-keyed; see
  [State Management § Offline Queue](state-management.md#offline-queue)), and a
  replayed entry still lands on the right day because `loggedAt` travels in the
  body. _Remaining:_ entry edits/deletes, the reviewed-items batch
  (`POST /logs/batch`), repeat-day and the other nutrition writes still need a
  connection.
- **[P3] Meal templates / "save this meal".** Recipes are heavyweight for "my usual
  breakfast". A lightweight save-a-group-of-entries-as-a-template would speed up the
  most common logging path.
- **[P3] Weekly & trend views.** Intake is only visible per-day (Nutrition) and as a
  block series (Analytics). A 7-day average, adherence streak, and macro-trend view
  would aid behaviour change — and the push-notification infra already exists to nudge
  logging streaks.
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
  against a `food_embeddings` vector table (populated by a bounded background cron),
  so a conceptual query ("post-workout protein") can surface foods sharing no tokens.
  Consent + budget are checked inline so plain search is never blocked
  (`semanticSearch.ts` / `foodEmbeddings.ts`). _Remaining:_ provider-side synonym
  query-expansion (deferred); on-upsert incremental embedding (currently cron-only).
- **[DONE] Backfill micronutrients.** Most cached foods carried no micros, so the
  micro panel was often sparse. Opening a USDA food's detail now backfills its
  micronutrients from the USDA detail endpoint alongside the named servings
  (`enrichUsdaMicros` in `foodDetail.ts`). _Remaining:_ foods from other sources,
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
| 84 nutrients incl. amino acids, fatty acids, omega-3:6 | **13 micros**; no amino acids / fat breakdown | **Expand the nutrient panel** |
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
  the sedentary multiplier + the day's measured workout calories** (Strava/Garmin
  or manual); without them it falls back to a typical-day TDEE estimate, or to daily
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
  is largely an **importer + display** change, not a schema one (`micros.ts` is the
  single place to extend the curated set).
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

server/services/nutrition/
  types.ts                      MappedFood (source → per-100g shape)
  usdaClient.ts                 USDA FoodData Central client + portions
  offClient.ts                  Open Food Facts client (search + barcode)
  edamamClient.ts               Edamam Food Database client (search + barcode)
  foodSearch.ts                 Edamam + USDA + OFF + local merge, degradation flag
  foodDetail.ts                 food + lazily-enriched named servings (and USDA micros)
  barcode.ts                    cache-first barcode resolution
  refresh.ts                    lazy background re-fetch of stale cache rows
  sanitize.ts                   import sanity clamp at the cache boundary
  mealParser.ts                 NL/photo → items (Gemini)
  labelParser.ts                nutrition-label photo → per-100g macros (Gemini vision)
  energy.ts                     the day's energy balance for /summary
  rollup.ts                     THE scaling site; daily summary math
  recipe.ts                     ingredient list → per-100g macros
  micros.ts                     13-micro definitions, RDIs, unit conversion
  blockView.ts                  intake macros ⋈ training UTSS
  sessionFuelling.ts            pre/post-session windowing
  nutritionInsightsService.ts   14-day context → reasoning model

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

client/src/pages/Nutrition.tsx  the page
client/src/pages/nutrition/*    27 components + useQuickLog / useAiConsentGate
                                (the UI map below names the top-level surfaces)
client/src/hooks/useNutrition.ts  query + mutation hooks
client/src/lib/api/nutrition.ts   typed API client
client/src/components/workout-detail/FuellingAroundSessionPanel.tsx
client/src/components/analytics/FuellingTab.tsx
```
