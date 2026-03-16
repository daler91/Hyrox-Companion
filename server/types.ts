import type { Request } from "express";
import { getAuth } from "@clerk/express";

export interface AuthenticatedRequest extends Request {}

export function getUserId(req: Request): string {
  const auth = getAuth(req);
  if (!auth?.userId) {
    throw new Error("User not authenticated");
  }
  return auth.userId;
}

export function toDateStr(date?: Date): string {
  return (date || new Date()).toISOString().split("T")[0];
}
