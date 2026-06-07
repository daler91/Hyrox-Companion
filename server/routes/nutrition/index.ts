import { type NextFunction, type Request, type Response, Router } from "express";

import { env } from "../../env";
import { registerNutritionRoutes } from "./nutrition.routes";

const router = Router();

// Gate the entire nutrition surface behind the server feature flag. 404 (not
// 403) so a disabled feature is invisible, and enforced here — server-side — so
// a client with the flag forced on can't reach the API anyway (the W20
// "UI-only flag" anti-pattern the EMOM builder had to fix).
router.use("/api/v1/nutrition", (_req: Request, res: Response, next: NextFunction) => {
  if (env.NUTRITION_ENABLED !== "true") {
    return res.status(404).json({ error: "Not found", code: "NOT_FOUND" });
  }
  next();
});

registerNutritionRoutes(router);

export default router;
