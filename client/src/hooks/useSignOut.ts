import { useClerk } from "@clerk/clerk-react";

const isCypressTest = typeof window !== "undefined" && "Cypress" in window;
const isDevPreview = import.meta.env.DEV && typeof window !== "undefined" && (!import.meta.env.VITE_CLERK_PUBLISHABLE_KEY || window.self !== window.top);
const shouldBypassAuth = isCypressTest || isDevPreview;

function useClerkSignOut() {
  const { signOut } = useClerk();
  return signOut;
}

function useTestSignOut() {
  return () => {};
}

export const useSignOut = shouldBypassAuth ? useTestSignOut : useClerkSignOut;
