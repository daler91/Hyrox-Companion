// Startup wrapper — captures crashes that happen before the app's logger initializes.
// If the main application fails to import (e.g. missing env vars, bad config),
// a fallback HTTP server starts on the PORT so the platform healthcheck gets a
// proper 503 instead of "service unavailable" (connection refused).

import { createServer } from "node:http";

const port = Number.parseInt(process.env.PORT || "5000", 10);

process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION:", err);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error("UNHANDLED REJECTION:", reason);
  process.exit(1);
});

try {
  await import("../dist/index.js");
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error("FATAL: Failed to start application:");
  console.error(err);

  // Start a fallback server so the platform healthcheck receives a clear 503
  // with the error details, rather than "service unavailable" (no listener).
  const fallback = createServer((req, res) => {
    if (req.url && req.url.startsWith("/api/v1/health")) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "error", error: "startup_failed", message, timestamp: Date.now() }));
    } else {
      res.writeHead(503, { "Content-Type": "text/plain" });
      res.end("Service unavailable — startup failed");
    }
  });

  fallback.listen(port, "0.0.0.0", () => {
    console.error(`Fallback health server on port ${port} — startup failed: ${message}`);
  });
}
