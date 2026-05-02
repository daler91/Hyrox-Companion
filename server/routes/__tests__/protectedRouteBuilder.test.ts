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

    protectedPost(router, "/probe", {
      limiter: (_req, _res, next) => { calls.push("limiter"); next(); },
      middleware: [
        (_req, _res, next) => { calls.push("validation"); next(); },
      ],
    }, async (_req, res) => {
      calls.push("handler");
      res.json({ ok: true });
    });

    app.use(router);
    await request(app).post("/probe").send({}).expect(200);

    expect(calls).toEqual(["limiter", "validation", "handler"]);
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
});
