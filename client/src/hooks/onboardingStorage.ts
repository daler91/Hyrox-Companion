import { safeLocalStorage } from "@/lib/safeStorage";

export const ONBOARDING_COMPLETE_STORAGE_KEY = "fitai-onboarding-complete";

/**
 * Whether this device recorded that the athlete `userId` finished onboarding.
 * The flag holds the athlete's id rather than "true": an unscoped flag let the
 * next account on a shared device skip onboarding, and useOnboarding's sync
 * then marked that account complete on the server. A legacy "true", or another
 * athlete's id, names someone else and reads as not completed.
 * CL45 (CODEBASE_ANALYSIS_2026-10-03)
 */
export function hasLocalOnboardingComplete(userId: string | undefined): boolean {
  if (!userId) return false;
  return safeLocalStorage.getItem(ONBOARDING_COMPLETE_STORAGE_KEY) === userId;
}

/** Records that `userId` finished onboarding; a no-op until the athlete is known. */
export function markLocalOnboardingComplete(userId: string | undefined): void {
  if (!userId) return;
  safeLocalStorage.setItem(ONBOARDING_COMPLETE_STORAGE_KEY, userId);
}

export function clearLocalOnboardingComplete(): void {
  safeLocalStorage.removeItem(ONBOARDING_COMPLETE_STORAGE_KEY);
}
