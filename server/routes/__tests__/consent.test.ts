import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { clearRateLimitBuckets } from "../../routeUtils";
import { storage } from "../../storage";
import consentRouter from "../consent";
import { createTestApp } from "./testUtils";

vi.mock("../../clerkAuth", async () => (await import("./testUtils")).mockClerkAuthModule());
vi.mock("../../types", async () => (await import("./testUtils")).mockTypesModule());
vi.mock("../../storage", async () =>
  (await import("./testUtils")).mockStorageModule({
    consent: ["recordConsent", "getConsents"],
  }),
);

describe("consent routes (W4)", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    clearRateLimitBuckets();
    app = createTestApp(consentRouter);
  });

  it("records a consent decision server-side", async () => {
    const response = await request(app)
      .post("/api/v1/consents")
      .send({ consentType: "error_reporting", granted: false });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true });
    expect(storage.consent.recordConsent).toHaveBeenCalledWith(
      "test_user_id",
      "error_reporting",
      false,
    );
  });

  it("rejects an unknown consent type with 400", async () => {
    const response = await request(app)
      .post("/api/v1/consents")
      .send({ consentType: "marketing", granted: true });

    expect(response.status).toBe(400);
    expect(storage.consent.recordConsent).not.toHaveBeenCalled();
  });

  it("returns the user's recorded consents", async () => {
    vi.mocked(storage.consent.getConsents).mockResolvedValue([
      { consentType: "privacy_notice", granted: true, consentedAt: new Date("2026-06-06T00:00:00Z") },
    ]);

    const response = await request(app).get("/api/v1/consents");

    expect(response.status).toBe(200);
    expect(response.body.consents).toHaveLength(1);
    expect(storage.consent.getConsents).toHaveBeenCalledWith("test_user_id");
  });
});
