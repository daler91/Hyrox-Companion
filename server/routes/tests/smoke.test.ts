import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";


const PORT = 5111;
const BASE = `http://localhost:${PORT}`;
const DIST_INDEX = path.resolve(__dirname, "../../../dist/index.js");

// ── Lightweight cookie jar for native fetch ──────────────────────────

class CookieJar {
  private readonly cookies = new Map<string, string>();

  update(res: Response): void {
    const raw = res.headers.getSetCookie?.() ?? [];
    for (const header of raw) {
      const [pair] = header.split(";");
      const eqIdx = pair.indexOf("=");
      if (eqIdx > 0) {
        this.cookies.set(pair.slice(0, eqIdx).trim(), pair.slice(eqIdx + 1).trim());
      }
    }
  }

  header(): string {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

const jar = new CookieJar();

/** fetch wrapper that carries cookies automatically */
async function request(urlPath: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${BASE}${urlPath}`, {
    ...init,
    headers: {
      cookie: jar.header(),
      ...init?.headers,
    },
  });
  jar.update(res);
  return res;
}

/** Single health-check attempt. Returns "ok", a status string, or null if unreachable. */
async function checkHealth(): Promise<{ ready: boolean; status: string }> {
  const res = await fetch(`${BASE}/api/v1/health`);
  const body = (await res.json()) as { status: string; error?: string };
  const errorSuffix = body.error ? " (" + body.error + ")" : "";
  const status = `${res.status} ${body.status}${errorSuffix}`;
  return { ready: res.ok && body.status === "ok", status };
}

/** Poll the health endpoint until the server reports ready. */
async function waitForReady(child: ChildProcess, maxMs = 60_000): Promise<void> {
  const deadline = Date.now() + maxMs;
  let lastStatus = "unreachable";

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Server process exited with code ${child.exitCode} before becoming ready (last status: ${lastStatus})`);
    }

    try {
      const result = await checkHealth();
      lastStatus = result.status;
      if (result.ready) return;
    } catch {
      lastStatus = "unreachable";
    }

    await new Promise((r) => setTimeout(r, 500));
  }

  throw new Error(`Server did not become ready within ${maxMs} ms (last status: ${lastStatus})`);
}

// ── Test suite ───────────────────────────────────────────────────────

describe("Production Smoke Test", { timeout: 90_000 }, () => {
  let server: ChildProcess;
  let csrfToken: string;

  beforeAll(async () => {
    expect(existsSync(DIST_INDEX), `Build artifact missing: ${DIST_INDEX}`).toBe(true);

    const safeEnv = { // NOSONAR — inherit env and override for test isolation
      ...process.env,
      NODE_ENV: "test",
      PORT: String(PORT),
      ALLOW_DEV_AUTH_BYPASS: "true",
    };

    server = spawn(process.execPath, [DIST_INDEX], {
      env: safeEnv,
      stdio: "pipe",
    });

    server.stdout?.on("data", (chunk: Buffer) => {
      process.stdout.write(`[smoke-server] ${chunk.toString()}`);
    });
    server.stderr?.on("data", (chunk: Buffer) => {
      process.stderr.write(`[smoke-server] ${chunk.toString()}`);
    });

    await waitForReady(server);

    // Obtain CSRF token (also seeds the CSRF cookie in the jar)
    const res = await request("/api/v1/csrf-token");
    csrfToken = ((await res.json()) as { csrfToken: string }).csrfToken;

    // Hit preferences to auto-create the dev-user row in the DB
    await request("/api/v1/preferences");
  });

  afterAll(async () => {
    if (server?.exitCode !== null) return;

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

  // ── Health & Startup ──────────────────────────────────────────────

  describe("Health & Startup", () => {
    it("health endpoint returns ok", async () => {
      const res = await request("/api/v1/health");
      expect(res.status).toBe(200);
      const body = (await res.json()) as { status: string; timestamp: number };
      expect(body.status).toBe("ok");
      expect(typeof body.timestamp).toBe("number");
    });
  });

  // ── Frontend Serving ──────────────────────────────────────────────

  describe("Frontend Serving", () => {
    let indexHtml: string;

    it("serves the frontend at /", async () => {
      const res = await request("/");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");

      indexHtml = await res.text();
      expect(indexHtml).toContain('<div id="root">');
      expect(indexHtml).toContain("<script");
    });

    it("serves static JS assets with immutable cache headers", async () => {
      const match = /\/assets\/[^"'\s]+\.js/.exec(indexHtml ?? "");
      expect(match, "No /assets/*.js found in index.html").toBeTruthy();

      const res = await fetch(`${BASE}${match![0]}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("javascript");
      expect(res.headers.get("cache-control")).toContain("max-age");
    });

    it("serves static CSS assets", async () => {
      const match = /\/assets\/[^"'\s]+\.css/.exec(indexHtml ?? "");
      expect(match, "No /assets/*.css found in index.html").toBeTruthy();

      const res = await fetch(`${BASE}${match![0]}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("css");
    });
  });

  // ── Security Headers ──────────────────────────────────────────────

  describe("Security Headers", () => {
    it("X-Powered-By is absent", async () => {
      const res = await request("/");
      expect(res.headers.get("x-powered-by")).toBeNull();
    });

    it("Content-Security-Policy is present on HTML responses", async () => {
      const res = await request("/");
      const csp = res.headers.get("content-security-policy");
      expect(csp).toBeTruthy();
      expect(csp).toContain("default-src");
    });

    it("X-Content-Type-Options is nosniff", async () => {
      const res = await request("/");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    });
  });

  // ── CSRF Protection ───────────────────────────────────────────────

  describe("CSRF Protection", () => {
    it("CSRF token endpoint returns a token", async () => {
      const res = await request("/api/v1/csrf-token");
      expect(res.status).toBe(200);
      const body = (await res.json()) as { csrfToken: string };
      expect(body.csrfToken).toBeTruthy();
    });

    it("POST without CSRF token is rejected", async () => {
      const res = await request("/api/v1/workouts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ date: "2025-01-01", focus: "test", mainWorkout: "test" }),
      });
      expect(res.status).toBe(403);
    });

    it("POST with valid CSRF token succeeds (or returns validation error, not 403)", async () => {
      const res = await request("/api/v1/workouts", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify({}), // intentionally empty to test CSRF passes
      });
      // Should NOT be 403 (CSRF rejection). 400 (validation) is expected for empty body.
      expect(res.status).not.toBe(403);
    });
  });

  // ── Authentication ────────────────────────────────────────────────

  describe("Authentication", () => {
    it("GET /api/v1/auth/user returns dev user info", async () => {
      const res = await request("/api/v1/auth/user");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty("id");
      expect(body).toHaveProperty("email");
    });
  });

  // ── Workout CRUD Lifecycle ────────────────────────────────────────

  describe("Workout CRUD Lifecycle", () => {
    let workoutId: string;

    it("creates a workout", async () => {
      const res = await request("/api/v1/workouts", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify({
          date: "2025-06-15",
          focus: "Running",
          mainWorkout: "5K steady run",
          notes: "Smoke test workout",
          duration: 30,
          rpe: 6,
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty("id");
      workoutId = body.id;
    });

    it("lists workouts including the created one", async () => {
      const res = await request("/api/v1/workouts");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body.some((w: { id: string }) => w.id === workoutId)).toBe(true);
    });

    it("fetches the workout by id", async () => {
      const res = await request(`/api/v1/workouts/${workoutId}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.id).toBe(workoutId);
      expect(body.focus).toBe("Running");
    });

    it("updates the workout", async () => {
      const res = await request(`/api/v1/workouts/${workoutId}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify({ notes: "Updated by smoke test" }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.notes).toBe("Updated by smoke test");
    });

    it("deletes the workout", async () => {
      const res = await request(`/api/v1/workouts/${workoutId}`, {
        method: "DELETE",
        headers: { "x-csrf-token": csrfToken },
      });
      expect(res.status).toBe(200);
    });

    it("returns 404 for deleted workout", async () => {
      const res = await request(`/api/v1/workouts/${workoutId}`);
      expect(res.status).toBe(404);
    });
  });

  // ── Plans & Analytics ─────────────────────────────────────────────

  describe("Plans & Analytics", () => {
    it("GET /api/v1/plans returns an array", async () => {
      const res = await request("/api/v1/plans");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
    });

    it("GET /api/v1/personal-records returns an object", async () => {
      const res = await request("/api/v1/personal-records");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(typeof body).toBe("object");
      expect(body).not.toBeNull();
    });

    it("GET /api/v1/exercise-analytics returns an object", async () => {
      const res = await request("/api/v1/exercise-analytics");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(typeof body).toBe("object");
    });

    it("GET /api/v1/training-overview returns overview data", async () => {
      const res = await request("/api/v1/training-overview");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty("weeklySummaries");
      expect(body).toHaveProperty("workoutDates");
      expect(body).toHaveProperty("categoryTotals");
      expect(body).toHaveProperty("stationCoverage");
    });

    it("GET /api/v1/timeline returns an array", async () => {
      const res = await request("/api/v1/timeline");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
    });
  });

  // ── Export ────────────────────────────────────────────────────────

  describe("Export", () => {
    it("GET /api/v1/export?format=json returns JSON", async () => {
      const res = await request("/api/v1/export?format=json");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("json");
      const body = await res.json();
      expect(body).toHaveProperty("exportedAt");
    });

    it("GET /api/v1/export?format=csv returns CSV text", async () => {
      const res = await request("/api/v1/export?format=csv");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("csv");
      const text = await res.text();
      expect(text).toContain("Date");
    });
  });

  // ── Error Handling ────────────────────────────────────────────────

  describe("Error Handling", () => {
    it("unknown route falls through to SPA", async () => {
      const res = await request("/api/v1/nonexistent-route");
      // SPA catch-all serves index.html for unmatched routes
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");
    });

    it("invalid workout payload returns 400", async () => {
      const res = await request("/api/v1/workouts", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify({ date: "not-a-date" }),
      });
      expect(res.status).toBe(400);
    });
  });

  // ── Strava ────────────────────────────────────────────────────────

  describe("Strava", () => {
    it("GET /api/v1/strava/status returns disconnected", async () => {
      const res = await request("/api/v1/strava/status");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty("connected", false);
    });
  });
});
