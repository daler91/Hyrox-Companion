import type { User } from "@shared/schema";

export function isUnauthorizedError(error: Error): boolean {
  return error.message === 'Unauthorized' || error.message.includes('401');
}

/**
 * Best-effort display name for a User: full name when available, otherwise
 * email, otherwise "User". Centralizes the fallback chain so the Sidebar,
 * Settings page, and any future avatar/menu surface agree.
 */
export function getUserDisplayName(
  user: Pick<User, "firstName" | "lastName" | "email"> | null | undefined,
): string {
  if (!user) return "User";
  if (user.firstName && user.lastName) return `${user.firstName} ${user.lastName}`;
  return user.email || "User";
}
