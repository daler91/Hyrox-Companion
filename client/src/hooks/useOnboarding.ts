import { useCallback,useEffect, useState } from "react";

import { queryClient } from "@/lib/queryClient";

import { COACH_AUTO_OPEN_DELAY_MS, IMPORT_INPUT_DELAY_MS, MOBILE_BREAKPOINT_PX } from "./constants";

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
  fileInputRef: React.RefObject<HTMLInputElement>,
  aiCoachEnabled = true,
) {
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingTriggered, setOnboardingTriggered] = useState(false);
  const [coachOpen, setCoachOpen] = useState(false);
  const [hasAutoOpenedCoach, setHasAutoOpenedCoach] = useState(false);

  useEffect(() => {
    if (onboardingTriggered) return;
    const forcedByUrl = hasOnboardingForceParam();
    const isFirstTime =
      isNewUser && !localStorage.getItem("hyrox-onboarding-complete");
    if (forcedByUrl || isFirstTime) {
      if (forcedByUrl) {
        localStorage.removeItem("hyrox-onboarding-complete");
        clearOnboardingForceParam();
      }
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOnboardingTriggered(true);
      setShowOnboarding(true);
    }
  }, [isNewUser, onboardingTriggered]);

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
  }, [showOnboarding, onboardingTriggered, hasAutoOpenedCoach]);

  const handleOnboardingComplete = useCallback((choice: "sample" | "import" | "skip") => {
    setShowOnboarding(false);
    if (choice === "import" && fileInputRef.current) {
      setTimeout(() => {
        fileInputRef.current?.click();
      }, IMPORT_INPUT_DELAY_MS);
    } else if (choice === "sample") {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/plans"] }).catch(() => {});
      queryClient.invalidateQueries({ queryKey: ["/api/v1/timeline"] }).catch(() => {});
    }
  }, [fileInputRef]);

  return {
    showOnboarding,
    coachOpen,
    setCoachOpen,
    handleOnboardingComplete,
  };
}
