import type { NextFunction, Request, Response } from "express";

import { storage } from "../storage";
import { getUserId } from "../types";

// Privacy gate for every route that forwards user data to Google Gemini.
// The README and schema default establish AI processing as opt-in: new
// users land with `aiCoachEnabled = false` and must flip the toggle in
// Settings/Onboarding before any workout, chat, or image payload is
// sent to the model. Enforce on the server side so a compromised or
// out-of-date client cannot bypass the consent.
export function aiConsentCheck(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const run = async () => {
    const userId = getUserId(req);
    const user = await storage.users.getUser(userId);
    if (user?.aiCoachEnabled !== true) {
      res.status(403).json({
        error: "AI coaching is disabled for this account. Enable it in Settings before using AI features.",
        code: "AI_COACH_DISABLED",
      });
      return;
    }
    next();
  };
  void run().catch(next);
}
