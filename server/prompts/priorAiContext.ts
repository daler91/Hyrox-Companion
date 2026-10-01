import type { CoachNoteInputs } from "@shared/schema";

import { sanitizeUserInput } from "../utils/sanitize";

/**
 * Shared renderer for what the auto-coach last did to an upcoming session: its
 * review note, its last modification, and its last fatigue reduction.
 *
 * Used by BOTH the auto-coach prompts (server/gemini/suggestionService.ts),
 * which must not re-apply a change for the same fatigue episode, and the
 * conversational chat (server/prompts/coachingContext.ts), which otherwise
 * could not answer "why did Thursday change?". Same reason as
 * formatAthleteConstraints and formatMafContext: one renderer, so the two
 * paths cannot drift.
 */

/** The upcoming-workout fields this reads; both prompts' workout types have them. */
export interface PriorAiContextSource {
  aiRationale?: string | null;
  aiInputsUsed?: CoachNoteInputs | null;
}

type ModificationMetadata = NonNullable<CoachNoteInputs["lastModification"]>;

function formatModificationContext(
  label: string,
  modification: ModificationMetadata | undefined,
): string | undefined {
  if (!modification) return undefined;
  const details = [`kind=${modification.kind}`];
  if (typeof modification.completedWorkoutCount === "number") {
    details.push(`completedWorkoutsAtEdit=${modification.completedWorkoutCount}`);
  }
  if (modification.rpeTrend) details.push(`rpeTrendAtEdit=${modification.rpeTrend}`);
  if (typeof modification.fatigueFlag === "boolean") {
    details.push(`fatigueFlagAtEdit=${modification.fatigueFlag}`);
  }
  // modification.reason is `rationale` from the POST /timeline/ai-suggestions/apply
  // and plan-adjustment-proposal request bodies (see aiModificationGuard.ts), so it is
  // athlete-controllable free text that reaches this prompt on the *next* suggestion
  // call — same prompt-injection risk as aiRationale below, sanitize before interpolating.
  if (modification.reason) details.push(`reason=${sanitizeUserInput(modification.reason)}`);
  return `${label}: ${details.join("; ")}`;
}

/**
 * The prior-AI facts for one upcoming session, each a self-contained phrase
 * ("Prior AI review: …"). Callers join them with their own line's separator.
 */
export function priorAiContextParts(workout: PriorAiContextSource): string[] {
  const prior: string[] = [];
  if (workout.aiRationale?.trim()) {
    // Despite the name this is NOT model output: `rationale` is a field on
    // the POST /timeline/ai-suggestions/apply body, so an athlete can write
    // it directly and have it replayed into the next prompt. Sanitized like
    // the focus/main/accessory/notes fields on the same rendered line.
    prior.push(`Prior AI review: ${sanitizeUserInput(workout.aiRationale.trim())}`);
  }

  const lastModificationContext = formatModificationContext(
    "Last AI modification",
    workout.aiInputsUsed?.lastModification,
  );
  if (lastModificationContext) prior.push(lastModificationContext);

  const lastFatigueReductionContext = formatModificationContext(
    "Last fatigue reduction",
    workout.aiInputsUsed?.lastFatigueReduction,
  );
  if (
    lastFatigueReductionContext &&
    lastFatigueReductionContext !==
      lastModificationContext?.replace("Last AI modification", "Last fatigue reduction")
  ) {
    prior.push(lastFatigueReductionContext);
  }

  return prior;
}
