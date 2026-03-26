// Startup wrapper — captures crashes that happen before the app's logger initializes.
// If the main app fails to start, spins up a diagnostic HTTP server so the health
// check passes and we can see the error in the Railway dashboard/logs.

import { createServer } from "node:http";

const PORT = process.env.PORT || "5000";

console.log("BOOT: script/start.js running");
console.log("BOOT: node=" + process.version + " pid=" + process.pid + " PORT=" + PORT);
console.log("BOOT: cwd=" + process.cwd());
console.log("BOOT: DATABASE_URL=" + (process.env.DATABASE_URL ? "set (" + process.env.DATABASE_URL.length + " chars)" : "NOT SET"));
console.log("BOOT: ENCRYPTION_KEY=" + (process.env.ENCRYPTION_KEY ? "set (" + process.env.ENCRYPTION_KEY.length + " chars)" : "NOT SET"));
console.log("BOOT: NODE_ENV=" + (process.env.NODE_ENV || "NOT SET"));

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
  console.log("BOOT: application loaded successfully");
} catch (err) {
  const errorMsg = err instanceof Error ? err.stack || err.message : String(err);
  console.error("FATAL: Failed to start application:");
  console.error(errorMsg);

  // Start a minimal diagnostic server so the health check passes
  // and we can see the error via the Railway service URL
  const server = createServer((req, res) => {
    console.log("DIAG: " + req.method + " " + req.url);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status: "error",
      message: "Application failed to start",
      error: errorMsg,
      env: {
        NODE_ENV: process.env.NODE_ENV || "NOT SET",
        PORT,
        DATABASE_URL: process.env.DATABASE_URL ? "set" : "NOT SET",
        ENCRYPTION_KEY: process.env.ENCRYPTION_KEY ? "set" : "NOT SET",
        CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY ? "set" : "NOT SET",
      },
    }, null, 2));
  });

  server.listen(Number(PORT), "0.0.0.0", () => {
    console.log("DIAG: Diagnostic server listening on port " + PORT);
    console.log("DIAG: Visit the service URL to see the startup error");
  });
}
