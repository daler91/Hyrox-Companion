import { Router } from "express";

import { registerWorkoutAiRoutes } from "./workoutsAi.routes";
import { registerWorkoutCrudRoutes } from "./workoutsCrud.routes";
import { registerWorkoutExportRoutes } from "./workoutsExport.routes";
import { registerWorkoutMigrationRoutes } from "./workoutsMigration.routes";
import { registerWorkoutTimelineRoutes } from "./workoutsTimeline.routes";

const router = Router();

registerWorkoutAiRoutes(router);
registerWorkoutCrudRoutes(router);
registerWorkoutTimelineRoutes(router);
registerWorkoutExportRoutes(router);
registerWorkoutMigrationRoutes(router);

export default router;
