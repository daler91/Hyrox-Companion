[Back to README](../README.md)

# Nutrition & Fuelling Guide

This document describes the **Nutrition tracking module** end to end: what it does
for the athlete, how the code is organised across the client, server, and shared
layers, the design invariants that keep the numbers trustworthy, and a prioritised
list of improvements worth making next.

**Status:** complete and on by default (`VITE_NUTRITION_ENABLED` / `NUTRITION_ENABLED`
default to `true` in the client, gated off in fresh environments via `.env.example`).
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
back to USDA FoodData Central, Open Food Facts, or a user-entered custom food.

At a glance, the athlete can:

- **Search** a food database and log it to a meal with a quantity in grams.
- **Scan a barcode** to pull a packaged product straight from Open Food Facts.
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
| **`logDate` is the user's *local* calendar day**, derived server-side from `users.user_timezone`. | A meal logged at 11pm in UTC+10 must land on the right day's totals. The client sends an instant (`loggedAt`); the server computes the date. | `server/routes/nutrition/nutrition.routes.ts`; `shared/schema/nutrition.ts` |
| **The food cache is shared and non-per-user.** A USDA food is cached once and reused by everyone. | Avoids N copies of "banana"; keeps the DB small and search fast. | `foods.createdByUserId IS NULL` = shared; visibility predicate `visibleTo(userId)` |
| **Custom foods are private**; visibility is checked on every food resolution. | No cross-user leakage of a user's own foods/recipes. | `NutritionStorage.getVisibleFoodById` etc. |
| **Logged history is immutable-by-reference.** A food referenced by a log entry can't be deleted (`onDelete: restrict`). | Historical entries must never lose their nutrition source. | FK constraints on `food_log_entries.foodId`, `recipe_ingredients.foodId` |
| **External APIs degrade gracefully.** If USDA is down or unkeyed, search returns cached-only results with `apiDegraded: true`. | The app stays usable offline of third parties. | `foodSearch.ts`; surfaced in `FoodSearch.tsx` |
| **AI endpoints are gated** by consent + per-user 24h budget. | Cost control and the GDPR opt-in consent model. | `aiConsentCheck` + `aiBudgetCheck` middleware |

---

## 3. Data model

Seven tables, all defined in `shared/schema/tables.ts`. Nutrition values are
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
| `foods` | Shared reference cache + private custom foods. | `source` ∈ {`usda`,`off`,`custom`}; `*_per_100g` macros; `micros` JSONB; `serving_size_g`; partial-unique on `(source, source_id)`; `createdByUserId` NULL = shared. |
| `food_servings` | Named portions for a food. | `label`, `grams`; lazily filled from USDA portions on first food-detail view. |
| `food_log_entries` | A single logged food. | `loggedAt` (instant), `logDate` (local day), `quantityG`, `mealType`, `entryMethod` ∈ {`manual`,`barcode`,`nl`,`photo`}; `rawInput` + `parseConfidence` + `pendingReview` for AI provenance. |
| `nutrition_targets` | Versioned macro/calorie goals. | `calories`, `proteinG`, `carbG`, `fatG`, `effectiveFrom`; insert-only history (one row per `(user, effectiveFrom)`). **No fibre target column.** |
| `food_favorites` | Per-user favourites over the cache. | Unique `(userId, foodId)`. |
| `recipes` | A custom food + an ingredient breakdown. | `foodId` is the backing `source='custom'` food; macros computed from ingredients so a recipe logs like any food. |
| `recipe_ingredients` | One ingredient line. | `foodId` (`restrict`), `quantityG`, `position`. |

`MEAL_TYPES` = `breakfast, lunch, dinner, snack, pre_workout, post_workout`. The
last two exist so the Phase 3 training views can bucket fuelling around sessions.

---

## 4. Feature catalogue

### Phase 1 — Core logging

The everyday loop: find a food, log it, see your day.

- **Food search** (`GET /foods/search`, FR-1.1) — merges the local cache (fast,
  case-insensitive prefix match) with live USDA results (relevance-ordered),
  de-duplicates by identity, caches USDA hits on the way through, and caps at 30
  results. Falls back to cached-only with an `apiDegraded` flag when USDA is
  unreachable.
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

- **Barcode lookup** (`POST /foods/barcode`, FR-2.1) — cache-first, then Open Food
  Facts; the resolved product is cached as an `off` food. The client uses the
  browser `BarcodeDetector` API with a manual-entry fallback.
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
  (e.g. from Strava/Garmin) it windows by clock time; otherwise it falls back to
  the explicit `pre_workout` / `post_workout` meal tags. Surfaced in the workout
  detail sheet via `FuellingAroundSessionPanel`.
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
| GET | `/foods/search` | Search local cache + USDA | `nutritionSearch` (30) |
| GET | `/foods/recent` | Recently logged foods | `nutritionRead` (60) |
| GET | `/foods/custom` | User's custom foods | `nutritionRead` (60) |
| POST | `/foods/barcode` | Barcode → food (OFF) | `nutritionBarcode` (30) |
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
| GET | `/summary` | Daily totals + meals | `nutritionRead` (60) |
| GET | `/session-fuelling/:workoutId` | Pre/post-session fuelling | `nutritionRead` (60) |
| GET | `/block` | Intake macros vs. training UTSS | `nutritionRead` (60) |
| PATCH | `/logs/:id` | Edit a log entry | `nutritionLog` (60) |
| DELETE | `/logs/:id` | Delete a log entry | `nutritionLog` (60) |
| POST | `/logs/repeat` | Repeat a day/meal | `nutritionLog` (20) |
| POST | `/parse/text` | NL meal → items **(AI)** | `parse` (5) + consent + budget |
| POST | `/parse/photo` | Photo → items **(AI)** | `parse` (5) + consent + budget |
| POST | `/logs/batch` | Confirm reviewed items | `nutritionLog` (60) |
| GET | `/targets` | Current target + history | `nutritionRead` (60) |
| POST | `/targets` | Set/replace target version | `nutritionWrite` (30) |
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
> `docs/api-reference.md`. Closing that gap is listed under improvements.

---

## 6. Client UI map

The page is `client/src/pages/Nutrition.tsx`; data access is centralised in
`client/src/hooks/useNutrition.ts` (TanStack Query) over the typed client in
`client/src/lib/api/nutrition.ts`.

**Page layout (top → bottom):** date navigator → `DailyTotalsHeader` (calories +
macros with target progress bars) → `FoodSearch` + `QuickAddBar` (recent/favourite
chips) → action row (Describe / Snap / Scan / Custom food / Recipe / Targets) →
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
| `DescribeMealButton` | Free-text meal entry → parse → review sheet. |
| `SnapMealButton` | Photo capture (OS camera / file picker) → vision parse → review sheet. |
| `ParsedMealReviewSheet` | Adjust/match/remove parsed items before batch logging. |
| `MicronutrientPanel` | Day's micros vs. RDI, with an empty state when no micro data exists. |
| `MyFoodsSection` | Manage custom foods + recipes. |
| `TargetsDialog` | Set calorie/macro goals (partial goals allowed). |
| `NutritionInsightsPanel` | Show last AI analysis + regenerate. |

**Cross-feature surfaces:** `FuellingAroundSessionPanel` (workout detail sheet)
and `FuellingTab` (Analytics) consume `useSessionFuelling` and `useBlockView`.

**Hooks** — 13 query hooks (`useNutritionDay`, `useSearchFoods`, `useRecentFoods`,
`useFavorites`, `useFoodWithServings`, `useCustomFoods`, `useRecipes`, `useRecipe`,
`useNutritionTargets`, `useMicros`, `useNutritionInsights`, `useSessionFuelling`,
`useBlockView`) and ~17 mutation hooks covering log/edit/delete, favourites,
repeat-day, barcode, custom foods, recipes, parse text/photo, batch log, targets,
and insights regeneration — each invalidating the relevant query keys. Favourite
toggles and entry deletes use optimistic/pending UI.

---

## 7. AI usage & safety

Three AI touchpoints, all on Gemini, all opt-in and budgeted:

| Touchpoint | Model role | Default model | Output |
|------------|-----------|---------------|--------|
| Describe a meal (`/parse/text`) | `fast` | `gemini-2.5-flash-lite` | JSON items (portion estimate only) |
| Snap a meal (`/parse/photo`) | vision | `gemini-2.5-flash` | JSON items from the image |
| Nutrition insights (`/insights`) | `reasoning` | `gemini-3.1-pro-preview` | Markdown analysis |

Safety properties:

- **Consent + budget gating.** `aiConsentCheck` blocks unless the user has the AI
  coach enabled (403); `aiBudgetCheck` blocks at a rolling 24h spend of **$2.00**
  (429) and warns past **$1.50** via an `X-AI-Budget-Warning` header. An
  `AI_FEATURES_ENABLED=false` kill switch 503s all AI routes.
- **Numbers are never AI-sourced.** The parser returns a name + grams; nutrition
  is resolved from real `foods` rows. Insights are instructed to use *only* the
  supplied aggregates and not to invent foods or numbers.
- **Prompt hardening.** Both prompts carry an anti-exfiltration instruction; user
  input is sanitised and never logged raw.
- **Lenient parsing.** Malformed AI items are coerced or dropped without failing
  the whole request, so one bad line doesn't lose the meal.

The insights context builder (`nutritionInsightsService.ts`) compacts 14 days of
intake, training load, targets, and low micros (<50% RDI) into a short prompt and
mirrors the existing `coachInsightsService` pattern.

---

## 8. External data sources (USDA & Open Food Facts)

| | USDA FoodData Central | Open Food Facts |
|---|---|---|
| Used for | Food **search** + named portions | **Barcode** lookup |
| Endpoint | `/fdc/v1/foods/search`, `/food/{id}` | `/api/v2/product/{code}.json` |
| Auth | `USDA_API_KEY` (free) — **missing key ⇒ degraded, cached-only** | none; custom `User-Agent` required by policy |
| Caching | Upserted into `foods` keyed by `(usda, fdcId)`; portions cached in `food_servings` | Upserted into `foods` keyed by `(off, barcode)` |
| Timeout / retries | 8 s/attempt; retry 429/5xx with jitter (2 search, 1 detail) | 8 s; 2 retries; cache-first to respect ~15 req/min/IP |
| Unit handling | Per-100g already; energy nutrient IDs `1008/2047/2048`; micros read unit-filtered (mg/µg) | `*_100g` reported in **grams** → multiplied by `1000`/`1e6` to mg/mcg (the one guard against the classic 1000× error) |

There is **no TTL** on the cache — once a food is fetched it persists indefinitely.

---

## 9. Configuration & feature flags

| Variable | Layer | Effect |
|----------|-------|--------|
| `NUTRITION_ENABLED` | server | `!= "true"` ⇒ the whole `/api/v1/nutrition` tree 404s. |
| `VITE_NUTRITION_ENABLED` | client (build) | Gates the page route + sidebar nav (`featureFlags.nutritionEnabled`, default `true`). |
| `USDA_API_KEY` | server | Enables live food search; absent ⇒ graceful degradation. |
| `GEMINI_API_KEY` / `GEMINI_MODEL` / `GEMINI_VISION_MODEL` / `GEMINI_SUGGESTIONS_MODEL` | server | The three AI touchpoints. |
| `AI_FEATURES_ENABLED` | server | Global AI kill switch. |

Gate the two `NUTRITION_*` flags together per tier (`.env.example` notes this).

---

## 10. Testing

The module is heavily unit-tested, with the pure-math core (`rollup.ts`,
`recipe.ts`, `blockView.ts`, `sessionFuelling.ts`, `micros.ts`) deliberately
DB-free for fast, exhaustive coverage. There are co-located tests for the external
clients (`usdaClient.test.ts`, `offClient.test.ts`), the meal parser, the route
layer (`nutrition.routes.test.ts`), and most client components (e.g.
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
  `shared/openapi.ts`, so it's missing from `docs/openapi.json`, the Swagger UI,
  and `docs/api-reference.md`. Add the schemas so the public contract is
  CI-gated like the rest of the API.
- **[P2] Sanity-filter per-100g values at import.** There's no guard against
  NaN/negative/absurd macros coming from a source; a bad import silently poisons
  every future log of that food. Validate/clamp in the USDA/OFF mappers.
- **[P2] Cache freshness / TTL.** The `foods` cache never expires, so a reformulated
  product or corrected USDA entry stays wrong forever. Add a `lastFetchedAt` and a
  background refresh (or refresh-on-detail) for cache entries past a threshold.

### Athlete value — Hyrox-specific opportunities

This is a *Hyrox companion*, and the nutrition module is currently sport-agnostic.
The biggest unrealised value is connecting fuelling to the race itself:

- **[P2] Race-day & race-week fuelling plan.** There's no carb-loading guidance,
  no race-morning fuelling timeline, and no during-race fuelling plan despite the
  app knowing the user's goal race date. A "Race Fuelling" view (carb-load taper
  week → race-morning timing → in-race gels/hydration) would be a flagship feature.
- **[P2] Carb-per-kg and protein-per-kg targets.** Endurance/strength athletes
  think in g/kg bodyweight, not absolute grams. Targets are absolute-only today;
  add bodyweight-relative targets and surface "you hit 4.2 g/kg carbs on a
  high-load day".
- **[P2] Hydration & sodium logging.** Hyrox is sweat-heavy and the micro panel
  already tracks sodium/potassium, but there's no water logging at all. Add water
  + electrolyte tracking, especially around sessions.
- **[P2] Periodised / training-day-aware targets.** One target applies to every
  day. Support separate training-day vs. rest-day targets (or auto-scale targets by
  that day's planned UTSS) so the block view can show intake vs. *recommended*
  intake, not just intake vs. load.

### Athlete value — general

- **[P2] Calculated targets from the profile.** Targets are 100% manual. The app
  knows bodyweight, goals, and training load — offer a TDEE-based suggested target
  the user can accept and tweak, rather than starting from a blank form.
- **[P2] Offline logging.** Nutrition mutations don't appear to use the app's
  offline mutation queue, yet logging often happens at the gym/kitchen with poor
  signal. Route writes through the offline queue so logs aren't lost.
- **[P3] Meal templates / "save this meal".** Recipes are heavyweight for "my usual
  breakfast". A lightweight save-a-group-of-entries-as-a-template would speed up the
  most common logging path.
- **[P3] Weekly & trend views.** Intake is only visible per-day (Nutrition) and as a
  block series (Analytics). A 7-day average, adherence streak, and macro-trend view
  would aid behaviour change — and the push-notification infra already exists to nudge
  logging streaks.
- **[P3] Remember last-used quantity per food.** Quick-add re-opens at a default
  quantity; remembering the last grams-per-food would cut taps.
- **[P3] Fibre target.** Fibre is tracked and shown in daily totals but
  `nutrition_targets` has no fibre column, so it can't be targeted. Add it for
  parity.

### Search & data quality

- **[P3] Fuzzy search.** Search is prefix `ILIKE` only (`pg_trgm` is intentionally
  off), so typos and mid-string matches miss. A trigram index + ranking (its own
  migration, as the schema comment anticipates) would noticeably improve hit rate.
- **[P3] Backfill micronutrients.** Most cached foods carry no micros until a full
  re-fetch, so the micro panel is often sparse. Enrich micros when a food is opened
  in detail (as servings already are), or backfill popular foods.
- **[P3] Auto-resolve parsed items against USDA.** The meal parser resolves names
  against the **local cache only**, so common foods not yet cached come back
  unmatched and force a manual pick. Firing a USDA search for unresolved names
  (within budget) would make NL logging close to one-tap.

### AI

- **[P3] User-configurable insights window.** The 14-day window is hardcoded; let
  the athlete (or the race calendar) choose 7/14/28 days.
- **[P3] Dedicated nutrition-label OCR path.** Photo parsing uses the general
  vision prompt; a label-specific path could read packaged macros with much higher
  fidelity than portion estimation.

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
| Energy balance: TDEE = BMR + activity/exercise − intake, with a daily calorie budget | Intake only; training shown as UTSS, no expenditure side | Compute a real **energy balance** |
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

- **[P2] Energy balance / calorie budget.** This is Cronometer's headline number and
  our biggest miss: we track intake and training *load* (UTSS) but never *energy
  expenditure*. Estimate TDEE as **BMR (Mifflin–St Jeor from the profile) + baseline
  activity + session calories already coming from Strava/Garmin**, then show
  intake − expenditure as a daily balance (and an optional weight-goal adjustment).
  This turns the Analytics block view from "intake vs. load" into a true
  energy-balance chart — directly actionable for race-weight and recovery.
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
                                nutrition_targets, food_favorites, recipes,
                                recipe_ingredients
  nutrition.ts                  Zod request schemas + response contracts

server/services/nutrition/
  types.ts                      MappedFood (source → per-100g shape)
  usdaClient.ts                 USDA FoodData Central client + portions
  offClient.ts                  Open Food Facts client (barcode)
  foodSearch.ts                 local + USDA merge, degradation flag
  foodDetail.ts                 food + lazily-enriched named servings
  barcode.ts                    cache-first barcode resolution
  mealParser.ts                 NL/photo → items (Gemini)
  rollup.ts                     THE scaling site; daily summary math
  recipe.ts                     ingredient list → per-100g macros
  micros.ts                     13-micro definitions, RDIs, unit conversion
  blockView.ts                  intake macros ⋈ training UTSS
  sessionFuelling.ts            pre/post-session windowing
  nutritionInsightsService.ts   14-day context → reasoning model

server/routes/nutrition/
  index.ts                      feature-flag gate (404 when disabled)
  nutrition.routes.ts           all endpoints, rate limits, AI gating

server/storage/nutrition.ts     NutritionStorage (all DB access)
server/prompts.ts               PARSE_MEAL_PROMPT, MEAL_IMAGE_PREAMBLE,
                                NUTRITION_INSIGHTS_PROMPT

client/src/pages/Nutrition.tsx  the page
client/src/pages/nutrition/*    15 components (see UI map)
client/src/hooks/useNutrition.ts  query + mutation hooks
client/src/lib/api/nutrition.ts   typed API client
client/src/components/workout-detail/FuellingAroundSessionPanel.tsx
client/src/components/analytics/FuellingTab.tsx
```
