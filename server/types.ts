// Ensure pino-http's type augmentation (req.log) is visible to TypeScript
import "pino-http";

import { getAuth } from "@clerk/express";
import type { Request } from "express";

import { DEV_USER_ID, devBypassAllowedFor } from "./clerkAuth";

export function getUserId(req: Request): string {
  try {
    const auth = getAuth(req);
    if (auth?.userId) {
      return auth.userId;
    }
  } catch {
    // intentionally empty - fall through to dev user
  }

  if (devBypassAllowedFor(req)) {
    return DEV_USER_ID;
  }

  throw new Error("User not authenticated");
}
