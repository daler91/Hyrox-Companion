import { useCallback, useRef, useState } from "react";

import type { MissedRecoveryRequest, RecoverEntryHandler } from "@/components/timeline/missed-recovery";
import { useApplyMissedRecovery } from "@/hooks/useMissedRecovery";

/**
 * Which missed session the recovery sheet is open on. Fold, shorten and let go
 * all open the sheet — even letting go shows what it costs before it happens.
 * Taking a decision back is immediate: it only returns the session to where it
 * was, undecided, and the sheet is there again from its card.
 *
 * One take-back per session is in flight at a time. A double tap on Undo sent
 * two reopens, and the second, refused because the first had already reopened
 * the session, put an error toast beside the success one. The guard is a ref,
 * so a second tap is ignored even before a re-render could disable anything.
 * CL72 (CODEBASE_ANALYSIS_2026-10-03)
 */
export function useMissedRecoveryFlow() {
  const [request, setRequest] = useState<MissedRecoveryRequest | null>(null);
  const { mutateAsync: applyRecovery } = useApplyMissedRecovery();
  const reopening = useRef(new Set<string>());

  const recover = useCallback<RecoverEntryHandler>(
    (entry, action) => {
      const { planDayId } = entry;
      if (!planDayId) return;
      if (action === "reopen") {
        if (reopening.current.has(planDayId)) return;
        reopening.current.add(planDayId);
        const { recovery } = entry;
        const moved = recovery === "folded" || recovery === "shortened";
        applyRecovery({
          planDayId,
          body: { action: "reopen" },
          undoing: moved ? { recovery, missedOn: entry.missedOn ?? null } : undefined,
        })
          .finally(() => {
            reopening.current.delete(planDayId);
          })
          // The mutation's own error handler has already told the athlete.
          .catch(() => undefined);
        return;
      }
      setRequest({ entry, option: action });
    },
    [applyRecovery],
  );

  const close = useCallback(() => {
    setRequest(null);
  }, []);

  return { request, recover, close };
}
