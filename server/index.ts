import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

import { getAuth } from "@clerk/express";
import * as Sentry from "@sentry/node";
import compression from "compression";
import cookieParser from "cookie-parser";
import cors from "cors";
import express, { NextFunction,type Request, Response } from "express";
import helmet from "helmet";
import type { PoolClient } from "pg";
import pinoHttp from "pino-http";

import { generateOpenApiDocument } from "../shared/openapi";
import { startCron, stopCron } from "./cron";
import { pool } from "./db";
import { env } from "./env";
import { AppError } from "./errors";
import { logger } from "./logger";
import { runStartupMaintenance } from "./maintenance";
import { cspNonceMiddleware } from "./middleware/cspNonce";
import { queue,startQueue } from "./queue";
import { runWithRequestContext } from "./requestContext";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { storage } from "./storage";
import { vectorPool } from "./vectorDb";

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
    sendDefaultPii: false,
    tracesSampleRate: env.NODE_ENV === "production" ? 0.1 : 1,
    // 🛡️ Sentinel: Strip PII-bearing fields from error payloads before
    // transmission (CODEBASE_REVIEW_2026-04-12.md #2). Even with
    // sendDefaultPii=false, manually captured errors can carry request
    // bodies, query strings, cookies, or auth headers that contain user
    // email/name/biometrics.
    beforeSend(event) {
      if (event.request) {
        delete event.request.data;
        delete event.request.query_string;
        delete event.request.cookies;
        if (event.request.headers) {
          delete event.request.headers.authorization;
          delete event.request.headers.cookie;
          delete event.request.headers["x-csrf-token"];
          delete event.request.headers["x-idempotency-key"];
        }
      }
      if (event.user) {
        delete event.user.email;
        delete event.user.username;
        delete event.user.ip_address;
      }
      return event;
    },
  });
}

const app = express();

// Drive "trust proxy" from validated env config so req.ip is not derived
// from attacker-controlled forwarded headers in misconfigured deployments
// (CODEBASE_AUDIT.md §2).
let trustProxy: boolean | string | number = 1;
if (env.TRUST_PROXY === "0") {
  trustProxy = false;
} else if (env.TRUST_PROXY === "loopback") {
  trustProxy = "loopback";
}
app.set("trust proxy", trustProxy);

app.disable("x-powered-by");
const httpServer = createServer(app);

// Re-export AppError class from errors module; also keep a loose interface
// so the error handler can handle both AppError instances and plain errors
// with ad-hoc status/code properties (e.g. from third-party middleware).
export type { AppError } from "./errors";
interface LegacyError extends Error {
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

// Skip compression for Server-Sent Events — compression's internal gzip
// buffer holds chunks indefinitely on slow producers (e.g. Gemini with
// thinkingLevel HIGH), breaking streaming. See expressjs/compression
// README "Handling Server-Sent Events with Compression and Flush".
app.use(
  compression({
    filter: (req, res) => {
      const contentType = res.getHeader("Content-Type");
      if (typeof contentType === "string" && contentType.includes("text/event-stream")) {
        return false;
      }
      return compression.filter(req, res);
    },
  }),
);

const isDev = env.NODE_ENV !== "production";

// Health endpoint — registered BEFORE CORS so platform healthchecks
// (server-to-server requests with no Origin header) always work.
let isReady = false;
let startupError: string | null = null;
let startupPhase = "initializing";
const startupBeganAt = Date.now();

const HEALTH_PROBE_TIMEOUT_MS = 3000;

/**
 * Probe DB connectivity within a single 3s budget covering BOTH pool
 * acquisition and the SELECT 1 query. Under pool saturation, waiting only
 * on the query would let /api/v1/health block on pool.connect() until the
 * pool's own connectionTimeoutMillis — defeats the fast-fail intent.
 */
async function probeDatabase(): Promise<boolean> {
  // Track the client through a shared reference so the timeout path can
  // still release it if pool.connect() resolves AFTER the race rejects.
  // Without this, a slow pool under saturation leaks a connection per
  // timed-out probe (P1 from PR review).
  const clientRef: { current: PoolClient | undefined } = { current: undefined };
  let timedOut = false;

  const connectAndQuery = (async () => {
    const c = await pool.connect();
    clientRef.current = c;
    // If the race already timed out by the time we got a connection,
    // release it immediately so it returns to the pool (or is destroyed).
    if (timedOut) {
      c.release(new Error("health check timeout"));
      clientRef.current = undefined;
      throw new Error("timeout");
    }
    await c.query("SELECT 1");
  })();

  try {
    await Promise.race([
      connectAndQuery,
      new Promise((_, reject) => setTimeout(() => {
        timedOut = true;
        reject(new Error("timeout"));
      }, HEALTH_PROBE_TIMEOUT_MS)),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    // Release whichever path left the client checked out. On timeout we
    // destroy the connection so any hung SELECT 1 is discarded.
    clientRef.current?.release(timedOut ? new Error("health check timeout") : undefined);
  }
}

// Health endpoint — intentionally unthrottled because platform probes
// (Railway, load balancers) poll frequently and must never be rejected.
// The handler is O(1) and short-circuits before any DB call while not
// ready; the probe itself has a 3s total budget (see probeDatabase).
// lgtm[js/missing-rate-limiting]
app.get("/api/v1/health", (_req, res) => {
  const uptimeMs = Date.now() - startupBeganAt;
  if (startupError) {
    res.status(503).json({ status: "error", error: "startup_error", phase: startupPhase, uptimeMs, message: startupError, timestamp: Date.now() });
    return;
  }
  if (!isReady) {
    res.status(503).json({ status: "starting", phase: startupPhase, uptimeMs, timestamp: Date.now() });
    return;
  }
  probeDatabase()
    .then((dbOk) => {
      if (!dbOk) {
        res.status(503).json({ status: "degraded", db: false, uptimeMs, timestamp: Date.now() });
        return;
      }
      res.json({ status: "ok", uptimeMs, timestamp: Date.now() });
    })
    .catch((err) => {
      logger.error({ err }, "Health check probe failed unexpectedly");
      res.status(503).json({ status: "error", uptimeMs, timestamp: Date.now() });
    });
});

// CORS — restrict cross-origin API access to known origins
const defaultOrigins = [
  env.APP_URL,
  "https://fitai.coach",
].filter(Boolean) as string[];

const extraOrigins = env.ALLOWED_ORIGINS
  ? env.ALLOWED_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean)
  : [];

const allowedOrigins = new Set([
  ...defaultOrigins,
  ...extraOrigins,
  ...(isDev ? ["http://localhost:5000", "http://localhost:5173"] : []),
]);

app.use(cors({
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    // No Origin header → same-origin or server-to-server request; allow.
    // Known origin → add CORS headers so the browser permits the response.
    // Unknown origin → omit CORS headers; the browser enforces the block.
    if (!origin || allowedOrigins.has(origin)) {
      callback(null, true);
    } else {
      callback(null, false);
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
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
        imgSrc: ["'self'", "data:", "https://img.clerk.com", "https://*.clerk.com", "https://*.strava.com"],
        connectSrc: ["'self'"],
        frameSrc: ["'self'"],
        frameAncestors: ["'none'"],
        workerSrc: ["'self'", "blob:"],
      },
    },
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    // 🛡️ Sentinel: Explicit HSTS with preload (CODEBASE_REVIEW_2026-04-12.md
    // #19). Helmet's default is 180 days without preload; we want the full
    // one-year preload-list policy.
    strictTransportSecurity: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
  }),
);

// Override helmet's default CSP with per-request nonce-based policy
app.use((_req, res, next) => {
  const scriptSrc = isDev
    ? `'self' 'unsafe-inline' 'unsafe-eval' ${clerkDomains}`
    : `'self' 'nonce-${res.locals.cspNonce}' ${clerkDomains}`;
  const policy = [
    `default-src 'self'`,
    `script-src ${scriptSrc}`,
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com ${clerkDomains}`,
    `font-src 'self' https://fonts.gstatic.com data:`,
    `img-src 'self' data: https://img.clerk.com https://*.clerk.com https://*.strava.com`,
    `connect-src ${connectSrc.join(" ")}`,
    `frame-src 'self' ${clerkDomains}`,
    `frame-ancestors 'none'`,
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

// Image-parse routes ship the image as a base64 string in the JSON body.
// The schema caps base64 length at 10MB; this parser matches so oversized
// payloads are rejected at the body-parser layer with a 413 rather than
// hitting the global 100kb limit below. Applied to three paths: the
// stateless exercise parser + the stateful reparse siblings on workouts
// and plan days (`.../:id/reparse-from-image`).
const imageParseJsonParser = express.json({ limit: "10mb" });
const IMAGE_PARSE_PATH_RE =
  /^\/api\/v1\/(?:parse-exercises-from-image|workouts\/[^/]+\/reparse-from-image|plans\/days\/[^/]+\/reparse-from-image)\/?$/;
app.use((req, res, next) => {
  if (IMAGE_PARSE_PATH_RE.test(req.path)) {
    return imageParseJsonParser(req, res, next);
  }
  return next();
});

app.use(
  express.json({
    limit: "100kb", // 🛡️ Sentinel: Limit request body size to prevent DoS
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false, limit: "100kb" })); // 🛡️ Sentinel: Limit urlencoded body size to prevent DoS

// Cookie parser is required by the CSRF double-submit middleware mounted
// in registerRoutes(); it must run before any route that reads cookies.
app.use(cookieParser());

app.use(pinoHttp({
  logger,
  genReqId: (req) => {
    const clientId = req.headers['x-request-id'];
    // 🛡️ Sentinel: Validate client-supplied request IDs to prevent log injection
    // (CODEBASE_REVIEW_2026-04-12.md #40). Colon was previously allowed and is
    // adjacent to log-parser delimiters; restrict to alphanumerics + `._-` and
    // cap length at 36 (fits UUID/ULID without room for padding).
    if (typeof clientId === 'string' && /^[A-Za-z0-9._-]{1,36}$/.test(clientId)) {
      return clientId;
    }
    return randomUUID();
  },
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
      route: req.url?.split('?')[0] || req.originalUrl?.split('?')[0],
    };
  },
  autoLogging: {
    ignore: (req) => !req.url?.startsWith('/api/v1')
  }
}));

app.use((req, _res, next) => {
  const r = req as Request & { id?: string; auth?: { userId?: string } };
  const ctx = { requestId: r.id ?? "", userId: r.auth?.userId };
  runWithRequestContext(ctx, () => next());
});

const port = Number.parseInt(env.PORT || "5000", 10);

// Bind the HTTP server before running startup tasks so the health endpoint
// is always reachable by the platform healthcheck (e.g. Railway). Without
// this, a startup failure (DB unreachable, migration error, etc.) would
// prevent the server from ever listening, causing "service unavailable"
// instead of a clear 503 from the health endpoint.
await new Promise<void>((resolve, reject) => {
  httpServer.once("error", reject);
  httpServer.listen({ port, host: "0.0.0.0" }, () => {
    httpServer.removeListener("error", reject);
    resolve();
  });
});
logger.info({ port }, `HTTP server listening on port ${port} — running startup tasks...`);

try {
  startupPhase = "db_maintenance";
  logger.info("Startup phase: db_maintenance");
  await runStartupMaintenance(storage);

  startupPhase = "queue";
  logger.info("Startup phase: queue");
  await startQueue();

  startupPhase = "cron";
  logger.info("Startup phase: cron");
  startCron(storage);
  if (!env.RESEND_API_KEY) {
    logger.warn({ context: "email" }, "RESEND_API_KEY is not set — email delivery is disabled");
  }

  startupPhase = "routes";
  logger.info("Startup phase: routes");
  await registerRoutes(httpServer, app);

  // 🛡️ Sentinel: Swagger UI is restricted to development — it exposes the full API
  // schema and requires a relaxed CSP (unsafe-inline) which widens the attack surface.
  if (isDev) {
    // Dynamic import keeps swagger-ui-express out of the production bundle.
    const swaggerUi = await import("swagger-ui-express");
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
  }

  app.use((err: AppError | LegacyError, _req: Request, res: Response, _next: NextFunction) => {
    // Derive status and code from either the structured AppError class
    // or legacy ad-hoc error properties (e.g. from third-party middleware).
    const isAppError = err.name === "AppError" && "code" in err;
    const status = isAppError
      ? (err as import("./errors").AppError).status
      : ((err as LegacyError).status || (err as LegacyError).statusCode || 500);
    const defaultCode = status >= 500 ? "INTERNAL_SERVER_ERROR" : "BAD_REQUEST";
    const code = isAppError
      ? (err as import("./errors").AppError).code
      : ((err as LegacyError).code || defaultCode);
    const details = isAppError
      ? (err as import("./errors").AppError).details
      : (err as LegacyError).details;

    // 🛡️ Sentinel: Prevent leaking sensitive error details to the client
    const message =
      status === 500
        ? "Internal Server Error"
        : err.message || "An error occurred";

    // S3 — body-parser's default 413 message is just "request entity too large"
    // which gives the user no hint about the per-route limit (100kb default,
    // 2mb for coaching materials). Rewrite to something actionable.
    if (status === 413) {
      Sentry.captureException(err);
      return res.status(413).json({
        error: "Request body too large for this endpoint — try a smaller payload or split the upload.",
        code: "PAYLOAD_TOO_LARGE",
      });
    }

    Sentry.captureException(err);
    res.status(status).json({ error: message, code, ...(status < 500 && details ? { details } : {}) });
  });

  // Sentry Express error handler — captures unhandled errors that bypass
  // the custom handler above (e.g. middleware crashes).
  Sentry.setupExpressErrorHandler(app);

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (env.NODE_ENV === "production" || env.NODE_ENV === "test") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  if (env.NODE_ENV === "production") {
    logger.warn({ context: "ratelimit" }, "Rate limiter uses in-memory store — limits are per-instance only. Consider rate-limit-redis for multi-instance deployments.");
  }

  startupPhase = "ready";
  isReady = true;
  logger.info({ port, uptimeMs: Date.now() - startupBeganAt }, `startup complete — serving on port ${port}`);
} catch (err) {
  startupError = err instanceof Error ? err.message : String(err);
  logger.fatal({ err, phase: startupPhase }, `Startup failed during phase '${startupPhase}' — server is running but not ready`);
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
  // Flush pending Sentry events before draining connections so errors
  // captured during shutdown aren't silently dropped.
  Sentry.close(5000).catch(() => {});
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

// Global error handlers — catch async errors that escape startup/request handling.
// These log the error and set startupError so the health endpoint reports it,
// rather than silently crashing the process.
process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "Uncaught exception in server process");
  if (!startupError) {
    startupError = `uncaught_exception: ${err.message}`;
  }
  Sentry.captureException(err);
});

process.on("unhandledRejection", (reason) => {
  logger.fatal({ err: reason }, "Unhandled rejection in server process");
  if (!startupError) {
    startupError = `unhandled_rejection: ${reason instanceof Error ? reason.message : String(reason)}`;
  }
  Sentry.captureException(reason);
});
