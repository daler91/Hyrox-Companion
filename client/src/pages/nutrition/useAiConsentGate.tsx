import { type ReactNode, useCallback, useRef, useState } from "react";

import { AIConsentDialog } from "@/components/coach/AIConsentDialog";
import { useToast } from "@/hooks/use-toast";
import { useIsAiCoachEnabled } from "@/hooks/useAuth";
import { api, QUERY_KEYS } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";

/**
 * Inline AI-consent gate for the nutrition AI flows (describe / snap / label).
 *
 * AI processing is opt-in (`aiCoachEnabled` defaults to false), and the parse
 * routes 403 without it — which used to surface as a dead-end error toast on a
 * brand-new user's very first "Describe a meal" attempt. Instead, wrap the
 * consent-requiring action in `requireAiConsent`: when consent is missing the
 * shared AIConsentDialog opens in place, and accepting flips the preference and
 * resumes the pending action with the user's input intact (mirrors the
 * Timeline coach's embedded-consent flow in useEmbeddedCoachRouting).
 */
export function useAiConsentGate(): {
  requireAiConsent: (action: () => void) => void;
  aiConsentDialog: ReactNode;
  /** True while the consent dialog is up — callers with their own dialog can
   *  hold it open instead of treating the overlay as an outside dismissal. */
  aiConsentOpen: boolean;
} {
  const aiEnabled = useIsAiCoachEnabled();
  const [open, setOpen] = useState(false);
  const pendingRef = useRef<(() => void) | null>(null);
  const { toast } = useToast();

  const requireAiConsent = useCallback(
    (action: () => void) => {
      if (aiEnabled) {
        action();
        return;
      }
      pendingRef.current = action;
      setOpen(true);
    },
    [aiEnabled],
  );

  const handleAccept = useCallback(() => {
    // Capture the action before closing: Radix also fires onOpenChange(false)
    // for the action button, which routes through the decline handler and
    // would clear the ref before the preference update resolves.
    const action = pendingRef.current;
    pendingRef.current = null;
    setOpen(false);
    api.preferences
      .update({ aiCoachEnabled: true })
      .then(() => {
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.authUser }).catch(() => {});
        action?.();
      })
      .catch(() => {
        toast({ title: "Could not enable AI features", description: "Please try again." });
      });
  }, [toast]);

  const handleDecline = useCallback(() => {
    setOpen(false);
    pendingRef.current = null;
  }, []);

  const aiConsentDialog = (
    <AIConsentDialog open={open} onAccept={handleAccept} onDecline={handleDecline} />
  );

  return { requireAiConsent, aiConsentDialog, aiConsentOpen: open };
}
