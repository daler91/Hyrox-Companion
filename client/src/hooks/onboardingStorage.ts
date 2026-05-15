export const ONBOARDING_COMPLETE_STORAGE_KEY = "fitai-onboarding-complete";

export function markOnboardingComplete(): void {
  localStorage.setItem(ONBOARDING_COMPLETE_STORAGE_KEY, "true");
}
