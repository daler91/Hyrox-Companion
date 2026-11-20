import { DEV_AUTH_BYPASS_HEADER } from "@shared/devAuth";

/**
 * When the app runs without Clerk.
 *
 * `App` decides from this whether `ClerkProvider` mounts at all, and `useAuth`
 * and `useSignOut` decide whether they may call Clerk's hooks, which throw
 * outside that provider. All three must therefore agree, which is why the
 * predicate lives here once instead of as three hand-kept copies.
 */

/** Running under Cypress, whose e2e suite drives the app with auth stubbed. */
export function isCypressTest(): boolean {
  return globalThis.window !== undefined && "Cypress" in globalThis.window;
}

/** A Vite dev build with no Clerk publishable key, or one running inside an iframe. */
export function isDevPreview(): boolean {
  const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;
  return (
    import.meta.env.DEV &&
    (!clerkPubKey || (globalThis.window !== undefined && globalThis.window.self !== globalThis.window.top))
  );
}

export function shouldBypassAuth(): boolean {
  return isCypressTest() || isDevPreview();
}

/**
 * Headers for every API call. While auth is bypassed they ask a dev server for
 * the dev-user fallback, which one with Clerk keys grants only to requests
 * that ask (tech debt #34, shared/devAuth.ts). Empty otherwise.
 */
export function devAuthBypassHeaders(): Record<string, string> {
  return shouldBypassAuth() ? { [DEV_AUTH_BYPASS_HEADER]: "true" } : {};
}
