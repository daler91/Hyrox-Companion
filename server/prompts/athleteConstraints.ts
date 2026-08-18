import type { CoachAbsence, TrainingContext } from "../gemini/types";
import { sanitizeUserInput } from "../utils/sanitize";

/**
 * Shared renderer for the ATHLETE CONSTRAINTS block: the standing limitations
 * the athlete wrote about themselves, and the dated absences they declared.
 *
 * Used by BOTH the conversational chat / Coach-Insights prompt
 * (server/prompts.ts buildSystemPrompt) and the auto-coach suggestion /
 * review-note / plan-adjustment prompts (server/gemini/suggestionService.ts),
 * so the two paths never drift — the same reason formatCoachingAnalysis is
 * shared. Self-suppresses entirely for an athlete who has declared nothing.
 *
 * Every athlete-authored string goes through sanitizeUserInput: these are free
 * text fields being interpolated into a prompt.
 */

const TYPE_LABELS: Record<CoachAbsence["type"], string> = {
  injury: "Injury",
  illness: "Illness",
  travel: "Travel",
  rest: "Planned rest",
};

function formatRange(absence: CoachAbsence): string {
  const label = TYPE_LABELS[absence.type];
  const range =
    absence.startDate === absence.endDate
      ? absence.startDate
      : `${absence.startDate} to ${absence.endDate}`;
  const note = absence.note?.trim();
  return note ? `${label}, ${range} — "${sanitizeUserInput(note)}"` : `${label}, ${range}`;
}

/**
 * What the coach should DO about a current absence, stated once rather than
 * left for the model to infer. The two halves matter equally: program around
 * it, and don't read the resulting gap as the athlete slacking.
 */
function currentAbsenceGuidance(current: CoachAbsence[]): string {
  const anyMedical = current.some((a) => a.medical);
  return anyMedical
    ? `Program around this. Do not prescribe work that would aggravate it, and do not treat the sessions inside this range as non-compliance — the athlete told us why.`
    : `Plan around this. Sessions inside this range are not the athlete failing to train.`;
}

/**
 * Tolerates a missing context for the same reason it tolerates an empty one:
 * "this athlete has declared nothing to render" and "there is no athlete
 * context at all" both mean no block, and making the caller branch on that
 * distinction bought nothing.
 */
export function formatAthleteConstraints(context?: TrainingContext): string {
  if (!context) return "";
  const lines: string[] = [];

  const constraints = context.trainingConstraints?.trim();
  if (constraints) {
    lines.push(
      `STANDING CONSTRAINTS (the athlete's own words — these always apply): ${sanitizeUserInput(constraints)}`,
    );
    // Belt to the suppression's braces: computeExerciseGaps drops stations the
    // constraints rule out, but that matching is keyword-based and the other
    // computed signals (coverage stats, progression flags) have no equipment
    // model at all. Stating the precedence costs one line and covers whatever
    // the keywords miss.
    lines.push(
      `If any computed signal elsewhere in this context (exercise gaps, station coverage, progression flags) conflicts with these constraints, the constraints win — program a substitute, not the excluded work.`,
    );
  }

  // `active` was computed against the athlete's own today upstream, so an
  // inactive range only has to be split on which side of today it sits. With
  // no currentDate to compare against, everything inactive falls through to
  // past — describing a finished absence is harmless, whereas announcing a
  // past one as "upcoming" would have the coach program around a date that has
  // already gone.
  const today = context.currentDate;
  const current: CoachAbsence[] = [];
  const upcoming: CoachAbsence[] = [];
  const recent: CoachAbsence[] = [];
  for (const absence of context.absences ?? []) {
    if (absence.active) current.push(absence);
    else if (today && absence.startDate > today) upcoming.push(absence);
    else recent.push(absence);
  }

  if (current.length > 0) {
    lines.push(`CURRENTLY AFFECTED: ${current.map(formatRange).join("; ")}`);
    lines.push(currentAbsenceGuidance(current));
  }
  if (recent.length > 0) {
    lines.push(
      `RECENTLY AFFECTED: ${recent.map(formatRange).join("; ")}. This explains dips in the training history above — it is context, not a compliance problem.`,
    );
  }
  if (upcoming.length > 0) {
    lines.push(
      `UPCOMING: ${upcoming.map(formatRange).join("; ")}. Take this into account when programming those dates.`,
    );
  }

  if (lines.length === 0) return "";
  return [`--- ATHLETE CONSTRAINTS ---`, ...lines].join("\n");
}
