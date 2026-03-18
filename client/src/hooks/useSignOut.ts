import { useClerk } from "@clerk/clerk-react";

const isCypressTest = globalThis.window !== undefined && "Cypress" in globalThis.window;
const isDevPreview = import.meta.env.DEV && globalThis.window !== undefined && (!import.meta.env.VITE_CLERK_PUBLISHABLE_KEY || globalThis.window.self !== globalThis.window.top);
const shouldBypassAuth = isCypressTest || isDevPreview;

function useClerkSignOut() {
  const { signOut } = useClerk();
  return signOut;
}

function useTestSignOut() {
  return () => {};
}

export const useSignOut = shouldBypassAuth ? useTestSignOut : useClerkSignOut;
