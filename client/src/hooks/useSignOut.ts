import { useClerk } from "@clerk/clerk-react";

const isCypressTest = typeof window !== "undefined" && !!(window as any).Cypress;

function useClerkSignOut() {
  const { signOut } = useClerk();
  return signOut;
}

function useTestSignOut() {
  return () => {};
}

export const useSignOut = isCypressTest ? useTestSignOut : useClerkSignOut;
