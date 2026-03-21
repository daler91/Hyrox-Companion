import { useEffect, useRef } from "react";
import { useUser, useAuth as useClerkAuth } from "@clerk/clerk-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { User } from "@shared/schema";

const isCypressTest = globalThis.window !== undefined && "Cypress" in globalThis.window;
const isDevPreview = import.meta.env.DEV && globalThis.window !== undefined && (!import.meta.env.VITE_CLERK_PUBLISHABLE_KEY || globalThis.window.self !== globalThis.window.top);
const shouldBypassAuth = isCypressTest || isDevPreview;

function useAutoCoachWatcher(user?: User) {
  const queryClient = useQueryClient();
  const wasCoachingRef = useRef(false);

  useEffect(() => {
    if (user) {
      const isCoaching = !!user.isAutoCoaching;
      // If transitioned from true to false, invalidate timeline
      if (wasCoachingRef.current && !isCoaching) {
        queryClient.invalidateQueries({ queryKey: ["/api/v1/timeline"] });
      }
      wasCoachingRef.current = isCoaching;
    }
  }, [user?.isAutoCoaching, queryClient, user]);
}

function useClerkAuthImpl() {
  const { isSignedIn, isLoaded } = useClerkAuth();
  const { user: clerkUser } = useUser();

  const { data: dbUser, isLoading: isDbLoading } = useQuery<User>({
    queryKey: ["/api/v1/auth/user"],
    enabled: !!isSignedIn,
    retry: false,
    refetchInterval: (query) => query.state.data?.isAutoCoaching ? 2000 : false,
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
  const { data: dbUser, isLoading } = useQuery<User>({
    queryKey: ["/api/v1/auth/user"],
    retry: false,
    refetchInterval: (query) => query.state.data?.isAutoCoaching ? 2000 : false,
  });

  useAutoCoachWatcher(dbUser);

  return {
    user: dbUser,
    isLoading,
    isAuthenticated: !!dbUser,
  };
}

export const useAuth = shouldBypassAuth ? useTestAuthImpl : useClerkAuthImpl;
