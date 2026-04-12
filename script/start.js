// Startup wrapper — captures crashes that happen before the app's logger initializes.
// If the main application fails to import (e.g. missing env vars, bad config),
// a fallback HTTP server starts on the PORT so the platform healthcheck gets a
// proper 503 instead of "service unavailable" (connection refused).

// Earliest possible signal — process.stderr.write is synchronous and guaranteed
// to flush before the process can die, unlike console.log which may be buffered.
process.stderr.write(`[start.js] Process started pid=${process.pid} node=${process.version} at=${new Date().toISOString()}\n`);

import { createServer } from "node:http";

const port = Number.parseInt(process.env.PORT || "5000", 10);
let fallbackRunning = false;

function startFallbackServer(message) {
  if (fallbackRunning) return;
  fallbackRunning = true;

  const fallback = createServer((req, res) => {
    if (req.url?.startsWith("/api/v1/health")) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "error", error: "startup_failed", message, timestamp: Date.now() }));
    } else {
      res.writeHead(503, { "Content-Type": "text/plain" });
      res.end("Service unavailable — startup failed");
    }
  });

  fallback.listen(port, "0.0.0.0", () => {
    process.stderr.write(`[start.js] Fallback health server listening on port ${port} — startup failed: ${message}\n`);
  });
}

// Instead of calling process.exit(1) immediately (which kills the process before
// the fallback server can start and before stdout/stderr is flushed), start the
// fallback server first, then schedule a delayed exit so the platform healthcheck
// can capture the error.
process.on("uncaughtException", (err) => {
  process.stderr.write(`[start.js] UNCAUGHT EXCEPTION: ${err?.stack || err}\n`);
  const message = err instanceof Error ? err.message : String(err);
  startFallbackServer(`uncaught_exception: ${message}`);
  // Give the fallback server time to bind and serve at least one healthcheck
  setTimeout(() => process.exit(1), 30_000);
});

process.on("unhandledRejection", (reason) => {
  process.stderr.write(`[start.js] UNHANDLED REJECTION: ${reason instanceof Error ? reason.stack : reason}\n`);
  const message = reason instanceof Error ? reason.message : String(reason);
  startFallbackServer(`unhandled_rejection: ${message}`);
  setTimeout(() => process.exit(1), 30_000);
});

process.stderr.write(`[start.js] Importing dist/index.js...\n`);

try {
  await import("../dist/index.js");
  process.stderr.write(`[start.js] Application imported successfully\n`);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`[start.js] FATAL: Failed to start application: ${message}\n`);
  process.stderr.write(`[start.js] ${err?.stack || err}\n`);
  startFallbackServer(message);
}
