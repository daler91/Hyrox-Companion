/**
 * The `focus` value that marks a training-plan day as the athlete's race day.
 *
 * The server writes it when reserving the race date (server/storage/plans.ts
 * `applyRaceDayAdjustments`), and the client detects it to render a distinct
 * "Race Day" card instead of a workout (timeline-workout-card/utils.tsx). Keep
 * this the single source of truth so the two sides can't drift — detection is an
 * exact, case-insensitive match so it never collides with "Race Pace" etc.
 */
export const RACE_DAY_FOCUS = "Race Day";
