import * as Sentry from "@sentry/node";
import express, { type Request, Response, NextFunction } from "express";
import compression from "compression";
import helmet from "helmet";
import { logger } from "./logger";
import pinoHttp from "pino-http";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "node:http";
import { storage } from "./storage";
import { pool } from "./db";
import { getAuth } from "@clerk/express";
import { runStartupMaintenance } from "./maintenance";

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || "development",
    sendDefaultPii: true,
  });
}

const app = express();
const httpServer = createServer(app);

export interface AppError extends Error {
  status?: number;
  statusCode?: number;
}

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(compression());

const isDev = process.env.NODE_ENV !== "production";
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

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: Date.now() });
});



app.use(pinoHttp({
  logger,
  customProps: (req, res) => {
    let userId = 'anonymous';
    try {
      const auth = getAuth(req as Request);
      if (auth?.userId) {
        userId = auth.userId;
      }
    } catch {
      // Ignored: getAuth throws if the request is not processed by Clerk middleware yet,
      // which is expected for public routes. We safely fall back to 'anonymous'.
      userId = 'anonymous';
    }

    return {
      context: 'http',
      userId
    };
  },
  autoLogging: {
    ignore: (req) => !req.url?.startsWith('/api')
  }
}));

await runStartupMaintenance(storage);
await registerRoutes(httpServer, app);

app.use((err: AppError, _req: Request, res: Response, _next: NextFunction) => {
  const status = err.status || err.statusCode || 500;
  // 🛡️ Sentinel: Prevent leaking sensitive error details to the client
  const message =
    status === 500
      ? "Internal Server Error"
      : err.message || "An error occurred";

  Sentry.captureException(err);
  res.status(status).json({ message });
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
const port = Number.parseInt(process.env.PORT || "5000", 10);

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
  httpServer.close(() => {
    logger.info("HTTP server closed. Draining database pool...");
    pool.end().then(() => {
      logger.info("Database pool drained. Exiting process.");
      process.exit(0);
    });
  });
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
