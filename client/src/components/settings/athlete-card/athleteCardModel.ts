import { isAthleteFactDue } from "@shared/athleteFacts";
import type { AthleteFact } from "@shared/schema";
import { type AthleteFactCategory, athleteFactCategoryEnum } from "@shared/schema/enums";

/** What a category is called in the app. */
export function athleteFactCategoryLabel(category: AthleteFactCategory): string {
  switch (category) {
    case "constraint":
      return "Injury or limit";
    case "equipment":
      return "Equipment";
    case "schedule":
      return "Schedule";
    case "preference":
      return "Preference";
    case "other":
      return "Other";
  }
}

export const ATHLETE_FACT_CATEGORY_OPTIONS = athleteFactCategoryEnum.map((value) => ({
  value,
  label: athleteFactCategoryLabel(value),
}));

export interface AthleteCardFacts {
  /** What the coach reads: facts due for a check first, oldest due first, then the rest as stated. */
  readonly active: readonly AthleteFact[];
  readonly retired: readonly AthleteFact[];
}

/** The card as Settings lists it, for the athlete's `today`. */
export function groupAthleteFacts(facts: readonly AthleteFact[], today: string): AthleteCardFacts {
  const active = facts.filter((fact) => fact.active);
  const due = active
    .filter((fact) => isAthleteFactDue(fact.reviewOn, today))
    .sort((a, b) => a.reviewOn.localeCompare(b.reviewOn));
  return {
    active: [...due, ...active.filter((fact) => !isAthleteFactDue(fact.reviewOn, today))],
    retired: facts.filter((fact) => !fact.active),
  };
}
