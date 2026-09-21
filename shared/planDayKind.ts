/**
 * Is this plan day a rest day rather than a session?
 *
 * `focus` and `mainWorkout` are free text — LLM output or a CSV import — so
 * this is a wording test, and a deliberately narrow one: exact matches after
 * trimming and lower-casing, never a substring search. "Recovery run" and
 * "Rest-pause sets" are sessions; "Rest", "Active recovery" and "Complete rest
 * or light walk" are not. Used to keep the session brief quiet on rest days.
 *
 * A leaf module (no `@shared/schema` import) — see `shared/weeklyReview.ts`.
 */

const REST_FOCUS = new Set([
  "rest",
  "rest day",
  "day off",
  "off",
  "off day",
  "recovery",
  "recovery day",
  "active recovery",
  "complete rest",
]);

const REST_WORKOUT = new Set([
  "rest",
  "rest day",
  "complete rest",
  "complete rest or light walk",
  "complete rest or a light walk",
]);

/** Trailing `.`/`!` run, stripped by scanning back so no regex backtracks. */
function stripTrailingStops(text: string): string {
  let end = text.length;
  while (end > 0 && (text[end - 1] === "." || text[end - 1] === "!")) end -= 1;
  return text.slice(0, end);
}

function normalise(text: string): string {
  return stripTrailingStops(text.trim().toLowerCase()).replace(/\s+/g, " ");
}

export function isRestLikePlanDay(focus: string, mainWorkout: string): boolean {
  return REST_FOCUS.has(normalise(focus)) || REST_WORKOUT.has(normalise(mainWorkout));
}
