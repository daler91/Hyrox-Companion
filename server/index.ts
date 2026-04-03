import { env } from "./env";
import * as Sentry from "@sentry/node";
import express, { type Request, Response, NextFunction } from "express";
import compression from "compression";
import cors from "cors";
import helmet from "helmet";
import { logger } from "./logger";
import pinoHttp from "pino-http";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import swaggerUi from "swagger-ui-express";
import { generateOpenApiDocument } from "../shared/openapi";
import { cspNonceMiddleware } from "./middleware/cspNonce";

import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { storage } from "./storage";
import { pool } from "./db";
import { vectorPool } from "./vectorDb";
import { getAuth } from "@clerk/express";
import { runStartupMaintenance } from "./maintenance";
import { startQueue, queue } from "./queue";
import { startCron, stopCron } from "./cron";

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

// CORS — restrict cross-origin API access to known origins
const allowedOrigins = [
  env.APP_URL,
  "https://fitai.coach",
  ...(isDev ? ["http://localhost:5000", "http://localhost:5173"] : []),
].filter(Boolean) as string[];

app.use(cors({
  origin: (origin, callback) => {
    // Allow same-origin requests (no Origin header) and allowed origins
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
}));
const clerkDomains =
  "https://*.clerk.accounts.dev https://*.fitai.coach https://clerk.fitai.coach";
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

// Generate per-request CSP nonce (production only; dev uses 'unsafe-inline')
if (!isDev) {
  app.use(cspNonceMiddleware);
}

app.use(
  helmet({
    contentSecurityPolicy: false, // Managed manually below for nonce support
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  }),
);

// Manual CSP — production uses per-request nonces instead of 'unsafe-inline'
app.use((_req, res, next) => {
  const scriptSrc = isDev
    ? `'self' 'unsafe-inline' 'unsafe-eval' ${clerkDomains}`
    : `'self' 'nonce-${res.locals.cspNonce}' ${clerkDomains}`;
  const policy = [
    `default-src 'self'`,
    `script-src ${scriptSrc}`,
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com ${clerkDomains}`,
    `font-src 'self' https://fonts.gstatic.com data:`,
    `img-src 'self' data: https:`,
    `connect-src ${connectSrc.join(" ")}`,
    `frame-src 'self' ${clerkDomains}`,
    `worker-src 'self' blob:`,
  ].join("; ");
  res.setHeader("Content-Security-Policy", policy);
  next();
});

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

app.use(express.urlencoded({ extended: false, limit: "100kb" })); // 🛡️ Sentinel: Limit urlencoded body size to prevent DoS

let isReady = false;
let startupError: string | null = null;

app.get("/api/v1/health", (_req, res) => {
  if (startupError) {
    res.status(503).json({ status: "error", error: startupError, timestamp: Date.now() });
  } else {
    res.json({ status: isReady ? "ok" : "starting", timestamp: Date.now() });
  }
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

// Listen early so the health endpoint is reachable during startup (unblocks CI wait-on)
const port = Number.parseInt(env.PORT || "5000", 10);
await new Promise<void>((resolve, reject) => {
  httpServer.once("error", reject);
  httpServer.listen({ port, host: "0.0.0.0" }, () => {
    httpServer.removeListener("error", reject);
    logger.info({ port }, `listening on port ${port} (startup in progress...)`);
    resolve();
  });
});

try {
  await runStartupMaintenance(storage);
  await startQueue();
  startCron(storage);
  if (!env.RESEND_API_KEY) {
    logger.warn({ context: "email" }, "RESEND_API_KEY is not set — email delivery is disabled");
  }
  await registerRoutes(httpServer, app);

  // Serve OpenAPI docs — swagger-ui injects inline scripts, so use a relaxed CSP
  app.use("/api/docs", (_req, res, next) => {
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:",
    );
    next();
  });
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
    res.status(status).json({ error: message, code: err.code || (status >= 500 ? "INTERNAL_SERVER_ERROR" : "BAD_REQUEST"), ...(status < 500 && err.details ? { details: err.details } : {}) });
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

  isReady = true;
  logger.info({ port }, `startup complete — serving on port ${port}`);
} catch (err) {
  startupError = err instanceof Error ? err.message : String(err);
  logger.fatal({ err }, "Startup failed — server is running but not ready");
  Sentry.captureException(err);
}

// Graceful shutdown
const SHUTDOWN_TIMEOUT_MS = 30_000;
const shutdown = () => {
  logger.info("Received shutdown signal. Closing HTTP server...");

  // Force exit if graceful shutdown takes too long (e.g. lingering SSE streams)
  const forceExit = setTimeout(() => {
    logger.error("Graceful shutdown timed out. Forcing exit.");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  stopCron();
  httpServer.close(() => {
    logger.info("HTTP server closed. Stopping queue...");
    queue.stop().then(() => {
      logger.info("Queue stopped.");
    }).catch((err) => {
      logger.error(err, "Error stopping queue");
    }).finally(() => {
      logger.info("Draining database pools...");
      Promise.all([pool.end(), vectorPool.end()]).then(() => {
        logger.info("Database pools drained. Exiting process.");
        process.exit(0);
      }).catch((err) => {
        logger.error(err, "Error draining database pools. Exiting process.");
        process.exit(1);
      });
    });
  });
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
