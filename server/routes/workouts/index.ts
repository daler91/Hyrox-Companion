import { Router } from "express";

import { registerWorkoutAiRoutes } from "./workoutsAi.routes";
import { registerWorkoutCrudRoutes } from "./workoutsCrud.routes";
import { registerWorkoutExportRoutes } from "./workoutsExport.routes";
import { registerWorkoutTimelineRoutes } from "./workoutsTimeline.routes";

const router = Router();

registerWorkoutAiRoutes(router);
registerWorkoutCrudRoutes(router);
registerWorkoutTimelineRoutes(router);
registerWorkoutExportRoutes(router);

export default router;
