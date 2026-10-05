/**
 * How long an inline editor waits after the last edit before it saves. The
 * set cells (useExerciseSetsForOwner, so useWorkoutDetail and
 * usePlanDayExercises) and the block builder share it, so one pause saves
 * both, and the athlete gets one save per pause instead of one per keystroke
 * (U3, CODEBASE_ANALYSIS_2026-10-03).
 */
export const EDIT_SAVE_DEBOUNCE_MS = 350;
