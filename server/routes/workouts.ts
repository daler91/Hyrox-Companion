import { Router } from "express";

import { registerWorkoutAiRoutes } from "./workouts/workoutsAi.routes";
import { registerWorkoutCrudRoutes } from "./workouts/workoutsCrud.routes";
import { registerWorkoutExportRoutes } from "./workouts/workoutsExport.routes";
import { registerWorkoutTimelineRoutes } from "./workouts/workoutsTimeline.routes";

const router = Router();

registerWorkoutAiRoutes(router);
registerWorkoutCrudRoutes(router);
registerWorkoutTimelineRoutes(router);
registerWorkoutExportRoutes(router);

export default router;
