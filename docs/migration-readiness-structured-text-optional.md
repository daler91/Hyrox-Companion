# Structured Text Optional: Migration-Readiness Spec & Telemetry Plan

## Purpose
Define objective rollout gates, feature flags, telemetry instrumentation, and rollback controls required **before** enabling an experience where free-text workout prescription becomes optional.

## Scope
- Workout/plan prescription authoring and editing flows that currently support both:
  - structured exercise blocks/sets
  - free-text prescription fields
- Parser and validator pathways that convert text/photo input into structured blocks
- Save-path selection (structured-first vs text-first fallback)

## Non-goals
- Implementing parser/model changes
- Shipping UI changes that alter current write behavior
- Changing database schema in this document

---

## 1) Hard Gates for “Free-Text Can Be Optional”

All gates below are release blockers. The flag `structured_text_optional_enabled` must remain OFF until every gate is met for **14 consecutive days** in production.

### Gate A — Structured Prescription Completeness
**Metric:** `% workouts with fully-structured prescription (no unresolved semantic warnings)`

**Definition:**
- Numerator: workouts saved with at least one structured block and **zero unresolved semantic warnings** at save time.
- Denominator: workouts saved that include any prescription content (structured or text).
- Exclusions: deleted workouts, internal test users, and synthetic seed data.

**Threshold:** `>= 97.0%`

**Segmentation (must each pass):**
- New workout flow
- Workout edit flow
- Plan-day edit flow
- Mobile-width vs desktop-width sessions

### Gate B — High-Confidence Parser Structure Rate
**Metric:** `% parser outputs with high-confidence structure blocks`

**Definition:**
- Numerator: parse operations producing non-empty structured blocks where parser confidence score meets `high` threshold and validator returns no blocking issues.
- Denominator: all parse operations that attempt to create structured blocks from text/photo.
- Confidence source: parser response confidence field (or derived confidence rules).

**Threshold:** `>= 95.0%`

**Segmentation (must each pass):**
- Text input parse
- Photo input parse
- Re-parse on existing workout

### Gate C — Structured UI Adoption
**Metric:** `% edits made in structured UI vs text field`

**Definition:**
- Numerator: edit actions in structured controls (exercise row add/remove/reorder, set fields, interval fields, EMOM fields, validation-fix edits).
- Denominator: all prescription edit actions (structured edits + text-field edits).

**Threshold:** `>= 85.0%`

**Segmentation (must each pass):**
- First edit in session
- All edits in session
- Users with <10 lifetime workouts vs >=10

### Gate D — Fallback Reliance Ceiling
**Metric:** `% saves that require text-first fallback`

**Definition:**
- Numerator: saves that attempt structured save-path but are routed to text-first due to parser/validation/schema/UI incompatibility.
- Denominator: all prescription saves while any structured flag is enabled.

**Threshold:** `<= 2.0%`

### Gate E — Validation Failure Ceiling
**Metric:** `% saves blocked by structured validation`

**Threshold:** `<= 1.5%`

### Gate F — Error Budget
**Metric:** critical errors attributable to structured pathways

**Threshold:**
- 0 Sev-1 incidents in last 30 days
- <= 1 Sev-2 incident in last 30 days with documented remediation

---

## 2) Feature Flags (must exist before rollout)

### `structured_blocks_enabled`
- **Type:** boolean
- **Owner:** product + backend
- **Default:** ON in dev/staging, OFF in production until controlled rollout
- **Controls:** visibility and writability of generic structured block editors
- **Failure behavior:** if OFF, hide/disable structured block editing and preserve text-first behavior

### `structured_emom_editor_enabled`
- **Type:** boolean
- **Owner:** product + frontend
- **Default:** OFF
- **Controls:** EMOM-specific structured editor UI and EMOM schema validation surfaces
- **Dependency:** requires `structured_blocks_enabled = true`
- **Failure behavior:** EMOM input falls back to generic text description path

### `structured_text_optional_enabled`
- **Type:** boolean
- **Owner:** product + platform
- **Default:** OFF
- **Controls:** whether free-text field is optional during save/validation
- **Dependency:** requires all hard gates passing + rollout approval
- **Failure behavior:** when OFF, existing “structured OR text required” validation remains

### Rollout Sequence
1. Enable `structured_blocks_enabled` to internal users only.
2. Enable `structured_emom_editor_enabled` for internal users and pilot cohort.
3. Observe hard-gate telemetry for 14 days.
4. Enable `structured_text_optional_enabled` for 1% cohort.
5. Ramp 1% -> 10% -> 25% -> 50% -> 100% only if all gates remain within threshold at each stage.

---

## 3) Event Instrumentation Spec

### Event Design Principles
- Every event must include: `event_id`, `user_id` (or anon id), `session_id`, `request_id`, `timestamp`, `app_version`, `platform`, `flag_snapshot`.
- Include `owner_type` (`workout_log` | `plan_day`) and `input_mode` (`structured_ui` | `text` | `photo` | `mixed`) where applicable.
- Emit both client analytic events and server authoritative events for save outcomes.

### A. Parse Quality Events

#### `prescription_parse_requested`
When parsing starts.

Properties:
- `source`: `text` | `photo` | `reparse`
- `owner_type`
- `input_char_count`
- `has_existing_structured`

#### `prescription_parse_completed`
When parser returns output.

Properties:
- `source`
- `owner_type`
- `structured_block_count`
- `confidence_score`
- `confidence_bucket`: `low` | `medium` | `high`
- `semantic_warning_count`
- `latency_ms`

#### `prescription_parse_failed`
When parser call fails or returns unusable output.

Properties:
- `source`
- `owner_type`
- `failure_stage`: `api` | `schema` | `empty_output` | `timeout` | `unknown`
- `error_code`
- `latency_ms`

### B. Validation Failure Events

#### `prescription_validation_failed`
When save is blocked by structured validation.

Properties:
- `owner_type`
- `failure_type`: `missing_required_field` | `semantic_conflict` | `invalid_interval` | `invalid_emom` | `schema_mismatch` | `unknown`
- `blocking_issue_count`
- `warning_count`
- `had_text_backup`
- `save_attempt_origin`: `manual_save` | `autosave`

#### `prescription_validation_warning`
When non-blocking warnings are present at save time.

Properties:
- `owner_type`
- `warning_type`
- `warning_count`
- `resolved_before_save` (boolean)

### C. Fallback Usage Events

#### `prescription_fallback_invoked`
When structured save-path is bypassed in favor of text-first save.

Properties:
- `owner_type`
- `fallback_reason`: `parser_low_confidence` | `validation_failed` | `schema_error` | `ui_incompatible` | `flag_disabled` | `unknown`
- `original_path`: `structured_first`
- `resulting_path`: `text_first`
- `had_structured_payload` (boolean)

#### `prescription_save_completed`
Authoritative server event for final save outcome.

Properties:
- `owner_type`
- `save_path`: `structured_first` | `text_first`
- `status`: `success` | `failure`
- `failure_reason` (nullable)
- `structured_block_count`
- `unresolved_semantic_warning_count`

### Derived Dashboards (required before rollout)
- Gate dashboard with A-F thresholds and 14-day rolling compliance.
- Parse funnel: requested -> completed -> high-confidence -> saved structured-first.
- Validation dashboard: top failure types and trend.
- Fallback dashboard: fallback rate by reason and app version.
- Flag cohort dashboard: compare metrics between flag ON/OFF cohorts.

### Alerting
- Page on-call if:
  - fallback rate > 5% for 15 minutes, or
  - structured save failures > 2% for 15 minutes, or
  - parse failure rate doubles baseline for 30 minutes.

---

## 4) Rollback Strategy (Text-First Safety)

### Rollback Principle
If any schema, parser, validation, or UI issue risks data correctness or save reliability, force all saves to the **text-first save path** immediately.

### Trigger Conditions
Immediate rollback if any of:
- Sev-1 incident related to prescription save/data loss
- Structured save failure rate > 2% sustained for 15 minutes
- Schema mismatch causing write failures in production
- Client release introducing incompatible structured payloads

### Rollback Actions
1. Disable `structured_text_optional_enabled` globally.
2. Disable `structured_emom_editor_enabled` if issue touches EMOM pathway.
3. Optionally disable `structured_blocks_enabled` for full text-first mode.
4. Server enforces text-first path regardless of client flags (authoritative guard).
5. Keep telemetry ON to measure post-rollback stabilization.

### Data Safety Requirements During Rollback
- Never discard user-authored text prescription.
- Preserve latest structured payload snapshot for debugging (non-authoritative).
- Save operations must succeed via text-first unless broader platform outage exists.

### Verification Checklist After Rollback
- Text-first save success rate >= 99.5% within 30 minutes.
- New structured validation blocks drop to near-zero.
- No increase in 5xx on workout/plan save routes.
- Incident channel updated with timestamps and disabled flags.

### Re-enable Criteria
- Root cause fixed and validated in staging.
- Backfill or compatibility patch deployed (if needed).
- 24h stable metrics in canary cohort.
- Explicit go/no-go signoff from product + engineering.
