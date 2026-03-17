import { env } from "./env";
import type { Request } from "express";
import { getAuth } from "@clerk/express";
import { DEV_USER_ID } from "./clerkAuth";

export function getUserId(req: Request): string {
  try {
    const auth = getAuth(req);
    if (auth?.userId) {
      return auth.userId;
    }
  } catch {}

  if (env.NODE_ENV === "development") {
    return DEV_USER_ID;
  }

  throw new Error("User not authenticated");
}

export function toDateStr(date?: Date): string {
  return (date || new Date()).toISOString().split("T")[0];
}
