import { athleteFactReviewOn, splitIntoFacts } from "@shared/athleteFacts";
import type { AthleteFactSource } from "@shared/schema";

import { storage } from "../storage";
import { getLocalDateStrSafe } from "../timezone";

/** What putting free text on the card did: facts added or re-confirmed, and facts the cap left out. */
export interface CardStatementsResult {
  readonly added: number;
  readonly skipped: number;
}

/**
 * Put free text the athlete wrote elsewhere on their card, a fact per
 * sentence, as standing constraints, and drop the older free-text note
 * (`users.training_constraints`) once nothing of it is left out.
 *
 * Used for the older note itself (Settings' import) and for the plan wizard's
 * injuries box, which arrives prefilled with that note while the athlete
 * still has one: what comes back is their word on it, either kept (now on the
 * card) or cleared. An empty box adds nothing and still drops the note, as a
 * cleared box always did. Facts already on the card are re-confirmed; facts
 * the cap has no room for are counted, and then the note stays, so nothing
 * the athlete wrote is lost.
 */
export async function moveStatementsToCard(
  userId: string,
  text: string,
  source: AthleteFactSource,
): Promise<CardStatementsResult> {
  const user = await storage.users.getUser(userId);
  const facts = splitIntoFacts(text).map((fact) => ({ fact, category: "constraint" as const, source }));
  const result = await storage.athleteFacts.seed(
    userId,
    facts,
    athleteFactReviewOn(getLocalDateStrSafe(new Date(), user?.userTimezone)),
  );
  if (result.skipped === 0 && user?.trainingConstraints) {
    await storage.users.updateUserPreferences(userId, { trainingConstraints: null });
  }
  return result;
}
