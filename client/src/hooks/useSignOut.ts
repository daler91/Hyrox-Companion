import { useClerk } from "@clerk/react";
import { useCallback } from "react";

import { shouldBypassAuth } from "@/lib/authBypass";
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
