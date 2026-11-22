// Ensure pino-http's type augmentation (req.log) is visible to TypeScript
import "pino-http";

import type { Request } from "express";

import { DEV_USER_ID, devBypassAllowedFor } from "./clerkAuth";
import { getClerkUserId } from "./clerkUserId";

export function getUserId(req: Request): string {
  // No Clerk user (or no Clerk middleware): fall through to the dev user.
  const userId = getClerkUserId(req);
  if (userId) {
    return userId;
  }

  if (devBypassAllowedFor(req)) {
    return DEV_USER_ID;
  }

  throw new Error("User not authenticated");
}
