import type { QueryClient } from "@tanstack/react-query";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { vi } from "vitest";

// Shared harness for the offline-mutation hook specs (useLogFood.offline,
// updateStatus.offline). The specs' vi.mock factories delegate here so the
// offline-queue and toast spies aren't re-declared per file; each spec keeps
// its own mock for the API call under test.

/** Spies behind the offline-queue and toast mocks. Assert against these. */
export const offlineMocks = {
  enqueueMutation: vi.fn(),
  createOfflineMutationId: vi.fn(() => "queued-id"),
  toast: vi.fn(),
};

/** Factory body for `vi.mock("@/lib/offlineQueue", ...)`. */
export function makeOfflineQueueMock() {
  return {
    enqueueMutation: offlineMocks.enqueueMutation,
    createOfflineMutationId: offlineMocks.createOfflineMutationId,
  };
}

/** Factory body for `vi.mock("@/hooks/use-toast", ...)`. */
export function makeOfflineToastMock() {
  return { useToast: () => ({ toast: offlineMocks.toast }) };
}

/** Provider wrapper that reads the spec's current QueryClient lazily. */
export function makeWrapper(getClient: () => QueryClient) {
  return function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={getClient()}>{children}</QueryClientProvider>;
  };
}

/** Flip navigator.onLine for offline-path tests. */
export function setOnline(online: boolean) {
  Object.defineProperty(globalThis.navigator, "onLine", { value: online, configurable: true });
}
