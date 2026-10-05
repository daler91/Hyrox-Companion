import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { PERMISSIONS_POLICY, permissionsPolicy } from "./permissionsPolicy";

/** The allowlist a Permissions-Policy header gives one feature, e.g. "(self)". */
function allowlistFor(header: string, feature: string): string | undefined {
  return header
    .split(",")
    .map((entry) => entry.trim().split("="))
    .find(([name]) => name === feature)?.[1];
}

describe("Permissions-Policy", () => {
  const app = express();
  app.use(permissionsPolicy);
  app.get("/{*splat}", (_req, res) => {
    res.type("html").send("<!doctype html>");
  });

  // C2 (CODEBASE_ANALYSIS_2026-10-03): `camera=()` blocked the barcode
  // scanner's getUserMedia on the app's own page.
  it("lets the app's own origin use the camera for the barcode scanner", async () => {
    const res = await request(app).get("/nutrition");

    expect(res.headers["permissions-policy"]).toBe(PERMISSIONS_POLICY);
    expect(allowlistFor(PERMISSIONS_POLICY, "camera")).toBe("(self)");
  });

  it("lets the app's own origin use the microphone for dictation", () => {
    expect(allowlistFor(PERMISSIONS_POLICY, "microphone")).toBe("(self)");
  });

  it("keeps geolocation off", () => {
    expect(allowlistFor(PERMISSIONS_POLICY, "geolocation")).toBe("()");
  });
});
