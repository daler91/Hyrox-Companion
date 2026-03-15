import * as Sentry from "@sentry/node";
import express, { type Request, Response, NextFunction } from "express";
import compression from "compression";
import helmet from "helmet";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { storage } from "./storage";
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
const clerkDomains = "https://*.clerk.accounts.dev https://*.hyroxcompanion.life https://clerk.hyroxcompanion.life";
const connectSrc = isDev
  ? ["'self'", clerkDomains, "https://www.strava.com", "https://*.ingest.us.sentry.io", "ws:", "wss:"]
  : ["'self'", clerkDomains, "https://www.strava.com", "https://*.ingest.us.sentry.io"];
const scriptSrc = isDev
  ? ["'self'", "'unsafe-inline'", "'unsafe-eval'", clerkDomains]
  : ["'self'", "'unsafe-inline'", clerkDomains];

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc,
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", clerkDomains],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc,
      frameSrc: ["'self'", clerkDomains],
      workerSrc: ["'self'", "blob:"],
    },
  },
  crossOriginEmbedderPolicy: false,
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
}));

app.use((req, res, next) => {
  res.setHeader("Permissions-Policy", "camera=(), microphone=(self), geolocation=()");
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

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      log(`${req.method} ${path} ${res.statusCode} in ${duration}ms`);
    }
  });

  next();
});

await runStartupMaintenance(storage);
await registerRoutes(httpServer, app);

  app.use((err: AppError, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    // 🛡️ Sentinel: Prevent leaking sensitive error details to the client
    const message = status === 500 ? "Internal Server Error" : (err.message || "An error occurred");

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
const port = parseInt(process.env.PORT || "5000", 10);
httpServer.listen(
  {
    port,
    host: "0.0.0.0",
    reusePort: true,
  },
  () => {
    log(`serving on port ${port}`);
  },
);
