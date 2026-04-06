import { useAuth as useClerkAuth,useUser } from "@clerk/react";
import type { User } from "@shared/schema";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";

import { QUERY_KEYS } from "@/lib/api";
import { resetCsrfToken } from "@/lib/queryClient";

const isCypressTest = globalThis.window !== undefined && "Cypress" in globalThis.window;
const isDevPreview = import.meta.env.DEV && globalThis.window !== undefined && (!import.meta.env.VITE_CLERK_PUBLISHABLE_KEY || globalThis.window.self !== globalThis.window.top);
const shouldBypassAuth = isCypressTest || isDevPreview;

/** Max polling duration for auto-coaching status (5 minutes) */
const MAX_COACHING_POLL_MS = 5 * 60 * 1000;
const COACHING_POLL_INTERVAL_MS = 2000;

/**
 * Returns a stable refetchInterval callback for useQuery that:
 * - Polls every 2s while isAutoCoaching is true
 * - Stops polling when tab is hidden
 * - Stops polling after 5 minutes of continuous coaching
 */
function useCoachingPollInterval() {
  const pollStartRef = useRef<number | null>(null);

  return useCallback((query: { state: { data?: User } }) => {
    const isCoaching = !!query.state.data?.isAutoCoaching;

    if (!isCoaching) {
      pollStartRef.current = null;
      return false as const;
    }

    // Pause polling when tab is hidden
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      return false as const;
    }

    // Track when polling started
    if (pollStartRef.current === null) {
      pollStartRef.current = Date.now();
    }

    // Stop after max duration
    if (Date.now() - pollStartRef.current > MAX_COACHING_POLL_MS) {
      return false as const;
    }

    return COACHING_POLL_INTERVAL_MS;
  }, []);
}

function useAutoCoachWatcher(user?: User) {
  const queryClient = useQueryClient();
  const wasCoachingRef = useRef(false);

  useEffect(() => {
    if (user) {
      const isCoaching = !!user.isAutoCoaching;
      if (wasCoachingRef.current && !isCoaching) {
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.timeline }).catch(() => {});
      }
      wasCoachingRef.current = isCoaching;
    }
  }, [user?.isAutoCoaching, queryClient, user]);
}

function useClerkAuthImpl() {
  const { isSignedIn, isLoaded } = useClerkAuth();
  const { user: clerkUser } = useUser();
  const coachingPollInterval = useCoachingPollInterval();

  // Invalidate the cached CSRF token on any sign-in state transition. The
  // server binds CSRF tokens to the Clerk userId (or req.ip pre-login), so a
  // token cached while anonymous is not valid once the user signs in and
  // vice versa. This effect is registered before useEmailCheck in the parent
  // component (AuthenticatedLayout), so it flushes first and the next
  // mutation picks up a fresh token.
  const prevSignedInRef = useRef<boolean | undefined>(undefined);
  useEffect(() => {
    if (prevSignedInRef.current !== undefined && prevSignedInRef.current !== isSignedIn) {
      resetCsrfToken();
    }
    prevSignedInRef.current = isSignedIn;
  }, [isSignedIn]);

  const { data: dbUser, isLoading: isDbLoading } = useQuery<User>({
    queryKey: QUERY_KEYS.authUser,
    enabled: !!isSignedIn,
    retry: false,
    refetchInterval: coachingPollInterval,
  });

  useAutoCoachWatcher(dbUser);

  return {
    user: dbUser || (isSignedIn && clerkUser ? {
      id: clerkUser.id,
      email: clerkUser.emailAddresses?.[0]?.emailAddress || null,
      firstName: clerkUser.firstName,
      lastName: clerkUser.lastName,
      profileImageUrl: clerkUser.imageUrl,
    } as User : undefined),
    isLoading: !isLoaded || (isSignedIn && isDbLoading),
    isAuthenticated: !!isSignedIn,
  };
}

function useTestAuthImpl() {
  const coachingPollInterval = useCoachingPollInterval();

  const { data: dbUser, isLoading } = useQuery<User>({
    queryKey: QUERY_KEYS.authUser,
    retry: false,
    refetchInterval: coachingPollInterval,
  });

  useAutoCoachWatcher(dbUser);

  return {
    user: dbUser,
    isLoading,
    isAuthenticated: !!dbUser,
  };
}

export const useAuth = shouldBypassAuth ? useTestAuthImpl : useClerkAuthImpl;
