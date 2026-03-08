import type { Request } from "express";

export interface AuthenticatedRequest extends Request {
  user: {
    claims: {
      sub: string;
      email?: string;
      first_name?: string;
      last_name?: string;
      profile_image?: string;
    };
  };
}

export function getUserId(req: any): string {
  return (req as AuthenticatedRequest).user.claims.sub;
}

export function toDateStr(date?: Date): string {
  return (date || new Date()).toISOString().split("T")[0];
}
