import { athleteFactKey, athleteFactReviewOn, splitIntoFacts } from "@shared/athleteFacts";
import type { AthleteFact } from "@shared/schema";

import type { CoachAthleteFact } from "../gemini/types";
import { formatAthleteFactLines } from "../prompts/athleteFacts";

/** The athlete card as this plan reads it, and the athlete's today for its review flags. */
export interface GenerationCard {
  readonly facts: readonly CoachAthleteFact[];
  readonly today: string;
}

/**
 * What the plan is written around (coach-memory spec §4, render site 4): the
 * active facts on the athlete card, then anything the athlete wrote for this
 * plan that isn't on it, each once. The route has already put the wizard's
 * box on the card, so a leftover is one the card had no room for: it is still
 * the athlete's word for THIS plan, and stated today.
 *
 * `statement` is the wizard's box, or, only from a client that never sends
 * the box, the older free-text note: the remembered value is a prefill, never
 * a fallback for a box the athlete emptied. A piece matching a fact they
 * retired stays out: that is the card saying it no longer applies.
 */
export function buildGenerationCard(
  facts: readonly AthleteFact[],
  statement: string | null | undefined,
  today: string,
): GenerationCard {
  const active = facts.filter((fact) => fact.active);
  const known = new Set(facts.map((fact) => fact.dedupeKey));
  const leftovers = (statement ? splitIntoFacts(statement) : []).filter((piece) => !known.has(athleteFactKey(piece)));
  return {
    facts: [
      ...active.map(({ fact, category, reviewOn }) => ({ fact, category, reviewOn })),
      ...leftovers.map((fact) => ({ fact, category: "constraint" as const, reviewOn: athleteFactReviewOn(today) })),
    ],
    today,
  };
}

/** The card's text, for the exercise selection and the engine's constraint matching. */
export function generationCardConstraints(card: GenerationCard): string | null {
  return card.facts.length > 0 ? card.facts.map((fact) => fact.fact).join("\n") : null;
}

/** The card, then what to do with it, sent to every chunk: the facts hold in every week. */
export function athleteCardLines(card: GenerationCard | undefined): string[] {
  const lines = formatAthleteFactLines(card?.facts, card?.today);
  if (lines.length === 0) return [];
  return [
    "",
    ...lines,
    "Program around every fact above in every week: substitute the exercises they rule out (an injury, equipment the athlete doesn't have), avoid work that would aggravate an injury, and fit the sessions to their schedule.",
  ];
}
