// Blocks until the server reports ready, so Cypress never opens against a
// process that is still booting.
//
// This deliberately polls the readiness probe rather than the port: the server
// binds :5000 well before it can serve traffic, and /api/v1/health answers 503
// while it is still starting or degraded (see server/bootstrap/health.ts). A
// 2xx is the only safe signal to proceed; a port check would hand Cypress a
// half-started server and produce flakes that look like test failures.
import process from "node:process";

const port = process.env.PORT ?? "5000";
const timeoutMs = Number(process.env.HEALTH_TIMEOUT_MS ?? 120_000);
const url = `http://localhost:${port}/api/v1/health`;
const deadline = Date.now() + timeoutMs;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

while (Date.now() < deadline) {
  try {
    const res = await fetch(url);
    if (res.ok) {
      console.log(`server is up (${url})`);
      process.exit(0);
    }
  } catch {
    // Connection refused: the process has not bound the port yet. Keep polling
    // until the deadline — this is the expected state for the first second or
    // two after the server starts.
  }
  await sleep(1000);
}

console.error(`::error::server did not become healthy within ${timeoutMs}ms`);
process.exit(1);
