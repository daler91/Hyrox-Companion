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

- Implement the shared style interface:
  - `computeProfile()`
  - `assignPhase()`
  - `analyzeWorkout()`
  - `prescribeNext()`
  - `safetyGuardrails()`
- Register the module in one central style registry.
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
- Persist:
  - `active_style_id`,
  - `previous_style_id`,
  - `style_changed_at`,
  - `style_context_version`.

## 5) Data model and migration readiness

- Ensure storage exists for:
  - active user style,
  - style-specific profile,
  - style-specific benchmark/test data,
  - style-specific workout analyses.
- Version records used in reasoning (`rules_version`, `prompt_version`, etc.).
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
