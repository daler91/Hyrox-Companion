import { useCallback, useState } from "react";

import type { MissedRecoveryRequest, RecoverEntryHandler } from "@/components/timeline/missed-recovery";
import { useApplyMissedRecovery } from "@/hooks/useMissedRecovery";

/**
 * Which missed session the recovery sheet is open on. Fold, shorten and let go
 * all open the sheet — even letting go shows what it costs before it happens;
 * taking a let-go back is immediate, because it changes nothing but the card.
 */
export function useMissedRecoveryFlow() {
  const [request, setRequest] = useState<MissedRecoveryRequest | null>(null);
  const { mutate: applyRecovery } = useApplyMissedRecovery();

  const recover = useCallback<RecoverEntryHandler>(
    (entry, action) => {
      if (!entry.planDayId) return;
      if (action === "reopen") {
        applyRecovery({ planDayId: entry.planDayId, body: { action: "reopen" } });
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
