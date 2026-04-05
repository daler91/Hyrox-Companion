import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const PORT = 5111;
const BASE = `http://localhost:${PORT}`;
const DIST_INDEX = path.resolve(__dirname, "../../../dist/index.js");

// ── Lightweight cookie jar for native fetch ──────────────────────────

class CookieJar {
  private cookies = new Map<string, string>();

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

/** fetch that carries cookies automatically */
async function f(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      cookie: jar.header(),
      ...init?.headers,
    },
  });
  jar.update(res);
  return res;
}

/** Poll the health endpoint until the server reports ready. */
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

// ── Test suite ───────────────────────────────────────────────────────

describe("Production Smoke Test", { timeout: 90_000 }, () => {
  let server: ChildProcess;
  let csrfToken: string;

  beforeAll(async () => {
    expect(existsSync(DIST_INDEX), `Build artifact missing: ${DIST_INDEX}`).toBe(true);

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

    server.stderr?.on("data", (chunk: Buffer) => {
      process.stderr.write(`[smoke-server] ${chunk.toString()}`);
    });

    await waitForReady();

    // Obtain CSRF token (also seeds the CSRF cookie in the jar)
    const res = await f("/api/v1/csrf-token");
    csrfToken = ((await res.json()) as { csrfToken: string }).csrfToken;

    // Hit preferences to auto-create the dev-user row in the DB
    await f("/api/v1/preferences");
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

  // ── Health & Startup ──────────────────────────────────────────────

  describe("Health & Startup", () => {
    it("health endpoint returns ok", async () => {
      const res = await f("/api/v1/health");
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
      const res = await f("/");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");

      indexHtml = await res.text();
      expect(indexHtml).toContain('<div id="root">');
      expect(indexHtml).toContain("<script");
    });

    it("serves static JS assets with immutable cache headers", async () => {
      const match = indexHtml?.match(/\/assets\/[^"'\s]+\.js/);
      expect(match, "No /assets/*.js found in index.html").toBeTruthy();

      const res = await fetch(`${BASE}${match![0]}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("javascript");
      expect(res.headers.get("cache-control")).toContain("max-age");
    });

    it("serves static CSS assets", async () => {
      const match = indexHtml?.match(/\/assets\/[^"'\s]+\.css/);
      expect(match, "No /assets/*.css found in index.html").toBeTruthy();

      const res = await fetch(`${BASE}${match![0]}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("css");
    });
  });

  // ── Security Headers ──────────────────────────────────────────────

  describe("Security Headers", () => {
    it("X-Powered-By is absent", async () => {
      const res = await f("/");
      expect(res.headers.get("x-powered-by")).toBeNull();
    });

    it("Content-Security-Policy is present on HTML responses", async () => {
      const res = await f("/");
      const csp = res.headers.get("content-security-policy");
      expect(csp).toBeTruthy();
      expect(csp).toContain("default-src");
    });

    it("X-Content-Type-Options is nosniff", async () => {
      const res = await f("/");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    });
  });

  // ── CSRF Protection ───────────────────────────────────────────────

  describe("CSRF Protection", () => {
    it("CSRF token endpoint returns a token", async () => {
      const res = await f("/api/v1/csrf-token");
      expect(res.status).toBe(200);
      const body = (await res.json()) as { csrfToken: string };
      expect(body.csrfToken).toBeTruthy();
    });

    it("POST without CSRF token is rejected", async () => {
      const res = await f("/api/v1/workouts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ date: "2025-01-01", focus: "test", mainWorkout: "test" }),
      });
      expect(res.status).toBe(403);
    });

    it("POST with valid CSRF token succeeds (or returns validation error, not 403)", async () => {
      const res = await f("/api/v1/workouts", {
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
      const res = await f("/api/v1/auth/user");
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
      const res = await f("/api/v1/workouts", {
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
      const res = await f("/api/v1/workouts");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body.some((w: { id: string }) => w.id === workoutId)).toBe(true);
    });

    it("fetches the workout by id", async () => {
      const res = await f(`/api/v1/workouts/${workoutId}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.id).toBe(workoutId);
      expect(body.focus).toBe("Running");
    });

    it("updates the workout", async () => {
      const res = await f(`/api/v1/workouts/${workoutId}`, {
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
      const res = await f(`/api/v1/workouts/${workoutId}`, {
        method: "DELETE",
        headers: { "x-csrf-token": csrfToken },
      });
      expect(res.status).toBe(200);
    });

    it("returns 404 for deleted workout", async () => {
      const res = await f(`/api/v1/workouts/${workoutId}`);
      expect(res.status).toBe(404);
    });
  });

  // ── Plans & Analytics ─────────────────────────────────────────────

  describe("Plans & Analytics", () => {
    it("GET /api/v1/plans returns an array", async () => {
      const res = await f("/api/v1/plans");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
    });

    it("GET /api/v1/personal-records returns an object", async () => {
      const res = await f("/api/v1/personal-records");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(typeof body).toBe("object");
      expect(body).not.toBeNull();
    });

    it("GET /api/v1/exercise-analytics returns an object", async () => {
      const res = await f("/api/v1/exercise-analytics");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(typeof body).toBe("object");
    });

    it("GET /api/v1/training-overview returns overview data", async () => {
      const res = await f("/api/v1/training-overview");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty("weeklySummaries");
      expect(body).toHaveProperty("workoutDates");
      expect(body).toHaveProperty("categoryTotals");
      expect(body).toHaveProperty("stationCoverage");
    });

    it("GET /api/v1/timeline returns an array", async () => {
      const res = await f("/api/v1/timeline");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
    });
  });

  // ── Export ────────────────────────────────────────────────────────

  describe("Export", () => {
    it("GET /api/v1/export?format=json returns JSON", async () => {
      const res = await f("/api/v1/export?format=json");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("json");
      const body = await res.json();
      expect(body).toHaveProperty("exportedAt");
    });

    it("GET /api/v1/export?format=csv returns CSV text", async () => {
      const res = await f("/api/v1/export?format=csv");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("csv");
      const text = await res.text();
      expect(text).toContain("date");
    });
  });

  // ── Error Handling ────────────────────────────────────────────────

  describe("Error Handling", () => {
    it("unknown API route returns 404", async () => {
      const res = await f("/api/v1/nonexistent-route");
      expect(res.status).toBe(404);
    });

    it("invalid workout payload returns 400", async () => {
      const res = await f("/api/v1/workouts", {
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

  // ── Idempotency ───────────────────────────────────────────────────

  describe("Idempotency", () => {
    it("repeated POST with same idempotency key returns cached response", async () => {
      const idempotencyKey = randomUUID();
      const payload = {
        date: "2025-07-01",
        focus: "Rowing",
        mainWorkout: "2K row test",
      };

      const res1 = await f("/api/v1/workouts", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": csrfToken,
          "x-idempotency-key": idempotencyKey,
        },
        body: JSON.stringify(payload),
      });
      expect(res1.status).toBe(200);
      const body1 = await res1.json();

      const res2 = await f("/api/v1/workouts", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": csrfToken,
          "x-idempotency-key": idempotencyKey,
        },
        body: JSON.stringify(payload),
      });
      expect(res2.status).toBe(200);
      const body2 = await res2.json();

      // Same idempotency key should return the exact same workout id
      expect(body2.id).toBe(body1.id);

      // Clean up
      await f(`/api/v1/workouts/${body1.id}`, {
        method: "DELETE",
        headers: { "x-csrf-token": csrfToken },
      });
    });
  });

  // ── Strava ────────────────────────────────────────────────────────

  describe("Strava", () => {
    it("GET /api/v1/strava/status returns disconnected", async () => {
      const res = await f("/api/v1/strava/status");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty("connected", false);
    });
  });
});
