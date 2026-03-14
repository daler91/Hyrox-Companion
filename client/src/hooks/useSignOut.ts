import { useClerk } from "@clerk/clerk-react";

const isCypressTest = typeof window !== "undefined" && "Cypress" in window;

function useClerkSignOut() {
  const { signOut } = useClerk();
  return signOut;
}

function useTestSignOut() {
  return () => {};
}

export const useSignOut = isCypressTest ? useTestSignOut : useClerkSignOut;
