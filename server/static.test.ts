import path from "node:path";

import express from "express";
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";

import { clearRateLimitBuckets } from "./routeUtils";
import { serveStatic } from "./static";

/** A built client in miniature: the shell plus one hashed asset. */
const FIXTURE_DIST = path.resolve(__dirname, "__fixtures__", "spa-shell");
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
    serveStatic(app, FIXTURE_DIST);
  });

  it("serves the SPA shell, with the nonce, for a client-side route", async () => {
    const res = await request(app).get("/timeline");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.text).toContain('<script nonce="test-nonce" type="module"');
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
