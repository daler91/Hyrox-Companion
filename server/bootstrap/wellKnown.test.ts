import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { buildAssetLinks, parseCertFingerprints, registerWellKnownRoutes } from "./wellKnown";

const FINGERPRINT = Array.from({ length: 32 }, () => "AB").join(":");

function buildApp(config: Parameters<typeof registerWellKnownRoutes>[1]) {
  const app = express();
  registerWellKnownRoutes(app, config);
  return app;
}

describe("/.well-known/assetlinks.json", () => {
  it("names the package and every fingerprint for App Links verification", async () => {
    const res = await request(buildApp({ packageName: "com.fitai.coach", sha256Fingerprints: [FINGERPRINT, "CD"] })).get(
      "/.well-known/assetlinks.json",
    );

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^application\/json/);
    expect(res.headers["cache-control"]).toBe("public, max-age=3600");
    expect(res.body).toEqual([
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: {
          namespace: "android_app",
          package_name: "com.fitai.coach",
          sha256_cert_fingerprints: [FINGERPRINT, "CD"],
        },
      },
    ]);
  });

  it("is a 404 when the app is not configured, so no environment claims an app it has not got", async () => {
    const res = await request(buildApp({})).get("/.well-known/assetlinks.json");

    expect(res.status).toBe(404);
  });

  it("is a 404 with a package but no fingerprints", () => {
    expect(buildAssetLinks({ packageName: "com.fitai.coach", sha256Fingerprints: [] })).toBeNull();
  });
});

describe("parseCertFingerprints", () => {
  it("splits, trims and upper-cases the comma-separated env value", () => {
    expect(parseCertFingerprints(" ab:cd , EF:01 ,")).toEqual(["AB:CD", "EF:01"]);
  });

  it("returns nothing for an unset value", () => {
    expect(parseCertFingerprints(undefined)).toEqual([]);
  });
});
