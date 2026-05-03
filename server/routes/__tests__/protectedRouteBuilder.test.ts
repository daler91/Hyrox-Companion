import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { protectedDelete, protectedPost } from "../_helpers/protectedRouteBuilder";

vi.mock("../../routeGuards", () => ({
  protectedMutationGuards: [
    (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
    (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
  ],
}));

describe("protectedRouteBuilder", () => {
  it("applies middleware in canonical order", async () => {
    const app = express();
    const router = express.Router();
    const calls: string[] = [];

    const guardOne: express.RequestHandler = (_req, _res, next) => { calls.push("guard:auth"); next(); };
    const guardTwo: express.RequestHandler = (_req, _res, next) => { calls.push("guard:csrf"); next(); };

    const { __private__ } = await import("../_helpers/protectedRouteBuilder");
    const stack = __private__.buildProtectedStack({
      limiter: (_req, _res, next) => { calls.push("limiter"); next(); },
      middleware: [(_req, _res, next) => { calls.push("validation"); next(); }],
    }, async (_req, res) => {
      calls.push("handler");
      res.json({ ok: true });
    });

    const finalStack = [guardOne, guardTwo, ...stack];
    router.post("/probe", ...finalStack);

    app.use(router);
    await request(app).post("/probe").send({}).expect(200);

    expect(calls).toEqual(["guard:auth", "guard:csrf", "limiter", "validation", "handler"]);
  });

  it("supports delete with extra middleware", async () => {
    const app = express();
    const router = express.Router();
    const calls: string[] = [];

    protectedDelete(router, "/probe", {
      limiter: (_req, _res, next) => { calls.push("limiter"); next(); },
      middleware: [(_req, _res, next) => { calls.push("extra"); next(); }],
    }, async (_req, res) => {
      calls.push("handler");
      res.status(204).end();
    });

    app.use(router);
    await request(app).delete("/probe").expect(204);
    expect(calls).toEqual(["limiter", "extra", "handler"]);
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
});
