import { ATHLETE_FACT_MAX_LENGTH } from "../../athleteFacts";
import { athleteFactCategoryEnum } from "../enums";
import type { athleteFacts } from "../tables";
import { z } from "../zod";

// The athlete card (coach-memory spec, Path C): what the athlete told the
// coach is true every week.

export type AthleteFact = typeof athleteFacts.$inferSelect;

const factText = z
  .string()
  .trim()
  .min(1, "Write the fact")
  .max(ATHLETE_FACT_MAX_LENGTH, `Keep a fact to ${ATHLETE_FACT_MAX_LENGTH} characters`);

/**
 * Body for `POST /api/v1/athlete-facts`. A fact the coach proposed in chat
 * and the athlete saved says so; the server's own seeds (the plan wizard,
 * onboarding) never come through here.
 */
export const createAthleteFactSchema = z.object({
  fact: factText,
  category: z.enum(athleteFactCategoryEnum),
  source: z.enum(["athlete", "chat"]).optional(),
});
export type CreateAthleteFact = z.infer<typeof createAthleteFactSchema>;

/**
 * Body for `PATCH /api/v1/athlete-facts/:id`: change its wording or category,
 * retire or restore it, or confirm it is still true (which moves its review
 * date out again, as restoring it does).
 */
export const updateAthleteFactSchema = z
  .object({
    fact: factText.optional(),
    category: z.enum(athleteFactCategoryEnum).optional(),
    active: z.boolean().optional(),
    confirm: z.literal(true).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: "Nothing to change" });
export type UpdateAthleteFact = z.infer<typeof updateAthleteFactSchema>;

/** What `POST /api/v1/athlete-facts/import` did with the older free-text note. */
export interface AthleteFactImportResult {
  /** Facts added, or re-confirmed because the card already had them. */
  readonly added: number;
  /** Facts that didn't fit under the cap; the note is kept until they do. */
  readonly skipped: number;
}
