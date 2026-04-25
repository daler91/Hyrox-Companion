import type { User } from "@shared/schema";

import { rawRequest,typedRequest } from "./client";

export interface StravaSyncResponse {
  imported: number;
  skipped: number;
  total: number;
}

export interface StravaStatus {
  connected: boolean;
  athleteId?: string;
  lastSyncedAt?: string | null;
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
  /** Whether adherence indicators are shown in timeline/detail UI surfaces. */
  showAdherenceInsights: boolean;
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

export interface GarminStatus {
  connected: boolean;
  garminDisplayName?: string | null;
  lastSyncedAt?: string | null;
  lastError?: string | null;
}

export interface GarminSyncResponse {
  imported: number;
  skipped: number;
  total: number;
}

export const garmin = {
  // Garmin login is rate-limited and slow (full SSO flow). Bump the timeout
  // generously past the default 15s.
  connect: (email: string, password: string) =>
    typedRequest<{ success: boolean; garminDisplayName?: string | null }>(
      "POST",
      "/api/v1/garmin/connect",
      { email, password },
      { timeoutMs: 60_000 },
    ),

  disconnect: () =>
    rawRequest("DELETE", "/api/v1/garmin/disconnect").then(() => undefined),

  sync: () =>
    typedRequest<GarminSyncResponse>("POST", "/api/v1/garmin/sync", undefined, {
      timeoutMs: 60_000,
    }),
} as const;

export const email = {
  check: () => typedRequest<{ sent: string[] }>("POST", "/api/v1/emails/check"),
} as const;
