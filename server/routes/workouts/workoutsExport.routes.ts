import { type Request, type Response, Router } from "express";

import { isAuthenticated } from "../../clerkAuth";
import { asyncHandler, rateLimiter } from "../../routeUtils";
import { generateCSV, generateJSON } from "../../services/exportService";
import { storage } from "../../storage";
import { getUserId } from "../../types";

export function registerWorkoutExportRoutes(router: Router): void {
  router.get("/api/v1/export", isAuthenticated, rateLimiter("export", 5, 60000), asyncHandler(async (req: Request<Record<string, never>, Record<string, never>, Record<string, never>, { format?: string }>, res: Response) => {
    const userId = getUserId(req);
    const format = (req.query.format as string) || "csv";
    if (format === "json") {
      const data = await generateJSON(userId, storage);
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Content-Disposition", "attachment; filename=hyrox-training-data.json");
      return res.json(data);
    }
    const csv = await generateCSV(userId, storage);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=hyrox-training-data.csv");
    res.send(csv);
  }));
}
