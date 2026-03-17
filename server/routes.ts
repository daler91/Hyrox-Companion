import type { Express } from "express";
import swaggerUi from "swagger-ui-express";
import { generateOpenApiDocument } from "../shared/openapi";

import type { Server } from "node:http";
import { setupAuth } from "./clerkAuth";
import { registerStravaRoutes } from "./strava";

import aiRoutes from "./routes/ai";
import analyticsRoutes from "./routes/analytics";
import workoutRoutes from "./routes/workouts";
import planRoutes from "./routes/plans";
import authRoutes from "./routes/auth";
import preferencesRoutes from "./routes/preferences";
import emailRoutes from "./routes/email";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  await setupAuth(app);
  registerStravaRoutes(app);

  // Expose raw OpenAPI JSON
  const openApiDocument = generateOpenApiDocument();
  app.get("/api-docs/openapi.json", (req, res) => res.json(openApiDocument));

  // Serve Swagger UI
  app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(openApiDocument));


  app.use(authRoutes);
  app.use(preferencesRoutes);
  app.use(emailRoutes);
  app.use(aiRoutes);
  app.use(analyticsRoutes);
  app.use(workoutRoutes);
  app.use(planRoutes);

  return httpServer;
}
