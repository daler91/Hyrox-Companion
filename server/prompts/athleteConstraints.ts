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

export function formatAthleteConstraints(context: TrainingContext): string {
  const lines: string[] = [];

  const constraints = context.trainingConstraints?.trim();
  if (constraints) {
    lines.push(
      `STANDING CONSTRAINTS (the athlete's own words — these always apply): ${sanitizeUserInput(constraints)}`,
    );
  }

  const absences = context.absences ?? [];
  const current = absences.filter((a) => a.active);
  // `active` was computed against the athlete's own today upstream, so an
  // inactive range only has to be split on which side of today it sits. With
  // no currentDate to compare against, everything inactive reads as past —
  // describing a finished absence is harmless, whereas announcing a past one
  // as "upcoming" would have the coach program around a date that has gone.
  const today = context.currentDate ?? "";
  const upcoming = today
    ? absences.filter((a) => !a.active && a.startDate > today)
    : [];
  const recent = absences.filter(
    (a) => !a.active && (!today || a.startDate <= today),
  );

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
