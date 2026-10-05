import { createServer } from "node:http";

import express from "express";
import request from "supertest";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { setupVite } from "./vite";

// A stand-in for Vite's dev middleware: it handles nothing, so every request
// falls through to the routes setupVite mounts after it, as an unmatched API
// path does in the real dev server.
const { passThrough, transformIndexHtml } = vi.hoisted(() => ({
  passThrough: (_req: unknown, _res: unknown, next: () => void) => {
    next();
  },
  transformIndexHtml: (_url: string, template: string) => Promise.resolve(template),
}));

vi.mock("vite", () => ({
  createLogger: () => ({ error: vi.fn() }),
  createServer: () =>
    Promise.resolve({
      middlewares: passThrough,
      transformIndexHtml,
      ssrFixStacktrace: vi.fn(),
    }),
}));

vi.mock("../vite.config", () => ({ default: {} }));

const UNMATCHED_API_PATH = "/api/v1/workouts-renamed/abc";

describe("setupVite", () => {
  let app: express.Express;

  beforeAll(async () => {
    app = express();
    app.get("/api/v1/workouts", (_req, res) => {
      res.json([]);
    });
    await setupVite(createServer(), app);
  });

  it("serves the SPA shell for a client-side route", async () => {
    const res = await request(app).get("/timeline");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
  });

  it("still reaches a real API route", async () => {
    const res = await request(app).get("/api/v1/workouts");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  // C38 (CODEBASE_ANALYSIS_2026-10-03): the dev catch-all answered these with
  // index.html and a 200, unlike serveStatic in production.
  it.each([
    ["GET", () => request(app).get(UNMATCHED_API_PATH)],
    ["POST", () => request(app).post(UNMATCHED_API_PATH)],
  ])("answers an unmatched /api %s with the production JSON 404", async (_method, send) => {
    const res = await send();

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "API route not found", code: "NOT_FOUND" });
  });
});
