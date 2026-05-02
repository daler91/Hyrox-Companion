# `training_styles_v1` Phased Rollout Plan

## Goals

- Introduce selectable training styles behind a kill switch (`training_styles_v1`) with zero downtime.
- Keep coaching deterministic for existing users who never selected a style.
- Backfill missing `user_training_style` history exactly once while allowing safe re-runs.
- Guarantee rollback safety: disabling the flag preserves legacy/default coaching behavior and does not delete style data.

## Feature-flag contract

- Flag name: `training_styles_v1`.
- **Enabled**:
  - Resolve the active style from `user_training_style` (or fall back to deterministic default when missing).
  - Show a non-blocking "choose your style" prompt to users without an explicit selection.
- **Disabled**:
  - Always route requests through the existing legacy/default coaching path.
  - Continue writing/retaining style data (if any writes still occur), but do not require it for reads.

## Deterministic handling for existing users

For users who existed before style selection launched and have no `user_training_style` row:

1. Use `balanced_default` as the effective style.
2. Treat this as **non-blocking** for UX: coaching and plan generation continue immediately.
3. Surface a dismissible prompt (settings/home/coach surface) encouraging style selection.
4. Preserve deterministic behavior across sessions by either:
   - Reading the backfilled `migration_default` row (preferred), or
   - Falling back to `users.training_style_id` then `balanced_default`.

## Rollout phases

### Phase 0 — Prep (internal only)

- Add and deploy `training_styles_v1` flag defaulted to `false` in all environments.
- Ship dual-path read logic:
  - flag off => legacy/default path only,
  - flag on => style-aware path with deterministic fallback.
- Add observability counters:
  - `coaching.training_style.flag_enabled`
  - `coaching.training_style.fallback_default_used`
  - `coaching.training_style.prompt_shown`

### Phase 1 — Data backfill

- Run one-time script: `pnpm tsx script/backfill-user-training-style.ts`.
- Script inserts `migration_default` rows only for users missing any `user_training_style` record.
- Validate with dry-run first, then live run, then immediate verification query.

### Phase 2 — Dark launch

- Enable `training_styles_v1` for internal/staff accounts only (or a tiny cohort).
- Confirm:
  - no increase in 5xx/error rate,
  - stable response time,
  - deterministic style resolution,
  - prompt appears only for users without explicit style choice.

### Phase 3 — Progressive exposure

- Ramp cohorts gradually (example: 5% -> 25% -> 50% -> 100%).
- Pause or roll back if fallback rate, latency, or user-reported quality regresses.

### Phase 4 — General availability

- Keep flag available as kill switch for at least one release cycle.
- After stability window, optionally make style-aware path default and repurpose/remove flag.

## Backfill verification checklist

1. Dry run count:
   - expected inserts = users without `user_training_style` rows.
2. Live run:
   - inserted count should match dry-run count (modulo concurrent signups).
3. Idempotency check:
   - immediate second run should report `inserted=0`.
4. Data integrity spot checks:
   - `style = COALESCE(users.training_style_id, 'balanced_default')`
   - `source='migration_default'`
   - `effective_date` is deterministic (`COALESCE(users.created_at::date, CURRENT_DATE)`).

## Rollback behavior (required)

If `training_styles_v1` is disabled at any point:

- Application reads must revert to legacy/default coaching path immediately.
- No migration rollback is required.
- Existing `user_training_style` rows remain in place (no data loss, no destructive cleanup).
- Any style-specific UI can be hidden/disabled, but core coaching must continue via legacy/default behavior.

This guarantees operational safety: toggling the flag changes **execution path**, not data ownership.
