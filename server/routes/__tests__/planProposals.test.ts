import type { PlanAdjustmentProposal } from "@shared/schema";
import type express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { clearRateLimitBuckets } from "../../routeUtils";
import { applyPlanAdjustmentProposal, undoPlanAdjustmentProposal } from "../../services/planAdjustmentService";
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
  undoPlanAdjustmentProposal: vi.fn(),
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
  applyUndo: null,
  revertedAt: null,
} as PlanAdjustmentProposal;

describe("GET /api/v1/plan-proposals/:id", () => {
  let app: express.Express;

  // Reset, not cleared: each test starts from storage that finds nothing.
  beforeEach(() => {
    vi.resetAllMocks();
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
    const response = await request(app).get("/api/v1/plan-proposals/someone-elses");

    expect(response.status).toBe(404);
    expect(storage.planProposals.getById).toHaveBeenCalledWith("someone-elses", "test_user_id");
  });

  it("still serves the pending proposal from its own route", async () => {
    const response = await request(app).get("/api/v1/plan-proposals/pending");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ proposal: null });
    expect(storage.planProposals.getPending).toHaveBeenCalledWith("test_user_id");
    expect(storage.planProposals.getById).not.toHaveBeenCalled();
  });
});

describe("serializing an applied proposal", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.resetAllMocks();
    clearRateLimitBuckets();
    app = createTestApp(planProposalRouter);
  });

  it("names the days it changed and whether it can still be undone", async () => {
    vi.mocked(storage.planProposals.getById).mockResolvedValue({
      ...PROPOSAL,
      status: "applied",
      payload: { changes: [{ planDayId: "day-1" }, { planDayId: "day-2" }] } as never,
      resolvedAt: new Date(),
      applyUndo: { days: [{ planDayId: "day-2" }] } as never,
    });

    const response = await request(app).get("/api/v1/plan-proposals/proposal-1");

    expect(response.body).toMatchObject({ proposal: { appliedPlanDayIds: ["day-2"], undoable: true } });
  });

  it("says an apply from before undo existed can't be undone", async () => {
    vi.mocked(storage.planProposals.getById).mockResolvedValue({
      ...PROPOSAL,
      status: "applied",
      payload: { changes: [{ planDayId: "day-1" }] } as never,
    });

    const response = await request(app).get("/api/v1/plan-proposals/proposal-1");

    expect(response.body).toMatchObject({ proposal: { appliedPlanDayIds: ["day-1"], undoable: false } });
  });
});

describe("POST /api/v1/plan-proposals/:id/apply", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.resetAllMocks();
    clearRateLimitBuckets();
    app = createTestApp(planProposalRouter);
    vi.mocked(storage.users.getUser).mockResolvedValue({ aiCoachEnabled: true } as never);
  });

  it("applies the days the athlete picked", async () => {
    vi.mocked(applyPlanAdjustmentProposal).mockResolvedValue({ applied: true, changeCount: 1 });

    const response = await request(app).post("/api/v1/plan-proposals/proposal-1/apply").send({ planDayIds: ["day-2"] });

    expect(response.status).toBe(200);
    expect(applyPlanAdjustmentProposal).toHaveBeenCalledWith(
      "test_user_id",
      "proposal-1",
      expect.objectContaining({ planDayIds: ["day-2"] }),
    );
  });

  it("applies every change without a body", async () => {
    vi.mocked(applyPlanAdjustmentProposal).mockResolvedValue({ applied: true, changeCount: 2 });

    const response = await request(app).post("/api/v1/plan-proposals/proposal-1/apply");

    expect(response.status).toBe(200);
    expect(applyPlanAdjustmentProposal).toHaveBeenCalledWith(
      "test_user_id",
      "proposal-1",
      expect.objectContaining({ planDayIds: undefined }),
    );
  });

  it("is a 400 for an empty pick, before reaching the service", async () => {
    const response = await request(app).post("/api/v1/plan-proposals/proposal-1/apply").send({ planDayIds: [] });

    expect(response.status).toBe(400);
    expect(applyPlanAdjustmentProposal).not.toHaveBeenCalled();
  });

  it("is a 400 for a pick naming a day the proposal doesn't change", async () => {
    vi.mocked(applyPlanAdjustmentProposal).mockResolvedValue({
      applied: false,
      reason: "invalid_selection",
      message: "Pick at least one of the proposed changes to apply.",
    });

    const response = await request(app).post("/api/v1/plan-proposals/proposal-1/apply").send({ planDayIds: ["day-9"] });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ reason: "invalid_selection" });
  });
});

describe("POST /api/v1/plan-proposals/:id/undo", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.resetAllMocks();
    clearRateLimitBuckets();
    app = createTestApp(planProposalRouter);
  });

  it("undoes the athlete's applied proposal", async () => {
    vi.mocked(undoPlanAdjustmentProposal).mockResolvedValue({ undone: true, restoredCount: 2, keptDays: [] });

    const response = await request(app).post("/api/v1/plan-proposals/proposal-1/undo");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ undone: true, restoredCount: 2, keptDays: [] });
    expect(undoPlanAdjustmentProposal).toHaveBeenCalledWith("test_user_id", "proposal-1", expect.anything());
    // No AI call, so no consent check.
    expect(storage.users.getUser).not.toHaveBeenCalled();
  });

  it("is a 409 with the reason when there is nothing to undo", async () => {
    vi.mocked(undoPlanAdjustmentProposal).mockResolvedValue({
      undone: false,
      reason: "expired",
      message: "Those changes were applied more than a week ago, so they can no longer be undone from here.",
    });

    const response = await request(app).post("/api/v1/plan-proposals/proposal-1/undo");

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ reason: "expired" });
  });

  it("is a 404 for a proposal that isn't the athlete's", async () => {
    const response = await request(app).post("/api/v1/plan-proposals/someone-elses/undo");

    expect(response.status).toBe(404);
  });
});
