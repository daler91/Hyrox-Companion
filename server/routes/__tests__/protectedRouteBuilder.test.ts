import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { protectedDelete, protectedPost } from "../_helpers/protectedRouteBuilder";

vi.mock("../../routeGuards", () => ({
  protectedMutationGuards: [
    (_req: express.Request, _res: express.Response, next: express.NextFunction) => {
if (Array.isArray(_res.locals.calls)) (_res.locals.calls as string[]).push("guard:auth");
      next();
    },
    (_req: express.Request, _res: express.Response, next: express.NextFunction) => {
if (Array.isArray(_res.locals.calls)) (_res.locals.calls as string[]).push("guard:idempotency");
      next();
    },
  ],
}));

vi.mock("../../middleware/aiConsent", () => ({
  aiConsentCheck: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));

vi.mock("../../middleware/aibudget", () => ({
  aiBudgetCheck: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));

describe("protectedRouteBuilder", () => {
  it("applies middleware in canonical order", async () => {
    const app = express();
    const router = express.Router();
    const calls: string[] = [];

    app.use((_req, res, next) => {
      res.locals.calls = calls;
      next();
    });

    protectedPost(router, "/probe", {
      limiter: (_req, res, next) => { (res.locals.calls as string[]).push("limiter"); next(); },
      middleware: [(_req, res, next) => { (res.locals.calls as string[]).push("validation"); next(); }],
    }, async (_req, res) => {
      (res.locals.calls as string[]).push("handler");
      res.json({ ok: true });
    });

    app.use(router);
    await request(app).post("/probe").send({}).expect(200);

    expect(calls).toEqual(["guard:auth", "guard:idempotency", "limiter", "validation", "handler"]);
  });

  it("supports delete with extra middleware", async () => {
    const app = express();
    const router = express.Router();
    const calls: string[] = [];

    app.use((_req, res, next) => {
      res.locals.calls = calls;
      next();
    });

    protectedDelete(router, "/probe", {
      limiter: (_req, res, next) => { (res.locals.calls as string[]).push("limiter"); next(); },
      middleware: [(_req, res, next) => { (res.locals.calls as string[]).push("extra"); next(); }],
    }, async (_req, res) => {
      (res.locals.calls as string[]).push("handler");
      res.status(204).end();
    });

    app.use(router);
    await request(app).delete("/probe").expect(204);
    expect(calls).toEqual(["guard:auth", "guard:idempotency", "limiter", "extra", "handler"]);
  });

  it("passes through validation-style errors with standard shape", async () => {
    const app = express();
    app.use(express.json());
    const router = express.Router();

    protectedPost(router, "/probe", {
      limiter: (_req, _res, next) => next(),
      middleware: [(_req, res) => {
        res.status(400).json({
          error: "Invalid payload",
          code: "VALIDATION_ERROR",
          details: { issues: [{ path: "body.field", message: "Required" }] },
        });
      }],
    }, async (_req, res) => {
      res.json({ ok: true });
    });

    app.use(router);

    const response = await request(app).post("/probe").send({}).expect(400);
    expect(response.body).toEqual({
      error: "Invalid payload",
      code: "VALIDATION_ERROR",
      details: { issues: [{ path: "body.field", message: "Required" }] },
    });
  });

  it("supports auth/rate/ai/validation/custom middleware composition", async () => {
    const app = express();
    const router = express.Router();
    const calls: string[] = [];

    protectedPost(router, "/probe", {
      limiter: (_req, _res, next) => { calls.push("limiter"); next(); },
      aiConsent: true,
      aiBudget: true,
      validation: [(_req, _res, next) => { calls.push("validation"); next(); }],
      middleware: [(_req, _res, next) => { calls.push("custom"); next(); }],
    }, async (_req, res) => {
      calls.push("handler");
      res.json({ ok: true });
    });

    app.use(router);
    await request(app).post("/probe").send({}).expect(200);

    expect(calls).toEqual(["limiter", "validation", "custom", "handler"]);
  });

  it("allows opting out of auth and rate limiting", async () => {
    const app = express();
    const router = express.Router();

    protectedPost(router, "/probe", {
      auth: false,
      rateLimit: false,
    }, async (_req, res) => {
      res.json({ ok: true });
    });

    app.use(router);
    await request(app).post("/probe").send({}).expect(200);
  });

  it("rejects AI middleware when auth is disabled", () => {
    const app = express();
    const router = express.Router();

    expect(() => {
      protectedPost(router, "/probe", {
        auth: false,
        rateLimit: false,
        aiBudget: true,
      } as unknown as Parameters<typeof protectedPost>[2], async (_req, res) => {
        res.json({ ok: true });
      });
    }).toThrowError("AI guard middleware requires auth to be enabled");

    app.use(router);
  });
});
