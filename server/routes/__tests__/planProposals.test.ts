import type { PlanAdjustmentProposal } from "@shared/schema";
import type express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { clearRateLimitBuckets } from "../../routeUtils";
import { storage } from "../../storage";
import planProposalRouter from "../planProposals";
import { createTestApp } from "./testUtils";

vi.mock("../../clerkAuth", async () => (await import("./testUtils")).mockClerkAuthModule());
vi.mock("../../types", async () => (await import("./testUtils")).mockTypesModule());
vi.mock("../../storage", async () =>
  (await import("./testUtils")).mockStorageModule({
    planProposals: ["getPending", "getById"],
    users: ["getUser"],
  }),
);
vi.mock("../../services/planAdjustmentService", () => ({
  applyPlanAdjustmentProposal: vi.fn(),
  dismissPlanAdjustmentProposal: vi.fn(),
}));

const PROPOSAL = {
  id: "proposal-1",
  userId: "test_user_id",
  planId: "plan-1",
  status: "dismissed",
  summaryMessage: "Moved your long run to Saturday.",
  userRequest: "move my long run",
  payload: { changes: [] },
  aiSource: null,
  createdAt: new Date("2026-10-01T10:00:00Z"),
  resolvedAt: new Date("2026-10-01T10:05:00Z"),
} as PlanAdjustmentProposal;

describe("GET /api/v1/plan-proposals/:id", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    clearRateLimitBuckets();
    app = createTestApp(planProposalRouter);
  });

  it("returns one of the athlete's proposals with its current status", async () => {
    vi.mocked(storage.planProposals.getById).mockResolvedValue(PROPOSAL);

    const response = await request(app).get("/api/v1/plan-proposals/proposal-1");

    expect(response.status).toBe(200);
    expect(storage.planProposals.getById).toHaveBeenCalledWith("proposal-1", "test_user_id");
    expect(response.body.proposal).toEqual({
      id: "proposal-1",
      planId: "plan-1",
      status: "dismissed",
      summaryMessage: "Moved your long run to Saturday.",
      changes: [],
      createdAt: "2026-10-01T10:00:00.000Z",
    });
  });

  it("is a 404 for a proposal that isn't the athlete's", async () => {
    vi.mocked(storage.planProposals.getById).mockResolvedValue(undefined);

    const response = await request(app).get("/api/v1/plan-proposals/someone-elses");

    expect(response.status).toBe(404);
  });

  it("still serves the pending proposal from its own route", async () => {
    vi.mocked(storage.planProposals.getPending).mockResolvedValue(undefined);

    const response = await request(app).get("/api/v1/plan-proposals/pending");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ proposal: null });
    expect(storage.planProposals.getById).not.toHaveBeenCalled();
  });
});
