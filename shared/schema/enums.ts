/**
 * Valid state transitions for plan_days.status and workout_logs status
 * (S15). Any write path that mutates status MUST land inside one of these
 * arrows.
 *
 *   planned    → completed  (user logs a workout for that day)
 *   planned    → skipped    (user explicitly skips)
 *   planned    → missed     (cron marks past planned days as missed)
 *   missed     → completed  (user back-fills a late log)
 *   skipped    → completed  (user un-skips and logs)
 *   completed  → planned    (FORBIDDEN — deletes should drive status from
 *                           the underlying workout_logs count; see S6)
 *   missed     → planned    (when the session moves to today or later —
 *                           folded or shortened through missed-session
 *                           recovery, or rescheduled from the timeline. The
 *                           day then records `recovery` and `missed_on`.
 *                           The sweep never writes it.)
 *   skipped    → planned    (FORBIDDEN — explicit skips stay explicit)
 */
export const workoutStatusEnum = ["planned", "completed", "missed", "skipped"] as const;
export type WorkoutStatus = (typeof workoutStatusEnum)[number];

/**
 * How much a planned session matters to the plan.
 *
 * - `key`: the sessions the plan is built on (quality runs, the long run, the
 *   goal's main strength or station work). A missed one is worth recovering.
 * - `supporting`: the volume around the key sessions. Recover it when a clean
 *   slot exists; otherwise letting it go costs little.
 * - `optional`: easy and recovery work. The plan does not need it back.
 *
 * NULL on the row means the athlete never set one; the server infers a tier
 * from the session instead (server/services/sessionPriority.ts), so every plan
 * that predates this column still reads with sensible tiers.
 */
export const planDayPriorityEnum = ["key", "supporting", "optional"] as const;
export type PlanDayPriority = (typeof planDayPriorityEnum)[number];

/**
 * What the athlete decided about a missed session.
 *
 * - `folded`: moved, whole, to another day (status back to `planned`).
 * - `shortened`: moved to another day as a shorter version.
 * - `let_go`: left where it was; the plan carries on. Only meaningful while
 *   the day is still `missed` — a later log makes it moot.
 *
 * NULL is "no decision yet": a missed day in that state is the one the
 * timeline asks about.
 */
export const planDayRecoveryEnum = ["folded", "shortened", "let_go"] as const;
export type PlanDayRecovery = (typeof planDayRecoveryEnum)[number];

/**
 * Why a planned session was skipped, when the athlete volunteers it. Always
 * optional — a required field on the app's most frequent negative interaction
 * would only train people to dismiss the dialog.
 *
 * `ill` and `injured` are kept distinct from each other (and from the
 * circumstantial reasons) because they are the two that a coach should train
 * around rather than nudge about.
 */
export const planDaySkipReasonEnum = ["ill", "injured", "schedule", "low_energy"] as const;
export type PlanDaySkipReason = (typeof planDaySkipReasonEnum)[number];

export const exerciseCategoryEnum = ["functional", "running", "strength", "conditioning"] as const;
export type ExerciseCategory = (typeof exerciseCategoryEnum)[number];

// Meal slot a log entry is filed under. pre_workout / post_workout exist so the
// Phase 3 training-integration views can bucket fuelling around sessions.
// Lives here (a zero-import module) rather than tables.ts so the client can use
// it without evaluating the drizzle pgTable graph in the browser.
export const MEAL_TYPES = [
  "breakfast",
  "lunch",
  "dinner",
  "snack",
  "snack_pm",
  "pre_workout",
  "post_workout",
] as const;
export type MealType = (typeof MEAL_TYPES)[number];

/**
 * How a device activity (Strava today, Garmin later) came to sit on a
 * workout_logs row. `auto` is the sync's matcher; `manual` is the athlete's
 * own link, which the sync never revisits. NULL on the row means no linked
 * activity — a standalone import is not a link.
 */
export const deviceLinkSourceEnum = ["auto", "manual"] as const;
export type DeviceLinkSource = (typeof deviceLinkSourceEnum)[number];

/**
 * What a recycle-bin item holds. Each kind is a whole record graph (the row
 * plus every child row the delete cascade would take with it), captured at
 * delete time so an accidental delete can be undone with the original ids.
 * Lives here, not tables.ts, for the same reason as MEAL_TYPES: the client
 * renders the bin without evaluating the drizzle table graph.
 */
export const recycleBinEntityTypeEnum = ["workout_log", "plan_day", "training_plan"] as const;
export type RecycleBinEntityType = (typeof recycleBinEntityTypeEnum)[number];

/**
 * Where a graded run's Strava stream stands (`workout_log_streams.status`).
 *
 * - `ok`: stream fetched and downsampled, with heart rate.
 * - `no_heartrate`: fetched; the recording had pace/distance but no HR.
 * - `unavailable`: Strava had no usable stream (deleted, manual, too short).
 * - `failed`: the fetch failed; retried a few times, then left alone.
 * - `skipped`: the run's plan day is not one we grade (intervals, a
 *   simulation), so no Strava read was spent on it.
 */
export const sessionStreamStatusEnum = [
  "ok",
  "no_heartrate",
  "unavailable",
  "failed",
  "skipped",
] as const;
export type SessionStreamStatus = (typeof sessionStreamStatusEnum)[number];
