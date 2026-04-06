// Ensure pino-http's type augmentation (req.log) is visible to TypeScript
import "pino-http";

import { getAuth } from "@clerk/express";
import type { Request } from "express";

import { DEV_USER_ID } from "./clerkAuth";
import { env } from "./env";

export function getUserId(req: Request): string {
  try {
    const auth = getAuth(req);
    if (auth?.userId) {
      return auth.userId;
    }
  } catch {
    // intentionally empty - fall through to dev user
  }

  if ((env.NODE_ENV === "development" || env.NODE_ENV === "test") && env.ALLOW_DEV_AUTH_BYPASS === "true") {
    return DEV_USER_ID;
  }

  throw new Error("User not authenticated");
}

export function toDateStr(date?: Date): string {
  return (date || new Date()).toISOString().split("T")[0];
}
