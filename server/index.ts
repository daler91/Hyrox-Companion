import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { startEmailScheduler } from "./emailScheduler";
import { storage } from "./storage";

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

async function cleanOrphanedData() {
  try {
    await db.execute(sql`BEGIN`);
    await db.execute(sql`DELETE FROM exercise_sets WHERE workout_log_id NOT IN (SELECT id FROM workout_logs)`);
    await db.execute(sql`DELETE FROM chat_messages WHERE user_id NOT IN (SELECT id FROM users)`);
    await db.execute(sql`DELETE FROM custom_exercises WHERE user_id NOT IN (SELECT id FROM users)`);
    await db.execute(sql`DELETE FROM strava_connections WHERE user_id NOT IN (SELECT id FROM users)`);
    await db.execute(sql`UPDATE workout_logs SET plan_day_id = NULL WHERE plan_day_id IS NOT NULL AND plan_day_id NOT IN (SELECT id FROM plan_days)`);
    await db.execute(sql`DELETE FROM plan_days WHERE plan_id NOT IN (SELECT id FROM training_plans)`);
    await db.execute(sql`UPDATE workout_logs SET plan_day_id = NULL WHERE plan_day_id IS NOT NULL AND plan_day_id NOT IN (SELECT id FROM plan_days)`);
    await db.execute(sql`DELETE FROM workout_logs WHERE user_id NOT IN (SELECT id FROM users)`);
    await db.execute(sql`DELETE FROM training_plans WHERE user_id NOT IN (SELECT id FROM users)`);
    await db.execute(sql`COMMIT`);
    log("Orphaned data cleanup complete", "db");
  } catch (error) {
    await db.execute(sql`ROLLBACK`).catch(() => {});
    log(`Orphaned data cleanup skipped: ${error}`, "db");
  }
}

(async () => {
  await cleanOrphanedData();
  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
      startEmailScheduler(storage);
    },
  );
})();
