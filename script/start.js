// Startup wrapper — captures crashes that happen before the app's logger initializes.
// This script runs as ESM (package.json "type": "module") and dynamically imports
// the main server bundle, catching any errors that would otherwise be silently swallowed.

console.log(JSON.stringify({
  level: "info",
  msg: "Container starting — loading application...",
  pid: process.pid,
  node: process.version,
  cwd: process.cwd(),
  timestamp: new Date().toISOString(),
}));

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
  console.error("FATAL: Failed to start application:");
  console.error(err);
  process.exit(1);
}
