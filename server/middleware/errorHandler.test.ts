import { randomBytes } from "node:crypto";

import cookieParser from "cookie-parser";
import { doubleCsrf } from "csrf-csrf";
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const captureExceptionMock = vi.hoisted(() => vi.fn());
vi.mock("@sentry/node", () => ({ captureException: captureExceptionMock }));

import { AppError, ErrorCode } from "../errors";
import { globalErrorHandler } from "./errorHandler";

/** What @google/genai throws for a non-2xx: an `ApiError` carrying the HTTP status and Google's raw JSON. */
function providerError(status: number): Error {
  const err = new Error(
    JSON.stringify({
      error: {
        code: status,
        message: "Resource has been exhausted (e.g. check quota).",
        status: "RESOURCE_EXHAUSTED",
      },
    }),
  );
  err.name = "ApiError";
  return Object.assign(err, { status });
}

function appThrowing(err: unknown): express.Express {
  const app = express();
  app.post("/boom", () => {
    throw err;
  });
  app.use(globalErrorHandler);
  return app;
}

describe("globalErrorHandler", () => {
  beforeEach(() => {
    captureExceptionMock.mockClear();
  });

  // C3 (CODEBASE_ANALYSIS_2026-10-03): a non-AppError's own status and message
  // were passed on, so a provider 429 read as the app's rate limit and a
  // rotated key's 401 looked like an expired session.
  it.each([400, 401, 403, 404, 429, 503])(
    "turns an uncaught provider %i into a generic 502",
    async (status) => {
      const res = await request(appThrowing(providerError(status))).post("/boom");

      expect(res.status).toBe(502);
      expect(res.body).toEqual({
        error: "A service we depend on failed. Please try again.",
        code: ErrorCode.EXTERNAL_API_ERROR,
      });
      expect(JSON.stringify(res.body)).not.toContain("RESOURCE_EXHAUSTED");
    },
  );

  it("reports an upstream failure to Sentry", async () => {
    const err = providerError(400);
    await request(appThrowing(err)).post("/boom");

    expect(captureExceptionMock).toHaveBeenCalledWith(err);
  });

  it("reads a status carried as statusCode the same way", async () => {
    const err = Object.assign(new Error("Strava said no"), { statusCode: 401 });
    const res = await request(appThrowing(err)).post("/boom");

    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ code: ErrorCode.EXTERNAL_API_ERROR });
  });

  it("hides an untyped error, and its foreign code, behind a generic 500", async () => {
    const pgError = Object.assign(
      new Error('duplicate key value violates unique constraint "users_pkey"'),
      { code: "23505" },
    );
    const res = await request(appThrowing(pgError)).post("/boom");

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      error: "Internal Server Error",
      code: ErrorCode.INTERNAL_SERVER_ERROR,
    });
  });

  it("passes an AppError's status, code, message and details through", async () => {
    const details = { issues: [{ path: "date", message: "Required" }] };
    const res = await request(
      appThrowing(new AppError(ErrorCode.NOT_FOUND, "Workout not found", 404, details)),
    ).post("/boom");

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Workout not found", code: ErrorCode.NOT_FOUND, details });
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it("keeps an AppError's own 429 and 503", async () => {
    const quota = await request(
      appThrowing(new AppError(ErrorCode.AI_BUDGET_EXCEEDED, "Daily AI limit reached", 429)),
    ).post("/boom");
    const off = await request(
      appThrowing(new AppError(ErrorCode.AI_FEATURES_DISABLED, "AI is off", 503)),
    ).post("/boom");

    expect(quota.status).toBe(429);
    expect(quota.body).toMatchObject({ code: ErrorCode.AI_BUDGET_EXCEEDED });
    expect(off.status).toBe(503);
    expect(off.body).toEqual({ error: "AI is off", code: ErrorCode.AI_FEATURES_DISABLED });
  });

  it("hides an AppError's message at 500", async () => {
    const res = await request(
      appThrowing(new AppError(ErrorCode.INTERNAL_ERROR, "pool exhausted on db-3", 500)),
    ).post("/boom");

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Internal Server Error", code: ErrorCode.INTERNAL_ERROR });
  });

  it("hands an error after the response has started to Express's default handler", () => {
    // An SSE stream that fails mid-reply can't take a status or a JSON body.
    const status = vi.fn();
    const res = { headersSent: true, status } as unknown as express.Response;
    const next = vi.fn();
    const err = providerError(429);

    globalErrorHandler(err, {} as express.Request, res, next);

    expect(next).toHaveBeenCalledWith(err);
    expect(status).not.toHaveBeenCalled();
    // Still reported as the upstream failure it is; Express's own handler
    // would only report a 5xx carried on the error itself.
    expect(captureExceptionMock).toHaveBeenCalledWith(err);
  });

  describe("the app's own HTTP layer", () => {
    it("treats one of its own 5xx as an internal fault, not an upstream one", async () => {
      const err = Object.assign(new Error("stream encoding should not be set"), {
        status: 500,
        statusCode: 500,
        expose: false,
      });
      const res = await request(appThrowing(err)).post("/boom");

      expect(res.status).toBe(500);
      expect(res.body).toEqual({
        error: "Internal Server Error",
        code: ErrorCode.INTERNAL_SERVER_ERROR,
      });
    });

    function bodyParserApp(): express.Express {
      const app = express();
      app.use(express.json({ limit: "1kb" }));
      app.post("/echo", (req, res) => {
        res.json(req.body);
      });
      app.use(globalErrorHandler);
      return app;
    }

    it("keeps the router's 400 for a malformed percent-escape in a route param, unreported", async () => {
      // The router throws a URIError with status 400 (and no `expose`) at route
      // match, before auth or any limiter, so scanner traffic must not read as
      // an upstream 502 and fill Sentry.
      const app = express();
      app.get("/api/v1/workouts/:id", (req, res) => {
        res.json({ id: req.params.id });
      });
      app.use(globalErrorHandler);

      const res = await request(app).get("/api/v1/workouts/%E0%A4%A");

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "Malformed URL", code: ErrorCode.BAD_REQUEST });
      expect(captureExceptionMock).not.toHaveBeenCalled();
    });

    it("keeps body-parser's 400 for malformed JSON", async () => {
      const res = await request(bodyParserApp())
        .post("/echo")
        .set("Content-Type", "application/json")
        .send("{bad json");

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ code: ErrorCode.BAD_REQUEST });
    });

    it("keeps body-parser's 413, with the actionable message", async () => {
      const res = await request(bodyParserApp())
        .post("/echo")
        .set("Content-Type", "application/json")
        .send(JSON.stringify({ text: "x".repeat(2048) }));

      expect(res.status).toBe(413);
      expect(res.body).toMatchObject({ code: ErrorCode.PAYLOAD_TOO_LARGE });
    });

    it("keeps csrf-csrf's 403 EBADCSRFTOKEN", async () => {
      const csrfKey = randomBytes(32).toString("hex");
      const { doubleCsrfProtection } = doubleCsrf({
        getSecret: () => csrfKey,
        getSessionIdentifier: () => "session",
      });
      const app = express();
      app.use(cookieParser());
      app.use(doubleCsrfProtection);
      app.post("/write", (_req, res) => {
        res.json({ ok: true });
      });
      app.use(globalErrorHandler);

      const res = await request(app).post("/write");

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: "invalid csrf token", code: "EBADCSRFTOKEN" });
    });
  });
});
