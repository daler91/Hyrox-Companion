import { athleteFactReviewOn, MAX_ACTIVE_ATHLETE_FACTS, splitIntoFacts } from "@shared/athleteFacts";
import {
  type AthleteFactImportResult,
  type CreateAthleteFact,
  createAthleteFactSchema,
  type UpdateAthleteFact,
  updateAthleteFactSchema,
} from "@shared/schema";
import { type Request, type Response, Router } from "express";

import { isAuthenticated } from "../clerkAuth";
import { ErrorCode } from "../errors";
import { asyncHandler, rateLimiter, sendNotFound, validateBody } from "../routeUtils";
import { storage } from "../storage";
import type { AthleteFactWrite } from "../storage/athleteFacts";
import { getLocalDateStrSafe } from "../timezone";
import { getUserId } from "../types";
import { protectedDelete, protectedPatch, protectedPost } from "./_helpers/protectedRouteBuilder";

/**
 * The athlete card (coach-memory spec, Path C). No `aiConsent` or `aiBudget`:
 * these routes call no model, and an athlete must be able to record "bad left
 * knee" with the AI coach off, as timeline annotations allow. Consent is
 * enforced where facts are read, by the prompts behind the coach's own checks.
 */
const router = Router();

/** The review date for a fact stated or confirmed today, on the athlete's own calendar. */
async function reviewOnForToday(userId: string): Promise<string> {
  const user = await storage.users.getUser(userId);
  return athleteFactReviewOn(getLocalDateStrSafe(new Date(), user?.userTimezone));
}

function sendRefusal(res: Response, reason: Extract<AthleteFactWrite, { ok: false }>["reason"]) {
  if (reason === "not_found") return sendNotFound(res, "Fact not found");
  if (reason === "limit") {
    return res.status(409).json({
      error: `Your card holds up to ${MAX_ACTIVE_ATHLETE_FACTS} facts. Retire one that no longer applies first.`,
      code: ErrorCode.ATHLETE_FACT_LIMIT,
    });
  }
  return res.status(409).json({ error: "Your card already has that fact.", code: ErrorCode.ATHLETE_FACT_DUPLICATE });
}

/** GET /api/v1/athlete-facts: every fact, retired ones included, oldest first. */
router.get(
  "/api/v1/athlete-facts",
  isAuthenticated,
  rateLimiter("athleteFacts", 60),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await storage.athleteFacts.list(getUserId(req)));
  }),
);

/**
 * POST /api/v1/athlete-facts: add a fact. One the card already holds is
 * re-confirmed instead (made active again, review date moved out): 200 rather
 * than 201.
 */
protectedPost(
  router,
  "/api/v1/athlete-facts",
  { limiter: rateLimiter("athleteFacts", 20), validation: [validateBody(createAthleteFactSchema)] },
  async (req: Request<Record<string, never>, unknown, CreateAthleteFact>, res: Response) => {
    const userId = getUserId(req);
    const { fact, category, source = "athlete" } = req.body;
    const result = await storage.athleteFacts.add(userId, { fact, category, source }, await reviewOnForToday(userId));
    if (!result.ok) return sendRefusal(res, result.reason);
    res.status(result.created ? 201 : 200).json(result.fact);
  },
);

/**
 * POST /api/v1/athlete-facts/import: move the older free-text "Injuries &
 * Limitations" note into the card, a fact per sentence. The note is cleared
 * only once all of it fits, so nothing the athlete wrote is lost to the cap.
 */
protectedPost(
  router,
  "/api/v1/athlete-facts/import",
  { limiter: rateLimiter("athleteFacts", 20) },
  async (req: Request, res: Response) => {
    const userId = getUserId(req);
    const user = await storage.users.getUser(userId);
    const note = user?.trainingConstraints?.trim();
    if (!note) {
      res.json({ added: 0, skipped: 0 } satisfies AthleteFactImportResult);
      return;
    }
    const facts = splitIntoFacts(note).map((fact) => ({ fact, category: "constraint" as const, source: "plan_generation" as const }));
    const result = await storage.athleteFacts.seed(
      userId,
      facts,
      athleteFactReviewOn(getLocalDateStrSafe(new Date(), user?.userTimezone)),
    );
    if (result.skipped === 0) await storage.users.updateUserPreferences(userId, { trainingConstraints: null });
    res.json(result satisfies AthleteFactImportResult);
  },
);

/**
 * PATCH /api/v1/athlete-facts/:id: change a fact's wording or category,
 * retire or restore it, or confirm it is still true. Confirming and restoring
 * both move its review date out.
 */
protectedPatch(
  router,
  "/api/v1/athlete-facts/:id",
  { limiter: rateLimiter("athleteFacts", 20), validation: [validateBody(updateAthleteFactSchema)] },
  async (req: Request<{ id: string }, unknown, UpdateAthleteFact>, res: Response) => {
    const userId = getUserId(req);
    const { fact, category, active, confirm } = req.body;
    const reviewOn = confirm || active === true ? await reviewOnForToday(userId) : undefined;
    const result = await storage.athleteFacts.update(userId, req.params.id, { fact, category, active, reviewOn });
    if (!result.ok) return sendRefusal(res, result.reason);
    res.json(result.fact);
  },
);

/** DELETE /api/v1/athlete-facts/:id */
protectedDelete(
  router,
  "/api/v1/athlete-facts/:id",
  { limiter: rateLimiter("athleteFacts", 20) },
  async (req: Request<{ id: string }>, res: Response) => {
    if (!(await storage.athleteFacts.delete(getUserId(req), req.params.id))) {
      return sendNotFound(res, "Fact not found");
    }
    res.json({ success: true });
  },
);

export default router;
