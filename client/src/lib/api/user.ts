import type { User } from "@shared/schema";

import { rawRequest,typedRequest } from "./client";

export interface StravaSyncResponse {
  imported: number;
  skipped: number;
  total: number;
}

export const auth = {
  getUser: () => typedRequest<User>("GET", "/api/v1/auth/user"),
} as const;

export interface UserPreferences {
  weightUnit: string;
  distanceUnit: string;
  weeklyGoal: number;
  /** Master email toggle — when false, no emails are sent regardless of sub-toggles. */
  emailNotifications: boolean;
  /** Per-type toggle for the Monday weekly summary email. */
  emailWeeklySummary: boolean;
  /** Per-type toggle for the next-day missed workout reminder. */
  emailMissedReminder: boolean;
  aiCoachEnabled: boolean;
}

export type UpdateUserPreferencesPayload = Partial<UserPreferences>;

export const preferences = {
  get: () => typedRequest<UserPreferences>("GET", "/api/v1/preferences"),

  update: (data: UpdateUserPreferencesPayload) =>
    typedRequest<User>("PATCH", "/api/v1/preferences", data),
} as const;

export const strava = {
  auth: () => typedRequest<{ authUrl: string }>("GET", "/api/v1/strava/auth"),

  disconnect: () => rawRequest("DELETE", "/api/v1/strava/disconnect").then(() => undefined),

  sync: () => typedRequest<StravaSyncResponse>("POST", "/api/v1/strava/sync"),
} as const;

export const email = {
  check: () => typedRequest<{ sent: string[] }>("POST", "/api/v1/emails/check"),
} as const;
