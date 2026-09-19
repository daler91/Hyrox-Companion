import { useClerk } from "@clerk/react";
import { useCallback } from "react";

import { clearUserLocalData } from "@/lib/userLocalData";

const isCypressTest = globalThis.window !== undefined && "Cypress" in globalThis.window;
const isDevPreview = import.meta.env.DEV && globalThis.window !== undefined && (!import.meta.env.VITE_CLERK_PUBLISHABLE_KEY || globalThis.window.self !== globalThis.window.top);
const shouldBypassAuth = isCypressTest || isDevPreview;

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

export const useSignOut = shouldBypassAuth ? useTestSignOut : useClerkSignOut;
