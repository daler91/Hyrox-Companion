export const ONBOARDING_GOALS = [
  {
    id: "strength",
    label: "Build strength",
    description: "Get stronger with progressive resistance training",
  },
  {
    id: "endurance",
    label: "Improve endurance",
    description: "Train for races or improve cardio fitness",
  },
  {
    id: "functional",
    label: "Functional fitness",
    description: "Hyrox, CrossFit, or general functional training",
  },
  {
    id: "weight_loss",
    label: "Lose weight",
    description: "Combine training with body composition goals",
  },
  {
    id: "fitness",
    label: "General fitness",
    description: "Overall health and well-being",
  },
] as const;

export type OnboardingGoalId = (typeof ONBOARDING_GOALS)[number]["id"];

export const DEFAULT_ONBOARDING_GOAL_ID: OnboardingGoalId = "functional";

// Functional fitness, the default goal, is the one sentence that names the
// division, so describeOnboardingGoal builds it and it is not listed here.
const GOAL_SENTENCES: ReadonlyMap<string, string> = new Map<OnboardingGoalId, string>([
  [
    "strength",
    "Get stronger for HYROX: heavier sled push and pull, and steadier lunges and wall balls",
  ],
  ["endurance", "Build my running endurance for HYROX's eight 1 km runs"],
  ["weight_loss", "Lose weight while building HYROX fitness"],
  ["fitness", "Build all-round fitness with HYROX-style training"],
]);

/**
 * The picked goal as a sentence the plan generator and the coach can act on.
 * The AI dialog used to be prefilled with the bare label ("Functional
 * fitness"), and template users' goal was thrown away (onboarding audit M3,
 * L6). A race date, when given, is part of the goal.
 */
export function describeOnboardingGoal(
  goalId: string,
  options: { division?: "open" | "pro"; raceDate?: string } = {},
): string {
  const division = options.division === "pro" ? "Pro" : "Open";
  const sentence =
    GOAL_SENTENCES.get(goalId) ?? `Complete HYROX ${division} feeling strong on every station`;
  return options.raceDate ? `${sentence}, racing on ${options.raceDate}` : sentence;
}
