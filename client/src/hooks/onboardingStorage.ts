import { safeLocalStorage } from "@/lib/safeStorage";

export const ONBOARDING_COMPLETE_STORAGE_KEY = "fitai-onboarding-complete";

export function hasLocalOnboardingComplete(): boolean {
  return safeLocalStorage.getItem(ONBOARDING_COMPLETE_STORAGE_KEY) !== null;
}

export function markLocalOnboardingComplete(): void {
  safeLocalStorage.setItem(ONBOARDING_COMPLETE_STORAGE_KEY, "true");
}

export function clearLocalOnboardingComplete(): void {
  safeLocalStorage.removeItem(ONBOARDING_COMPLETE_STORAGE_KEY);
}
