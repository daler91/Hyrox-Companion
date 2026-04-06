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

export const preferences = {
  get: () => typedRequest<{ weightUnit: string; distanceUnit: string; weeklyGoal: number; emailNotifications: boolean; aiCoachEnabled: boolean }>("GET", "/api/v1/preferences"),

  update: (data: { weightUnit?: string; distanceUnit?: string; weeklyGoal?: number; emailNotifications?: boolean; aiCoachEnabled?: boolean }) =>
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
