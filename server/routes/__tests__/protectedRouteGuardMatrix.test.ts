import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { protectedDelete, protectedPost } from "../_helpers/protectedRouteBuilder";

vi.mock("../../routeGuards", () => ({
  protectedMutationGuards: [
    (_req: express.Request, res: express.Response, next: express.NextFunction) => {
      (res.locals.calls as string[]).push("guard:auth");
      next();
    },
    (_req: express.Request, res: express.Response, next: express.NextFunction) => {
      (res.locals.calls as string[]).push("guard:idempotency");
      next();
    },
  ],
}));

describe("protected routes guard order matrix", () => {
  const matrix = [
    {
      name: "email check protected post",
      register: (router: express.Router) => protectedPost(router, "/emails/check", {
        limiter: (_req, res, next) => { (res.locals.calls as string[]).push("limiter"); next(); },
      }, async (_req, res) => {
        (res.locals.calls as string[]).push("handler");
        res.status(200).json({ ok: true });
      }),
      method: "post" as const,
      path: "/emails/check",
      expectedStatus: 200,
      expectedCalls: ["guard:auth", "guard:idempotency", "limiter", "handler"],
    },
    {
      name: "account delete protected delete",
      register: (router: express.Router) => protectedDelete(router, "/account", {
        limiter: (_req, res, next) => { (res.locals.calls as string[]).push("limiter"); next(); },
      }, async (_req, res) => {
        (res.locals.calls as string[]).push("handler");
        res.status(200).json({ ok: true });
      }),
      method: "delete" as const,
      path: "/account",
      expectedStatus: 200,
      expectedCalls: ["guard:auth", "guard:idempotency", "limiter", "handler"],
    },
  ];

  for (const entry of matrix) {
    it(`enforces canonical middleware sequence for ${entry.name}`, async () => {
      const app = express();
      const router = express.Router();
      const calls: string[] = [];

      app.use((_req, res, next) => {
        res.locals.calls = calls;
        next();
      });

      entry.register(router);
      app.use(router);

      const response = entry.method === "post"
        ? request(app).post(entry.path).send({})
        : request(app).delete(entry.path);

      await response.expect(entry.expectedStatus);
      expect(calls).toEqual(entry.expectedCalls);
    });
  }

  it("stops downstream middleware after rejection and preserves payload", async () => {
    const app = express();
    const router = express.Router();
    const calls: string[] = [];

    app.use((_req, res, next) => {
      res.locals.calls = calls;
      next();
    });

    protectedPost(router, "/workouts", {
      limiter: (_req, res, next) => { (res.locals.calls as string[]).push("limiter"); next(); },
      validation: [(_req, res) => {
        (res.locals.calls as string[]).push("validation-reject");
        res.status(400).json({ error: "Invalid payload", code: "VALIDATION_ERROR" });
      }],
      middleware: [(_req, res, next) => { (res.locals.calls as string[]).push("custom"); next(); }],
    }, async (_req, res) => {
      (res.locals.calls as string[]).push("handler");
      res.status(200).json({ ok: true });
    });

    app.use(router);

    const response = await request(app).post("/workouts").send({}).expect(400);
    expect(response.body).toEqual({ error: "Invalid payload", code: "VALIDATION_ERROR" });
    expect(calls).toEqual(["guard:auth", "guard:idempotency", "limiter", "validation-reject"]);
  });
});
