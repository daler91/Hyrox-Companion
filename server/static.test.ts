import express from "express";
import request from "supertest";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { clearRateLimitBuckets } from "./routeUtils";
import { serveStatic } from "./static";

// serveStatic serves the `public` directory beside its own module (dist/public
// in the bundle). Here that module reads as living in the fixture directory, so
// the production path resolution runs unchanged against a built client in
// miniature: the shell plus one hashed asset.
vi.mock("node:url", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:url")>();
  const path = await import("node:path");
  const fixtureModule = path.resolve(__dirname, "__fixtures__", "spa-shell", "static.ts");
  const fileURLToPath = (url: string | URL): string =>
    String(url).endsWith("/server/static.ts") ? fixtureModule : actual.fileURLToPath(url);
  // Named imports of a built-in can resolve through its default export.
  return { ...actual, default: { ...actual, fileURLToPath }, fileURLToPath };
});

const UNMATCHED_API_PATH = "/api/v1/workouts-renamed/abc";

describe("serveStatic", () => {
  let app: express.Express;

  beforeAll(() => {
    clearRateLimitBuckets();
    app = express();
    app.use((_req, res, next) => {
      res.locals.cspNonce = "test-nonce";
      next();
    });
    app.get("/api/v1/workouts", (_req, res) => {
      res.json([]);
    });
    serveStatic(app);
  });

  it("serves the SPA shell, with the nonce, for a client-side route", async () => {
    const res = await request(app).get("/timeline");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.text).toMatch(/<script nonce="test-nonce" type="module"/u);
  });

  it("serves a built asset that exists", async () => {
    const res = await request(app).get("/assets/index-abc123.css");

    expect(res.status).toBe(200);
    expect(res.text).toContain("margin: 0");
  });

  it("still reaches a real API route", async () => {
    const res = await request(app).get("/api/v1/workouts");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  // C38 (CODEBASE_ANALYSIS_2026-10-03): these got index.html with a 200, and
  // the offline queue reads any 2xx as synced.
  it.each([
    ["GET", () => request(app).get(UNMATCHED_API_PATH)],
    ["POST", () => request(app).post(UNMATCHED_API_PATH)],
    ["PATCH", () => request(app).patch(UNMATCHED_API_PATH)],
    ["DELETE", () => request(app).delete(UNMATCHED_API_PATH)],
  ])("answers an unmatched /api %s with a JSON 404, never the shell", async (_method, send) => {
    const res = await send();

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "API route not found", code: "NOT_FOUND" });
  });

  it("answers a bare /api with a JSON 404", async () => {
    const res = await request(app).get("/api");

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: "NOT_FOUND" });
  });

  it("answers a missing chunk with a 404, never the shell", async () => {
    const res = await request(app).get("/assets/index-oldhash.js");

    expect(res.status).toBe(404);
    expect(res.headers["content-type"]).not.toContain("text/html");
    expect(res.text).not.toContain("<!doctype html>");
  });

  it("does not treat a path that only starts with the letters 'api' as an API path", async () => {
    const res = await request(app).get("/apiary");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
  });
});
