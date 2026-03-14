import { useUser, useAuth as useClerkAuth } from "@clerk/clerk-react";
import { useQuery } from "@tanstack/react-query";
import type { User } from "@shared/schema";

const isCypressTest = typeof window !== "undefined" && "Cypress" in window;

function useClerkAuthImpl() {
  const { isSignedIn, isLoaded } = useClerkAuth();
  const { user: clerkUser } = useUser();

  const { data: dbUser, isLoading: isDbLoading } = useQuery<User>({
    queryKey: ["/api/auth/user"],
    enabled: !!isSignedIn,
    retry: false,
  });

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
    queryKey: ["/api/auth/user"],
    retry: false,
  });

  return {
    user: dbUser,
    isLoading,
    isAuthenticated: !!dbUser,
  };
}

export const useAuth = isCypressTest ? useTestAuthImpl : useClerkAuthImpl;
