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
  - `computeProfile()`
  - `analyzeWorkout()`
  - `prescribeNext()`
  - `phaseLogic()`
  - `safetyRules()`
  - `buildPromptContext()`
- Register the strategy in the one central `strategies` map in
  `server/services/training_styles/registry.ts`, next to `defaultStrategy`
  (`balanced_default`) and `mafMethodStrategy` (`maf_method`). `resolveTrainingStyle()`
  falls back to `DEFAULT_TRAINING_STYLE_ID` and logs a
  `training_style_resolution_failed` health alert for an unknown id, so an unregistered
  style degrades quietly rather than throwing — register it or it will never run.
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

- Add style selection in onboarding.
- Ask only the follow-up questions required for the selected style.
- Support style switching in settings with a confirmation message.
- Persist on `users` (see [Database § users](database.md#users)):
  - `training_style_id` — the active style, default `'balanced_default'`,
  - `training_style_previous_id`,
  - `training_style_changed_at`,
  - `training_style_recompute_now` — the flag that forces a fresh style-aware recompute
    after a switch.
- Append a row to the `user_training_style` history table (`style`, `effective_date`,
  `source`) so the selection timeline survives later switches.

## 5) Data model and migration readiness

- Ensure storage exists for:
  - active user style,
  - style-specific profile,
  - style-specific benchmark/test data,
  - style-specific workout analyses.
- Version records used in reasoning. The MAF tables are the shipped precedent: `maf_profile`, `maf_test_results` and `maf_workout_analysis` each carry an integer `version` column.
- Define null/default behavior for users without explicit selection.
- Include idempotent backfill for legacy users.

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
- Contract tests for style interface conformance.
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
