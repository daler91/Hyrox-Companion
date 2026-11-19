/**
 * The training styles the coach knows. Each has a strategy in
 * server/services/training_styles/registry.ts, and the registry's test pins
 * that list to this one.
 *
 * `trainingStyleId` stays a plain string on the wire, so an app built before a
 * style is added still decodes it, but a preferences save naming a style not
 * listed here is refused. It used to be stored and coached as Balanced
 * (tech debt #35).
 */
export const TRAINING_STYLE_IDS = ["balanced_default", "maf_method"] as const;

export type TrainingStyleId = (typeof TRAINING_STYLE_IDS)[number];

/** The style an athlete who never chose one is coached with. */
export const DEFAULT_TRAINING_STYLE_ID: TrainingStyleId = "balanced_default";

export function isTrainingStyleId(value: string): value is TrainingStyleId {
  return (TRAINING_STYLE_IDS as readonly string[]).includes(value);
}
