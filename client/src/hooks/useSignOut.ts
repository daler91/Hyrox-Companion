import { useClerk } from "@clerk/react";
import { useCallback, useState } from "react";

import { shouldBypassAuth } from "@/lib/authBypass";
import { getPendingCount } from "@/lib/offlineQueue";
import { clearUserLocalData } from "@/lib/userLocalData";

function useClerkSignOut() {
  const { signOut } = useClerk();
  return useCallback(async () => {
    // Awaited so the Workbox api-cache purge completes before the session ends
    // and the next athlete can sign in on this device.
    await clearUserLocalData();
    return signOut();
  }, [signOut]);
}

function useTestSignOut() {
  return () => clearUserLocalData();
}

export const useSignOut = shouldBypassAuth() ? useTestSignOut : useClerkSignOut;

export interface ConfirmedSignOut {
  /** The Log out button: signs out, or first asks while offline writes are queued. */
  readonly requestSignOut: () => Promise<unknown>;
  /** The question is open: offline writes are queued and the athlete has not answered. */
  readonly confirmingSignOut: boolean;
  /** How many queued writes the question is about. */
  readonly pendingWrites: number;
  /** "Sign out anyway": the queued writes are cleared with the rest of the session. */
  readonly confirmSignOut: () => Promise<unknown>;
  /** "Stay signed in": the writes stay queued and keep retrying. */
  readonly cancelSignOut: () => void;
}

/**
 * Sign-out for the Log out button. Signing out clears this device's offline
 * queue (clearUserLocalData), so writes still waiting to sync went with no
 * confirmation and no drop toast, unlike every other way the queue loses one.
 * With any queued, it asks first. A different athlete signing in still drops
 * the queue without asking: that is reconcileQueueOwner's privacy guard.
 * CL61 (CODEBASE_ANALYSIS_2026-10-03)
 */
export function useConfirmedSignOut(): ConfirmedSignOut {
  const signOut = useSignOut();
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  // Kept after the answer, so the closing dialog doesn't read "0 changes".
  const [pendingWrites, setPendingWrites] = useState(0);

  const requestSignOut = useCallback(() => {
    const pending = getPendingCount();
    if (pending === 0) return signOut();
    setPendingWrites(pending);
    setConfirmingSignOut(true);
    return Promise.resolve(pending);
  }, [signOut]);

  const confirmSignOut = useCallback(() => {
    setConfirmingSignOut(false);
    return signOut();
  }, [signOut]);

  const cancelSignOut = useCallback(() => {
    setConfirmingSignOut(false);
  }, []);

  return { requestSignOut, confirmingSignOut, pendingWrites, confirmSignOut, cancelSignOut };
}
