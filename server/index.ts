import { env } from "./env";
import * as Sentry from "@sentry/node";
import express, { type Request, Response, NextFunction } from "express";
import compression from "compression";
import helmet from "helmet";
import { logger } from "./logger";
import pinoHttp from "pino-http";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import swaggerUi from "swagger-ui-express";
import { generateOpenApiDocument } from "../shared/openapi";

import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { storage } from "./storage";
import { pool } from "./db";
import { getAuth } from "@clerk/express";
import { runStartupMaintenance } from "./maintenance";
import { startQueue, queue } from "./queue";

// 🛡️ Sentinel: Dev Auth Bypass double-guard
if (env.ALLOW_DEV_AUTH_BYPASS === "true") {
  if (env.NODE_ENV === "production") {
    logger.fatal("🚨 FATAL: ALLOW_DEV_AUTH_BYPASS is set to true in production. This is a catastrophic security risk. Shutting down.");
    process.exit(1);
  } else {
    logger.warn("⚠️ WARNING: Dev auth bypass is ENABLED. All requests will run as dev-user. Do not use this outside of local development.");
  }
}

if (env.SENTRY_DSN) {
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV || "development",
    sendDefaultPii: true,
  });
}

const app = express();
app.disable("x-powered-by");
const httpServer = createServer(app);

export interface AppError extends Error {
  status?: number;
  statusCode?: number;
  code?: string;
  details?: unknown;
}

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(compression());

const isDev = env.NODE_ENV !== "production";
const clerkDomains =
  "https://*.clerk.accounts.dev https://*.hyroxcompanion.life https://clerk.hyroxcompanion.life";
const connectSrc = isDev
  ? [
      "'self'",
      clerkDomains,
      "https://www.strava.com",
      "https://*.ingest.us.sentry.io",
      "ws:",
      "wss:",
    ]
  : [
      "'self'",
      clerkDomains,
      "https://www.strava.com",
      "https://*.ingest.us.sentry.io",
    ];
const scriptSrc = isDev
  ? ["'self'", "'unsafe-inline'", "'unsafe-eval'", clerkDomains]
  : ["'self'", "'unsafe-inline'", clerkDomains];

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc,
        styleSrc: [
          "'self'",
          "'unsafe-inline'",
          "https://fonts.googleapis.com",
          clerkDomains,
        ],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc,
        frameSrc: ["'self'", clerkDomains],
        workerSrc: ["'self'", "blob:"],
      },
    },
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  }),
);

app.use((req, res, next) => {
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(self), geolocation=()",
  );
  next();
});

// Coaching material routes accept large document content (up to 1.5M chars)
app.use("/api/v1/coaching-materials", express.json({ limit: "2mb" }));

app.use(
  express.json({
    limit: "100kb", // 🛡️ Sentinel: Limit request body size to prevent DoS
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

app.get("/api/v1/health", (_req, res) => {
  res.json({ status: "ok", timestamp: Date.now() });
});



app.use(pinoHttp({
  logger,
  genReqId: (req) => req.headers['x-request-id'] || randomUUID(),
  customProps: (req, _res) => {
    let userId = 'anonymous';
    try {
      const auth = getAuth(req as Request);
      if (auth?.userId) {
        userId = auth.userId;
      }
    } catch {
      userId = 'anonymous';
    }

    return {
      context: 'http',
      userId,
      requestId: req.id,
      route: req.url || req.originalUrl,
    };
  },
  autoLogging: {
    ignore: (req) => !req.url?.startsWith('/api/v1')
  }
}));

await runStartupMaintenance(storage);
await startQueue();
await registerRoutes(httpServer, app);

// Serve OpenAPI docs
app.use(
  "/api/docs",
  swaggerUi.serve,
  swaggerUi.setup(generateOpenApiDocument(), {
    customCss: ".swagger-ui .topbar { display: none } .swagger-ui .info { margin: 20px 0; }",
    customSiteTitle: "Workout API Documentation"
  })
);


app.use((err: AppError, _req: Request, res: Response, _next: NextFunction) => {
  const status = err.status || err.statusCode || 500;
  // 🛡️ Sentinel: Prevent leaking sensitive error details to the client
  const message =
    status === 500
      ? "Internal Server Error"
      : err.message || "An error occurred";

  Sentry.captureException(err);
  res.status(status).json({ error: message, code: err.code || (status >= 500 ? "INTERNAL_SERVER_ERROR" : "BAD_REQUEST"), details: err.details });
});

// importantly only setup vite in development and after
// setting up all the other routes so the catch-all route
// doesn't interfere with the other routes
if (process.env.NODE_ENV === "production" || process.env.NODE_ENV === "test") {
  serveStatic(app);
} else {
  const { setupVite } = await import("./vite");
  await setupVite(httpServer, app);
}

// ALWAYS serve the app on the port specified in the environment variable PORT
// Other ports are firewalled. Default to 5000 if not specified.
// this serves both the API and the client.
// It is the only port that is not firewalled.
const port = Number.parseInt(env.PORT || "5000", 10);

httpServer.listen(
  {
    port,
    host: "0.0.0.0",
    reusePort: true,
  },
  () => {
    logger.info({ port }, `serving on port ${port}`);
  },
);

// Graceful shutdown
const shutdown = () => {
  logger.info("Received shutdown signal. Closing HTTP server...");
  httpServer.close(async () => {
    logger.info("HTTP server closed. Stopping queue...");
    try {
      await queue.stop();
      logger.info("Queue stopped.");
    } catch (err) {
      logger.error(err, "Error stopping queue");
    }

    logger.info("Draining database pool...");
    pool.end().then(() => {
      logger.info("Database pool drained. Exiting process.");
      process.exit(0);
    }).catch((err) => {
      logger.error(err, "Error draining database pool. Exiting process.");
      process.exit(1);
    });
  });
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
