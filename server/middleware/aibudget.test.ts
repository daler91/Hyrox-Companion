import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { env } from "../env";
import { checkAiBudget, DAILY_LIMIT_CENTS } from "../services/aiUsageService";
import { aiBudgetCheck } from "./aibudget";

vi.mock("../logger", () => ({
  logger: { error: vi.fn() },
}));

vi.mock("../types", () => ({
  getUserId: () => "test-user-id",
}));

vi.mock("../services/aiUsageService", () => ({
  DAILY_LIMIT_CENTS: 200,
  checkAiBudget: vi.fn(),
}));

function createBudgetApp() {
  const app = express();
  app.use(aiBudgetCheck);
  app.use((_req, res) => {
    res.json({ ok: true });
  });
  return app;
}

describe("aiBudgetCheck", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    env.AI_FEATURES_ENABLED = "true";
  });

  it("returns 503 when AI features are disabled", async () => {
    env.AI_FEATURES_ENABLED = "false";

    const response = await request(createBudgetApp()).post("/probe");

    expect(response.status).toBe(503);
    expect(response.body.code).toBe("AI_FEATURES_DISABLED");
    expect(checkAiBudget).not.toHaveBeenCalled();
  });

  it("returns 429 when the user is over budget", async () => {
    vi.mocked(checkAiBudget).mockResolvedValue({
      allowed: false,
      warning: false,
      currentCostCents: DAILY_LIMIT_CENTS + 10,
      limitCents: DAILY_LIMIT_CENTS,
    });

    const response = await request(createBudgetApp()).post("/probe");

    expect(response.status).toBe(429);
    expect(response.body).toMatchObject({
      code: "AI_BUDGET_EXCEEDED",
      currentCostCents: DAILY_LIMIT_CENTS + 10,
      limitCents: DAILY_LIMIT_CENTS,
    });
  });

  it("allows requests and sets warning headers near the limit", async () => {
    vi.mocked(checkAiBudget).mockResolvedValue({
      allowed: true,
      warning: true,
      currentCostCents: DAILY_LIMIT_CENTS - 25,
      limitCents: DAILY_LIMIT_CENTS,
    });

    const response = await request(createBudgetApp()).post("/probe");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
    expect(response.headers["x-ai-budget-warning"]).toBe("true");
    expect(response.headers["x-ai-budget-remaining-cents"]).toBe("25");
  });

  it("allows requests with no warning when under budget", async () => {
    vi.mocked(checkAiBudget).mockResolvedValue({
      allowed: true,
      warning: false,
      currentCostCents: 20,
      limitCents: DAILY_LIMIT_CENTS,
    });

    const response = await request(createBudgetApp()).post("/probe");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
    expect(response.headers["x-ai-budget-warning"]).toBeUndefined();
  });

  it("fails closed when the budget check cannot verify spend", async () => {
    vi.mocked(checkAiBudget).mockRejectedValue(new Error("budget storage down"));

    const response = await request(createBudgetApp()).post("/probe");

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      error: "AI budget enforcement is temporarily unavailable.",
      code: "AI_BUDGET_UNAVAILABLE",
    });
  });
});
