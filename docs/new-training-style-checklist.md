# New Training Style Checklist

Use this checklist whenever adding a new training methodology so implementation stays modular, testable, and safe to roll out.

## 1) Define style contract first

- Choose a stable `style_id` (for example `maf_method`, `polarized_80_20`).
- Define required inputs, optional inputs, derived metrics, and output schema.
- Add metadata:
  - display name,
  - user-facing description,
  - safety caveats/contraindications,
  - prompt/rules version.

## 2) Implement as a strategy module

- Implement the shared `TrainingStyleStrategy` interface
  (`server/services/training_styles/types.ts`):
  - `id`
  - `buildPromptContext()` — the prefix, suffix and system-instruction appendix the
    style adds to the coach prompt. It is the only thing a style changes today: the
    auto-coach, the timeline suggestions and the coach-note refresh all call it.
- The interface used to also declare `computeProfile()`, `analyzeWorkout()`,
  `phaseLogic()`, `safetyRules()` and `prescribeNext()`. Nothing called the first four,
  and `prescribeNext()` returned the suggestions unchanged for every style, so they were
  removed. A style that needs its own profile, phase rules or post-processing of the
  model's suggestions adds that member to the interface and wires it into the coach
  services, with tests, in the same change.
- Register the strategy in the one central `strategies` map in
  `server/services/training_styles/registry.ts`, next to `defaultStrategy`
  (`balanced_default`) and `mafMethodStrategy` (`maf_method`). `resolveTrainingStyle()`
  falls back to `DEFAULT_TRAINING_STYLE_ID` and logs a
  `training_style_resolution_failed` health alert for an unknown id, so an unregistered
  style degrades quietly rather than throwing — register it or it will never run.
- Add the style's core prompt fragment to `STYLE_CORE_FRAGMENTS` in the same file. The
  shared `buildPromptSuffix()` falls back to the `balanced_default` fragment for an id
  with no entry, so a missing one silently coaches the new style as Balanced.
- Avoid scattered `if/else` conditionals in coach services.

## 3) Keep shared core separate from style logic

- Keep style-agnostic concerns centralized:
  - auth,
  - telemetry,
  - persistence,
  - workout parsing,
  - request/response plumbing.
- Restrict style modules to method-specific rules and constraints.

## 4) Onboarding and settings integration

- Add style selection in onboarding: the style `SelectItem` list in
  `client/src/components/onboarding/GoalStep.tsx`.
- Ask only the follow-up questions required for the selected style (the MAF questions are
  gated in `GoalStep.tsx` and `client/src/hooks/useOnboardingWizard.ts`). If the style
  needs inputs before it can be selected, reject an incomplete switch server-side the way
  `validateMafTransition()` in `server/routes/preferences.ts` does for `maf_method`.
- Support style switching in settings with a confirmation message. In
  `client/src/components/settings/TrainingStyleSection.tsx` that means the `SelectItem`
  list, `STYLE_LABELS`, `getStyleConstraintText()` and `buildRecalculationSummary()`.
  Unknown ids render as "Balanced" in all of these, as they do in the coach panel's
  `activeStyleLabel` ternary (`client/src/components/CoachPanel.tsx`), which also needs
  the new label.
- The Android app has its own hand-written style picker and labels: the `Chips` list in
  `mobile/composeApp/src/commonMain/kotlin/com/fitai/coach/ui/settings/TrainingSettings.kt`,
  the style constants, `styleLabel()`, `styleConstraint()` and the recalculation summary in
  `ui/settings/TrainingSettingsModel.kt`, and `trainingStyleLabel()` in
  `ui/coach/CoachModel.kt`. The generated Kotlin models need no change, because
  `trainingStyleId` is a plain string in the API schema.
- Add the id to `TRAINING_STYLE_IDS` (`shared/trainingStyles.ts`). A preferences save naming
  any other id is refused with a `400`, and `registry.test.ts` fails until the registry and
  the list name the same styles.
- Persist on `users` (see [Database § users](database.md#users)):
  - `training_style_id` — the active style, default `'balanced_default'`. The API keeps it
    a string on the wire but accepts only an id in `TRAINING_STYLE_IDS`
    (`updateUserPreferencesSchema`); the column has no CHECK constraint, so a new id needs
    no migration or OpenAPI type change. Rows saved before that check may still hold an
    unknown id, which resolves to the default,
  - `training_style_previous_id` and `training_style_changed_at` — written by the server
    when a save changes the effective style (`updateUserPreferences`,
    `server/storage/users.ts`). The request still accepts both fields, marked deprecated,
    and ignores them,
  - `training_style_recompute_now` — sent as `trainingStyleRecomputeNow: true` on the
    switch's `PATCH /api/v1/preferences`. The handler treats it as a request, not state:
    it queues an immediate refresh of the stored style-aware analyses (the features in
    `STYLE_AWARE_FEATURES`, `server/services/analyticsRecomputeScheduler.ts`; today
    Coach Insights) and leaves the column `false`. A new style whose rules reach another
    stored analysis must add that feature to the list.
- The `user_training_style` history table (`style`, `effective_date`, `source`) keeps the
  selection timeline across switches. `updateUserPreferences` appends a row, in the same
  transaction as the update, whenever a save changes the effective style: `source` is
  `'onboarding'` before onboarding is complete and `'settings'` after, and
  `effective_date` is the athlete's local date. Migration `0035_maf_artifacts.sql` and
  `script/backfill-user-training-style.ts` add `'migration_default'` rows for athletes
  who predate it. `source` is CHECK-constrained to those three values; `style` is free
  text. A new style needs nothing extra here.

## 5) Data model and migration readiness

- Ensure storage exists for:
  - active user style,
  - style-specific profile,
  - style-specific benchmark/test data,
  - style-specific workout analyses.
- Version records used in reasoning. The MAF tables are the shipped precedent: `maf_profile`, `maf_test_results` and `maf_workout_analysis` each carry an integer `version` column.
- Define null/default behavior for users without explicit selection.
- Include idempotent backfill for legacy users (`script/backfill-user-training-style.ts`
  is the existing precedent).

## 6) Prompt/rules packaging

- Keep prompt fragments modular by:
  - style principles,
  - phase constraints,
  - analysis rubric,
  - tone and safety rules.
- Assemble only needed fragments at runtime.
- Inject computed values as structured fields.
- Store prompt bundle version with generated outputs.

## 7) Runtime safety enforcement

- Add explicit checks for prohibited medical behavior (diagnosis, medication changes, therapeutic prescriptions).
- Detect red-flag symptoms and force escalation guidance.
- Include style-specific disclaimers where needed (for example HR-affecting medication for HR-based methods).

## 8) API and behavior contracts

- Provide deterministic APIs for:
  - get/set active style,
  - recompute style profile,
  - retrieve style-conditioned analysis and prescriptions.
- Define deterministic fallback when style is unset.
- Ensure clients can display the active style and reasoning context.

## 9) Test coverage (must-pass)

- Unit tests:
  - profile calculation,
  - phase assignment,
  - workout classification,
  - prescription constraints.
- Contract tests for style interface conformance (the existing prompt-context and
  style-divergence tests are in `server/services/training_styles/registry.test.ts`).
- Regression tests to confirm intentional output differences by style.
- Safety tests for escalation and prohibited language blocking.
- Migration tests for legacy-user behavior.

## 10) Observability and rollout controls

- Emit analytics events for:
  - style selected/switched,
  - profile computed,
  - phase changed,
  - workout classified,
  - recommendation generated.
- Add dashboards and alerts for missing style context, invalid outputs, and elevated fallback rates.
- Launch each style behind a feature flag with staged rollout and documented rollback steps.

## Definition of done

A new style is complete only when:

- it is plugin/strategy-registered without core refactor,
- onboarding/settings and persistence are complete,
- safety checks and telemetry are active,
- tests pass across unit/contract/regression/safety/migration suites,
- rollout + rollback steps are documented,
- generated outputs are reproducible via stored version metadata.
