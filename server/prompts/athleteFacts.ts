import { isAthleteFactDue } from "@shared/athleteFacts";
import type { AthleteFactCategory } from "@shared/schema";

import type { CoachAthleteFact } from "../gemini/types";
import { sanitizeUserInput } from "../utils/sanitize";

/**
 * The athlete card's lines for the ATHLETE CONSTRAINTS block (coach-memory
 * spec, Path C §4). formatAthleteConstraints renders them, and both prompt
 * assemblers render that (buildSystemPrompt, in both its branches, and
 * buildPromptDataSections), so the card can't reach one path and not the
 * other. athleteFacts.test.ts holds both to it.
 *
 * Every fact is the athlete's own free text, so each goes through
 * sanitizeUserInput like any other text interpolated into a prompt.
 */

const CATEGORY_LABELS: Record<AthleteFactCategory, string> = {
  constraint: "Constraint",
  equipment: "Equipment",
  schedule: "Schedule",
  preference: "Preference",
  other: "Note",
};

function factLine(fact: CoachAthleteFact, today: string | undefined): string {
  const unconfirmed = today !== undefined && isAthleteFactDue(fact.reviewOn, today);
  const flag = unconfirmed ? ` (unconfirmed since ${fact.reviewOn})` : "";
  return `- ${CATEGORY_LABELS[fact.category]}: ${sanitizeUserInput(fact.fact)}${flag}`;
}

/**
 * Every active fact. One past its review date still renders, flagged: dropping
 * something the athlete typed would be worse than keeping a stale one, and the
 * flag lets the coach check before leaning on it. Nothing for an athlete with
 * an empty card.
 */
export function formatAthleteFactLines(facts: readonly CoachAthleteFact[] | undefined, today: string | undefined): string[] {
  if (!facts || facts.length === 0) return [];
  const lines = [
    `ATHLETE CARD (what the athlete told us is true every week, in their own words; these always apply):`,
    ...facts.map((fact) => factLine(fact, today)),
  ];
  if (today !== undefined && facts.some((fact) => isAthleteFactDue(fact.reviewOn, today))) {
    lines.push(
      `An "unconfirmed" fact is one the athlete hasn't reconfirmed lately. Keep programming around it; in a conversation, check whether it still applies when it matters to your answer.`,
    );
  }
  return lines;
}
