import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const PORT = 5111;
const BASE = `http://localhost:${PORT}`;
const DIST_INDEX = path.resolve(__dirname, "../../../dist/index.js");

/**
 * Poll the health endpoint until the server reports ready.
 * Retries every 500 ms for up to `maxMs` milliseconds.
 */
async function waitForReady(maxMs = 60_000): Promise<void> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/v1/health`);
      if (res.ok) {
        const body = (await res.json()) as { status: string };
        if (body.status === "ok") return;
      }
    } catch {
      // Server not up yet — retry
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Server did not become ready within ${maxMs} ms`);
}

describe("Production Smoke Test", { timeout: 90_000 }, () => {
  let server: ChildProcess;

  beforeAll(async () => {
    // 1. Verify build artifact exists
    expect(existsSync(DIST_INDEX), `Build artifact missing: ${DIST_INDEX}`).toBe(true);

    // 2. Spawn the production server as a child process
    server = spawn("node", [DIST_INDEX], {
      env: {
        ...process.env,
        NODE_ENV: "test",
        PORT: String(PORT),
        ALLOW_DEV_AUTH_BYPASS: "true",
        DATABASE_URL: process.env.DATABASE_URL,
        ENCRYPTION_KEY: "01234567890123456789012345678901",
        SESSION_SECRET: "dummy_session_secret_for_smoke_test",
      },
      stdio: "pipe",
    });

    // Surface child stderr/stdout for debugging on failure
    server.stderr?.on("data", (chunk: Buffer) => {
      process.stderr.write(`[smoke-server] ${chunk.toString()}`);
    });

    // 3. Wait for the health endpoint to report ready
    await waitForReady();
  });

  afterAll(async () => {
    if (!server || server.exitCode !== null) return;

    const exited = new Promise<number | null>((resolve) => {
      server.once("exit", (code) => resolve(code));
    });

    server.kill("SIGTERM");

    const timeout = new Promise<"timeout">((resolve) =>
      setTimeout(() => resolve("timeout"), 10_000),
    );

    const result = await Promise.race([exited, timeout]);

    if (result === "timeout") {
      server.kill("SIGKILL");
      throw new Error("Server did not shut down within 10 s after SIGTERM");
    }
  });

  // ── Health ──────────────────────────────────────────────────────────

  it("health endpoint returns ok", async () => {
    const res = await fetch(`${BASE}/api/v1/health`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { status: string; timestamp: number };
    expect(body.status).toBe("ok");
    expect(typeof body.timestamp).toBe("number");
  });

  // ── Frontend serving ────────────────────────────────────────────────

  let indexHtml: string;

  it("serves the frontend at /", async () => {
    const res = await fetch(BASE);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");

    indexHtml = await res.text();
    expect(indexHtml).toContain('<div id="root">');
    expect(indexHtml).toContain("<script");
  });

  it("serves static JS assets with cache headers", async () => {
    // Extract the first /assets/*.js reference from the HTML
    const match = indexHtml?.match(/\/assets\/[^"'\s]+\.js/);
    expect(match, "No /assets/*.js found in index.html").toBeTruthy();

    const assetUrl = `${BASE}${match![0]}`;
    const res = await fetch(assetUrl);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("javascript");
    expect(res.headers.get("cache-control")).toContain("max-age");
  });

  // ── API endpoints ──────────────────────────────────────────────────

  it("CSRF token endpoint responds", async () => {
    const res = await fetch(`${BASE}/api/v1/csrf-token`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { csrfToken: string };
    expect(body.csrfToken).toBeTruthy();
  });

  it("plans endpoint responds with an array", async () => {
    // First hit preferences to auto-create the dev user
    await fetch(`${BASE}/api/v1/preferences`, {
      headers: { cookie: "" },
    });

    const res = await fetch(`${BASE}/api/v1/plans`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });
});
