import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

import { getAuth } from "@clerk/express";
import * as Sentry from "@sentry/node";
import compression from "compression";
import cookieParser from "cookie-parser";
import cors from "cors";
import express, { NextFunction,type Request, Response } from "express";
import helmet from "helmet";
import pinoHttp from "pino-http";

import { generateOpenApiDocument } from "../shared/openapi";
import { configureApp } from "./bootstrap/appConfig";
import { probePool, registerHealthEndpoint, type StartupHealthState } from "./bootstrap/health";
import { registerShutdownHandlers } from "./bootstrap/lifecycle";
import { configureObservability, registerProcessErrorHandlers } from "./bootstrap/observability";
import { startCron, stopCron } from "./cron";
import { pool } from "./db";
import { env } from "./env";
import { AppError } from "./errors";
import { isImageParsePath } from "./imageParsePaths";
import { logger } from "./logger";
import { runStartupMaintenance } from "./maintenance";
import { buildCspDirectives } from "./middleware/csp";
import { cspNonceMiddleware } from "./middleware/cspNonce";
import { queue,startQueue } from "./queue";
import { runWithRequestContext } from "./requestContext";
import { registerRoutes } from "./routes";
import { drainSseStreams } from "./sseRegistry";
import { assertResolvedHostIsPublic } from "./ssrfGuard";
import { serveStatic } from "./static";
import { storage } from "./storage";
import { isVectorDbSeparate, vectorPool } from "./vectorDb";

// 🛡️ Sentinel: Dev Auth Bypass double-guard
if (env.ALLOW_DEV_AUTH_BYPASS === "true") {
  if (env.NODE_ENV === "production") {
    logger.fatal("🚨 FATAL: ALLOW_DEV_AUTH_BYPASS is set to true in production. This is a catastrophic security risk. Shutting down.");
    process.exit(1);
  } else {
    logger.warn("⚠️ WARNING: Dev auth bypass is ENABLED. All requests will run as dev-user. Do not use this outside of local development.");
  }
}

configureObservability();

const clientEmomFlagRaw = process.env.VITE_EMOM_BUILDER_ENABLED;
const clientEmomFlag = clientEmomFlagRaw === "true";
const serverEmomFlag = env.EMOM_BUILDER_ENABLED === "true";
logger.info({
  context: "startup-config",
  nodeEnv: env.NODE_ENV,
  emomBuilder: {
    server: serverEmomFlag,
    clientBuild: clientEmomFlag,
    matched: serverEmomFlag === clientEmomFlag,
  },
}, "Startup config check completed");

const app = express();

const { isDev } = configureApp(app);
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
// buffer holds chunks indefinitely on slow producers (e.g. reasoning AI with
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

// Health endpoint — registered BEFORE CORS so platform healthchecks
// (server-to-server requests with no Origin header) always work.
const startupState: StartupHealthState = {
  isReady: false,
  startupError: null,
  startupPhase: "initializing",
  startupBeganAt: Date.now(),
};

// Main transactional DB probe.
const probeDatabase = (): Promise<boolean> => probePool(pool);

// Probe the vector/RAG pool when it is configured on a separate connection
// string. When VECTOR_DATABASE_URL is unset both pools share a Neon
// endpoint, so probing it twice just burns a round trip without adding
// signal.
const probeVectorDatabase = (): Promise<boolean> =>
  isVectorDbSeparate ? probePool(vectorPool) : Promise.resolve(true);

registerHealthEndpoint(app, {
  state: startupState,
  probeDatabase,
  probeVectorDatabase,
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
// Generate per-request CSP nonce (production only; dev uses 'unsafe-inline').
// Must run before helmet so the nonce is available to the script-src directive
// function in buildCspDirectives.
if (!isDev) {
  app.use(cspNonceMiddleware);
}

app.use(
  helmet({
    // CSP directives live in one place (server/middleware/csp.ts) and are
    // emitted by helmet itself — a single source of truth, with no separate
    // override middleware and no disabled CSP. useDefaults:false so the emitted
    // policy is exactly buildCspDirectives.
    contentSecurityPolicy: {
      useDefaults: false,
      directives: buildCspDirectives({ isDev }),
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
// hitting the global 100kb limit below. Applied to the stateless image
// parsers + the stateful reparse siblings on workouts and plan days
// (`.../:id/reparse-from-image`).
const imageParseJsonParser = express.json({ limit: "10mb" });
app.use((req, res, next) => {
  if (isImageParsePath(req.path)) {
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
  customProps: (req, res) => {
    let userId = 'anonymous';
    try {
      const auth = getAuth(req as Request);
      if (auth?.userId) {
        userId = auth.userId;
      }
    } catch {
      userId = 'anonymous';
    }

    // S2: keep the raw user id out of the high-volume success-path access log
    // to limit PII in log sinks. The real id is attached only when the request
    // failed (>= 400), where it's needed to triage the error; successful
    // requests log a non-identifying 'authenticated'/'anonymous' marker.
    // Per-request app logs still bind the real userId via runWithRequestContext
    // for warn/error correlation.
    const isErrorResponse = (res?.statusCode ?? 0) >= 400;
    const loggedUserId =
      isErrorResponse || userId === 'anonymous' ? userId : 'authenticated';

    return {
      context: 'http',
      userId: loggedUserId,
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
  // Defense-in-depth SSRF guard (S2 / W2 follow-up). The env-time guard only
  // rejects IP-literal hosts; here we resolve a non-literal AI_TEXT_BASE_URL
  // host and refuse to become ready if it points at a private/loopback address
  // (e.g. an internal hostname → 10.x). DNS errors are non-fatal so a transient
  // resolver hiccup doesn't block an otherwise-healthy boot.
  if (env.AI_TEXT_BASE_URL) {
    startupState.startupPhase = "ssrf_guard";
    logger.info("Startup phase: ssrf_guard");
    await assertResolvedHostIsPublic(env.AI_TEXT_BASE_URL);
  }

  startupState.startupPhase = "db_maintenance";
  logger.info("Startup phase: db_maintenance");
  await runStartupMaintenance(storage);

  startupState.startupPhase = "queue";
  logger.info("Startup phase: queue");
  await startQueue();

  startupState.startupPhase = "cron";
  logger.info("Startup phase: cron");
  startCron(storage);
  if (!env.RESEND_API_KEY) {
    logger.warn({ context: "email" }, "RESEND_API_KEY is not set — email delivery is disabled");
  }

  startupState.startupPhase = "routes";
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
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'",
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
    // bearer:disable javascript_lang_logger_leak — static operational message;
    // only a constant `context` tag is logged, no PII or secrets.
    logger.info({ context: "ratelimit" }, "Rate limiter uses the Postgres-backed shared store (rate_limit_buckets) — limits are enforced across all instances.");
  }

  startupState.startupPhase = "ready";
  startupState.isReady = true;
  logger.info({ port, uptimeMs: Date.now() - startupState.startupBeganAt }, `startup complete — serving on port ${port}`);
} catch (err) {
  startupState.startupError = err instanceof Error ? err.message : String(err);
  logger.fatal({ err, phase: startupState.startupPhase }, `Startup failed during phase '${startupState.startupPhase}' — server is running but not ready`);
  Sentry.captureException(err);
}

registerShutdownHandlers(httpServer, {
  stopCron,
  drainSseStreams,
  stopQueue: () => queue.stop(),
  drainPools: async () => {
    await Promise.allSettled([pool.end(), vectorPool.end()]);
  },
  flushSentry: (timeoutMs) => Sentry.close(timeoutMs).then(() => undefined),
  exit: (code) => process.exit(code),
});

registerProcessErrorHandlers({
  onUncaught: (cb) => process.on("uncaughtException", cb),
  onUnhandled: (cb) => process.on("unhandledRejection", cb),
  setStartupError: (message) => {
    if (!startupState.startupError) startupState.startupError = message;
  },
  flush: (timeoutMs) => Sentry.flush(timeoutMs),
  exit: (code) => process.exit(code),
});
