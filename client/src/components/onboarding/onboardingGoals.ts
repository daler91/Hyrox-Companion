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

export function getOnboardingGoalLabel(goalId: string): string {
  return ONBOARDING_GOALS.find((goal) => goal.id === goalId)?.label ?? "Functional fitness";
}
