import type { TimelineEntry } from "@shared/schema";
import { useCallback, useState } from "react";

import { buildWorkoutCoachSeedMessage } from "@/components/workout-detail/EmbeddedWorkoutCoachChat";
import type { useToast } from "@/hooks/use-toast";
import { api, QUERY_KEYS } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";

type CoachIntent =
  | { readonly kind: "global" }
  | { readonly kind: "embedded"; readonly entryId: string; readonly seedText: string };

type ToastFn = ReturnType<typeof useToast>["toast"];

interface EmbeddedCoachRoutingParams {
  readonly aiCoachEnabled: boolean;
  readonly isAuthUserLoaded: boolean;
  readonly setCoachOpen: (open: boolean) => void;
  readonly setShowAIConsent: (open: boolean) => void;
  readonly openSurface: (entry: TimelineEntry) => void;
  readonly closeAllSurfacesAndClearUrl: () => void;
  readonly toast: ToastFn;
}

export function useEmbeddedCoachRouting({
  aiCoachEnabled,
  isAuthUserLoaded,
  setCoachOpen,
  setShowAIConsent,
  openSurface,
  closeAllSurfacesAndClearUrl,
  toast,
}: EmbeddedCoachRoutingParams) {
  const [embeddedCoachEntryId, setEmbeddedCoachEntryId] = useState<string | null>(null);
  const [embeddedCoachSeedText, setEmbeddedCoachSeedText] = useState("");
  const [embeddedCoachSeedNonce, setEmbeddedCoachSeedNonce] = useState(0);
  const [pendingCoachIntent, setPendingCoachIntent] = useState<CoachIntent | null>(null);

  const handleCoachToggle = useCallback(
    (open: boolean) => {
      if (open && isAuthUserLoaded && !aiCoachEnabled) {
        setPendingCoachIntent({ kind: "global" });
        setShowAIConsent(true);
        return;
      }
      setCoachOpen(open);
    },
    [isAuthUserLoaded, aiCoachEnabled, setCoachOpen, setShowAIConsent],
  );

  const openEmbeddedCoach = useCallback(
    (entry: TimelineEntry, seedText = buildWorkoutCoachSeedMessage(entry)) => {
      if (isAuthUserLoaded && !aiCoachEnabled) {
        setPendingCoachIntent({ kind: "embedded", entryId: entry.id, seedText });
        setShowAIConsent(true);
        return;
      }
      setEmbeddedCoachEntryId(entry.id);
      setEmbeddedCoachSeedText(seedText);
      setEmbeddedCoachSeedNonce((nonce) => nonce + 1);
      setCoachOpen(false);
    },
    [aiCoachEnabled, isAuthUserLoaded, setCoachOpen, setShowAIConsent],
  );

  const closeEmbeddedCoach = useCallback(() => {
    setEmbeddedCoachEntryId(null);
  }, []);

  const closeWorkoutSurfaces = useCallback(() => {
    setEmbeddedCoachEntryId(null);
    closeAllSurfacesAndClearUrl();
  }, [closeAllSurfacesAndClearUrl]);

  const openTimelineSurface = useCallback(
    (entry: TimelineEntry) => {
      setEmbeddedCoachEntryId(null);
      openSurface(entry);
    },
    [openSurface],
  );

  const clearPendingCoachIntent = useCallback(() => {
    setPendingCoachIntent(null);
    setShowAIConsent(false);
  }, [setShowAIConsent]);

  const handleAIConsentAccept = useCallback(() => {
    setShowAIConsent(false);
    api.preferences
      .update({ aiCoachEnabled: true })
      .then(() => {
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.authUser }).catch(() => {});
        if (pendingCoachIntent?.kind === "embedded") {
          setEmbeddedCoachEntryId(pendingCoachIntent.entryId);
          setEmbeddedCoachSeedText(pendingCoachIntent.seedText);
          setEmbeddedCoachSeedNonce((nonce) => nonce + 1);
          setCoachOpen(false);
        } else {
          setCoachOpen(true);
        }
        setPendingCoachIntent(null);
      })
      .catch(() => {
        toast({ title: "Could not enable AI Coach", description: "Please try again." });
      });
  }, [pendingCoachIntent, setCoachOpen, setShowAIConsent, toast]);

  return {
    embeddedCoachEntryId,
    embeddedCoachSeedText,
    embeddedCoachSeedNonce,
    handleCoachToggle,
    openEmbeddedCoach,
    closeEmbeddedCoach,
    closeWorkoutSurfaces,
    openTimelineSurface,
    clearPendingCoachIntent,
    handleAIConsentAccept,
  };
}
