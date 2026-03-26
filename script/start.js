// Startup wrapper — captures crashes that happen before the app's logger initializes.

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
