import { type RefObject, useCallback, useEffect, useRef, useState } from "react";

import { hasLocalOnboardingComplete } from "@/hooks/onboardingStorage";
import { useCompleteOnboarding, useOnboardingUserId } from "@/hooks/useCompleteOnboarding";
import { queryClient } from "@/lib/queryClient";

import { COACH_AUTO_OPEN_DELAY_MS, IMPORT_INPUT_DELAY_MS, MOBILE_BREAKPOINT_PX } from "./constants";
import type { OnboardingCompletionChoice } from "./onboardingTypes";

function hasOnboardingForceParam(): boolean {
  if (globalThis.window === undefined) return false;
  return new URLSearchParams(globalThis.window.location.search).get("onboarding") === "run";
}

function clearOnboardingForceParam(): void {
  if (globalThis.window === undefined) return;
  const params = new URLSearchParams(globalThis.window.location.search);
  if (!params.has("onboarding")) return;
  params.delete("onboarding");
  const query = params.toString();
  const queryString = query.length > 0 ? `?${query}` : "";
  const path = globalThis.window.location.pathname;
  const hash = globalThis.window.location.hash;
  const newUrl = `${path}${queryString}${hash}`;
  globalThis.window.history.replaceState(null, "", newUrl);
}

export function useOnboarding(
  isNewUser: boolean,
  fileInputRef: RefObject<HTMLInputElement | null>,
  /** `onboardingCompleted` is undefined while the server's answer is unknown (see useIsOnboardingCompleted). */
  options: { aiCoachEnabled?: boolean; onboardingCompleted?: boolean; isAuthUserLoaded?: boolean } = {},
) {
  const aiCoachEnabled = options.aiCoachEnabled ?? true;
  const { onboardingCompleted } = options;
  const isAuthUserLoaded = options.isAuthUserLoaded ?? true;
  const completeOnboarding = useCompleteOnboarding();
  // The local flag is this athlete's alone: an unscoped one let the next account
  // on the device skip onboarding, and the sync below marked it complete on
  // the server. CL45 (CODEBASE_ANALYSIS_2026-10-03)
  const userId = useOnboardingUserId();
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingTriggered, setOnboardingTriggered] = useState(false);
  const [pendingImportCompletion, setPendingImportCompletion] = useState(false);
  const [coachOpen, setCoachOpen] = useState(false);
  const [hasAutoOpenedCoach, setHasAutoOpenedCoach] = useState(false);
  const syncedLocalCompletionRef = useRef(false);

  useEffect(() => {
    if (!isAuthUserLoaded) return;
    if (onboardingCompleted || syncedLocalCompletionRef.current) return;
    if (!hasLocalOnboardingComplete(userId)) return;
    syncedLocalCompletionRef.current = true;
    completeOnboarding();
  }, [completeOnboarding, isAuthUserLoaded, onboardingCompleted, userId]);

  useEffect(() => {
    if (onboardingTriggered) return;
    const forcedByUrl = hasOnboardingForceParam();
    // Only a server that answered "not completed" launches it: a failed
    // auth-user query leaves completion unknown, and a returning athlete on a
    // device without the local flag got the wizard. U5 (CODEBASE_ANALYSIS_2026-10-03)
    const isFirstTime =
      isNewUser && onboardingCompleted === false && !hasLocalOnboardingComplete(userId);
    if (forcedByUrl || isFirstTime) {
      if (forcedByUrl) {
        clearOnboardingForceParam();
      }
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOnboardingTriggered(true);
      setShowOnboarding(true);
    }
  }, [isNewUser, onboardingCompleted, onboardingTriggered, userId]);

  useEffect(() => {
    if (!showOnboarding && onboardingTriggered && !hasAutoOpenedCoach) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHasAutoOpenedCoach(true);
      const timerId = setTimeout(() => {
        const isCurrentlyMobile = globalThis.innerWidth < MOBILE_BREAKPOINT_PX;
        if (!isCurrentlyMobile && aiCoachEnabled) {
          setCoachOpen(true);
        }
      }, COACH_AUTO_OPEN_DELAY_MS);
      return () => clearTimeout(timerId);
    }
  }, [showOnboarding, onboardingTriggered, hasAutoOpenedCoach, aiCoachEnabled]);

  const handleOnboardingComplete = useCallback(
    (choice: OnboardingCompletionChoice) => {
      setShowOnboarding(false);
      if (choice === "import") {
        setPendingImportCompletion(true);
        const input = fileInputRef.current;
        if (input) {
          // Cancelling the file picker used to leave the athlete on an empty
          // Timeline, with setup restarting from Welcome on the next visit
          // (onboarding audit M1). The wizard stays mounted while hidden, so
          // reopening it lands back on the Plan step with its answers intact.
          const watching = new AbortController();
          input.addEventListener(
            "cancel",
            () => {
              watching.abort();
              setShowOnboarding(true);
            },
            { signal: watching.signal },
          );
          input.addEventListener(
            "change",
            () => {
              watching.abort();
            },
            { signal: watching.signal },
          );
          setTimeout(() => {
            input.click();
          }, IMPORT_INPUT_DELAY_MS);
        }
      } else if (choice === "sample" || choice === "generated") {
        queryClient.invalidateQueries({ queryKey: ["/api/v1/plans"] }).catch(() => {});
        queryClient.invalidateQueries({ queryKey: ["/api/v1/timeline"] }).catch(() => {});
      }
    },
    [fileInputRef],
  );

  const handlePlanImported = useCallback(() => {
    if (!pendingImportCompletion) return;
    completeOnboarding();
    setPendingImportCompletion(false);
  }, [completeOnboarding, pendingImportCompletion]);

  return {
    showOnboarding,
    coachOpen,
    setCoachOpen,
    handleOnboardingComplete,
    handlePlanImported,
    pendingImportCompletion,
  };
}
