import { isRestLikePlanDay } from "./planDayKind";
import { type PlanDayPriority, planDayPriorityEnum } from "./schema/enums";

/**
 * A plan day's priority tier: key, supporting or optional.
 *
 * The athlete's own choice always wins. A day they never marked (NULL in
 * `plan_days.priority` — every plan that predates the column, CSV imports, the
 * sample plan) gets a tier inferred from its title, so the tiers are useful
 * from the first day without a backfill guessing at real data. Generated plans
 * are stamped by the workout engine instead
 * (server/services/workoutEngine/weekSkeleton.ts), which knows which sessions
 * the goal cannot do without.
 *
 * A leaf module (no `@shared/schema` barrel import) so the client can use it
 * without pulling the drizzle graph into the bundle — see shared/weeklyReview.ts.
 *
 * Only the title (`focus`) is read. The workout text mentions everything in
 * passing — "finish with 10 min tempo" on a strength day would make every such
 * day key — while the title names what the session is for.
 */

/** Tokens that make a session the backbone of its week. Matched as whole words. */
const KEY_PATTERNS: readonly RegExp[] = [
  /\blong run\b/,
  /\bthreshold\b/,
  /\btempo\b/,
  /\bintervals?\b/,
  /\bsimulation\b/,
  // "Race day" is the derived race-day card (shared/raceDay.ts).
  /\brace (?:sim|pace|day)\b/,
  /\bhyrox sim\b/,
  /\btime trial\b/,
];

/** Easy and restorative work. Deliberately short: "walk" alone would catch farmers walks. */
const OPTIONAL_PATTERNS: readonly RegExp[] = [
  /\beasy\b/,
  /\brecovery\b/,
  /\bmobility\b/,
  /\bstretch(?:ing)?\b/,
  /\byoga\b/,
  /\bshake ?out\b/,
  /\bflush\b/,
  /\bprehab\b/,
];

function normalise(text: string | null | undefined): string {
  return (text ?? "").trim().toLowerCase().replaceAll(/\s+/g, " ");
}

/**
 * The tier a session's title implies, or null for a rest day (a rest day is
 * not a session, so it has no tier and nothing to recover).
 *
 * An explicit "optional" or "key" in the title wins; then key patterns, so an
 * "easy long run" is still the week's long run; then the easy/recovery words;
 * everything else is supporting.
 */
export function inferSessionPriority(
  focus: string | null | undefined,
  mainWorkout: string | null | undefined,
): PlanDayPriority | null {
  if (isRestLikePlanDay(focus ?? "", mainWorkout ?? "")) return null;
  const title = normalise(focus);
  if (/\boptional\b/.test(title)) return "optional";
  if (/\bkey\b/.test(title)) return "key";
  if (KEY_PATTERNS.some((pattern) => pattern.test(title))) return "key";
  if (OPTIONAL_PATTERNS.some((pattern) => pattern.test(title))) return "optional";
  return "supporting";
}

function isPriority(value: string | null | undefined): value is PlanDayPriority {
  return (planDayPriorityEnum as readonly string[]).includes(value ?? "");
}

/**
 * The tier to show and plan with: the stored one when the athlete (or the
 * engine) set it, otherwise the inferred one. A rest day has none, whatever is
 * stored — marking a rest day "key" cannot make it a session.
 */
export function resolveSessionPriority(day: {
  readonly priority?: string | null;
  readonly focus: string | null | undefined;
  readonly mainWorkout: string | null | undefined;
}): PlanDayPriority | null {
  const inferred = inferSessionPriority(day.focus, day.mainWorkout);
  if (inferred === null) return null;
  return isPriority(day.priority) ? day.priority : inferred;
}
