import { useClerk } from "@clerk/clerk-react";

const isCypressTest = typeof globalThis.window !== "undefined" && "Cypress" in globalThis.window;

function useClerkSignOut() {
  const { signOut } = useClerk();
  return signOut;
}

function useTestSignOut() {
  return () => {};
}

export const useSignOut = isCypressTest ? useTestSignOut : useClerkSignOut;
