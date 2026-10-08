import { Router } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { AppError, ErrorCode } from "../../errors";
import { asyncHandler } from "../../routeUtils";
import { createTestApp } from "./testUtils";

vi.mock("@sentry/node", () => ({ captureException: vi.fn() }));
vi.mock("../../logger", () => {
  const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
  return { logger, reqLogger: () => logger };
});

/**
 * Route tests run with the production error handler, so the replies they
 * assert are the replies athletes get. A10 (CODEBASE_ANALYSIS_2026-10-03)
 */
function appThrowing(err: Error) {
  const router = Router();
  router.post(
    "/boom",
    asyncHandler(() => Promise.reject(err)),
  );
  return createTestApp(router);
}

describe("createTestApp error handling (A10)", () => {
  it("passes a 4xx AppError's message and details through to the client", async () => {
    const app = appThrowing(
      new AppError(ErrorCode.CONFLICT, "This food is used in a recipe", 409, { recipeIds: ["r1"] }),
    );

    const response = await request(app).post("/boom").send({});

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: "This food is used in a recipe",
      code: ErrorCode.CONFLICT,
      details: { recipeIds: ["r1"] },
    });
  });

  it("hides a 500's message", async () => {
    const app = appThrowing(new Error("connection string leaked here"));

    const response = await request(app).post("/boom").send({});

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: "Internal Server Error", code: ErrorCode.INTERNAL_SERVER_ERROR });
  });

  it("rewrites body-parser's 413 into the actionable message", async () => {
    const app = appThrowing(new Error("unreachable"));

    const response = await request(app)
      .post("/boom")
      .send({ blob: "x".repeat(200 * 1024) });

    expect(response.status).toBe(413);
    expect(response.body).toEqual({
      error: "Request body too large for this endpoint — try a smaller payload or split the upload.",
      code: ErrorCode.PAYLOAD_TOO_LARGE,
    });
  });
});
