import { useState, useEffect, useCallback } from "react";
import { queryClient } from "@/lib/queryClient";

export function useOnboarding(
  isNewUser: boolean,
  fileInputRef: React.RefObject<HTMLInputElement>,
) {
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingTriggered, setOnboardingTriggered] = useState(false);
  const [coachOpen, setCoachOpen] = useState(false);
  const [hasAutoOpenedCoach, setHasAutoOpenedCoach] = useState(false);

  useEffect(() => {
    if (isNewUser && !onboardingTriggered && !localStorage.getItem("hyrox-onboarding-complete")) {
      setOnboardingTriggered(true);
      setShowOnboarding(true);
    }
  }, [isNewUser, onboardingTriggered]);

  useEffect(() => {
    if (!showOnboarding && onboardingTriggered && !hasAutoOpenedCoach) {
      setHasAutoOpenedCoach(true);
      setTimeout(() => {
        const isCurrentlyMobile = window.innerWidth < 768;
        if (!isCurrentlyMobile) {
          setCoachOpen(true);
        }
      }, 500);
    }
  }, [showOnboarding, onboardingTriggered, hasAutoOpenedCoach]);

  const handleOnboardingComplete = useCallback((choice: "sample" | "import" | "skip") => {
    setShowOnboarding(false);
    if (choice === "import" && fileInputRef.current) {
      setTimeout(() => {
        fileInputRef.current?.click();
      }, 100);
    } else if (choice === "sample") {
      queryClient.invalidateQueries({ queryKey: ["/api/plans"] });
      queryClient.invalidateQueries({ queryKey: ["/api/timeline"] });
    }
  }, [fileInputRef]);

  return {
    showOnboarding,
    coachOpen,
    setCoachOpen,
    handleOnboardingComplete,
  };
}
